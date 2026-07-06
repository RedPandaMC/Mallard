"""Per-credential rate limiter, applied after authentication.

The pre-auth slowapi middleware keys on client IP (bounded key space; an
attacker cannot mint fresh buckets by varying a header). This limiter runs
after credential verification and keys on the *verified* source label, which
is what makes the documented per-credential limiting actually true.

Two backends implement the same async `check(key)` contract:
  * ``RedisRateLimiter`` — a shared sliding window in Redis. Use this in any
    multi-replica deployment (the server runs 2–10 replicas under the HPA); an
    in-process limiter would multiply the effective limit by the replica count
    and reset on every restart/scale event.
  * ``InProcessRateLimiter`` — wraps the in-process ``SlidingWindowLimiter``
    for single-node / local dev where Redis isn't configured.
"""

from __future__ import annotations

import os
import re
import time
from collections import deque
from typing import Protocol, runtime_checkable

_PERIOD_SECONDS = {"second": 1.0, "minute": 60.0, "hour": 3600.0, "day": 86400.0}
_SPEC_RE = re.compile(r"^\s*(\d+)\s*/\s*(second|minute|hour|day)\s*$")


class SlidingWindowLimiter:
    """Sliding-window counter per key. Keys are verified credential labels /
    cert CNs, so the key space is bounded by the number of provisioned
    credentials — no eviction pressure."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        if limit < 1 or window_seconds <= 0:
            raise ValueError("limit must be >= 1 and window_seconds > 0")
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = {}

    @classmethod
    def from_string(cls, spec: str) -> "SlidingWindowLimiter":
        """Parse a slowapi-style spec like '60/minute'."""
        m = _SPEC_RE.match(spec)
        if not m:
            raise ValueError(f"Invalid rate limit spec: {spec!r}")
        return cls(int(m.group(1)), _PERIOD_SECONDS[m.group(2)])

    def check(self, key: str, now: float | None = None) -> float | None:
        """Record a hit for *key* if allowed and return None; otherwise return
        the number of seconds until the oldest hit leaves the window."""
        t = time.monotonic() if now is None else now
        hits = self._hits.setdefault(key, deque())
        cutoff = t - self.window_seconds
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= self.limit:
            return hits[0] + self.window_seconds - t
        hits.append(t)
        return None

    def cleanup(self, now: float | None = None) -> int:
        """Remove expired entries from all keys. Returns the number of keys removed."""
        t = time.monotonic() if now is None else now
        cutoff = t - self.window_seconds
        removed_keys = []
        for key, hits in self._hits.items():
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if not hits:
                removed_keys.append(key)
        for key in removed_keys:
            del self._hits[key]
        return len(removed_keys)


# ── Async backends ────────────────────────────────────────────────────────────


@runtime_checkable
class RateLimiter(Protocol):
    """Async per-credential limiter. ``check`` records a hit and returns None when
    allowed, or the seconds until the oldest hit leaves the window when denied."""

    async def check(self, key: str, now: float | None = None) -> float | None: ...

    async def healthy(self) -> bool: ...

    async def aclose(self) -> None: ...


class InProcessRateLimiter:
    """Adapts the in-process ``SlidingWindowLimiter`` to the async ``RateLimiter``
    contract. Single-node / local-dev fallback when Redis isn't configured."""

    def __init__(self, limiter: SlidingWindowLimiter) -> None:
        self._limiter = limiter

    @classmethod
    def from_string(cls, spec: str) -> "InProcessRateLimiter":
        return cls(SlidingWindowLimiter.from_string(spec))

    async def check(self, key: str, now: float | None = None) -> float | None:
        return self._limiter.check(key, now)

    def cleanup(self, now: float | None = None) -> int:
        return self._limiter.cleanup(now)

    async def healthy(self) -> bool:  # in-process — no external dependency
        return True

    async def aclose(self) -> None:  # pragma: no cover - nothing to close
        pass


# Sliding-window admission as a single atomic Redis script: drop hits older than
# the window, count what remains, and only add the new hit when under the limit.
# Returns [allowed(0|1), oldest_score_ms]. Doing it in one EVAL keeps the check
# correct under concurrent requests hitting different replicas.
_REDIS_SLIDING_WINDOW_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  -- Fetch the oldest member then its score via ZSCORE. WITHSCORES nests its
  -- result under RESP3, which would truncate the returned array; ZSCORE is a
  -- plain string and portable across RESP2/RESP3.
  local members = redis.call('ZRANGE', key, 0, 0)
  local oldest = 0
  if members[1] ~= nil then
    oldest = redis.call('ZSCORE', key, members[1])
  end
  return {0, tostring(oldest)}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, '0'}
"""


class RedisRateLimiter:
    """Shared sliding-window limiter backed by Redis, so the per-credential limit
    holds across all replicas and survives restarts. Keys carry a TTL, so expired
    windows evict themselves — no separate cleanup task needed."""

    def __init__(self, redis, limit: int, window_seconds: float, namespace: str = "mallard:rl") -> None:
        if limit < 1 or window_seconds <= 0:
            raise ValueError("limit must be >= 1 and window_seconds > 0")
        self._redis = redis
        self.limit = limit
        self.window_seconds = window_seconds
        self._window_ms = int(window_seconds * 1000)
        self._namespace = namespace

    @classmethod
    def from_string(cls, redis, spec: str, namespace: str = "mallard:rl") -> "RedisRateLimiter":
        m = _SPEC_RE.match(spec)
        if not m:
            raise ValueError(f"Invalid rate limit spec: {spec!r}")
        return cls(redis, int(m.group(1)), _PERIOD_SECONDS[m.group(2)], namespace)

    async def check(self, key: str, now: float | None = None) -> float | None:
        now_ms = int((time.time() if now is None else now) * 1000)
        member = f"{now_ms}-{os.urandom(6).hex()}"
        allowed, oldest = await self._redis.eval(
            _REDIS_SLIDING_WINDOW_LUA, 1, f"{self._namespace}:{key}",
            now_ms, self._window_ms, self.limit, member,
        )
        if int(allowed) == 1:
            return None
        retry_ms = float(oldest) + self._window_ms - now_ms
        return max(0.0, retry_ms / 1000.0)

    async def healthy(self) -> bool:
        try:
            return bool(await self._redis.ping())
        except Exception:
            return False

    async def aclose(self) -> None:
        await self._redis.aclose()


async def create_rate_limiter(settings) -> RateLimiter:
    """Build the per-credential limiter for the deployment: Redis-backed when
    ``redis_url`` is configured (required for the multi-replica production
    topology), else the in-process fallback."""
    if settings.redis_url:
        import redis.asyncio as aioredis

        client = aioredis.from_url(settings.redis_url, decode_responses=True)
        return RedisRateLimiter.from_string(client, settings.rate_limit)
    return InProcessRateLimiter.from_string(settings.rate_limit)
