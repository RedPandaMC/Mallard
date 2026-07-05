"""In-process per-credential rate limiter, applied after authentication.

The pre-auth slowapi middleware keys on client IP (bounded key space; an
attacker cannot mint fresh buckets by varying a header). This limiter runs
after credential verification and keys on the *verified* source label, which
is what makes the documented per-credential limiting actually true.
"""

from __future__ import annotations

import re
import time
from collections import deque

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
