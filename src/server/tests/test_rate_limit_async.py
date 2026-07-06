"""Async rate-limiter backends: in-process wrapper + Redis-backed limiter."""

from __future__ import annotations

import fakeredis.aioredis as fakeredis
import pytest

from server.rate_limit import (
    InProcessRateLimiter,
    RedisRateLimiter,
    SlidingWindowLimiter,
    create_rate_limiter,
)


class TestInProcessRateLimiter:
    async def test_allows_then_blocks(self) -> None:
        limiter = InProcessRateLimiter(SlidingWindowLimiter(2, 60))
        assert await limiter.check("k", now=1000.0) is None
        assert await limiter.check("k", now=1000.0) is None
        retry = await limiter.check("k", now=1000.0)
        assert retry is not None and retry > 0

    async def test_cleanup_evicts_expired_keys(self) -> None:
        limiter = InProcessRateLimiter(SlidingWindowLimiter(5, 60))
        await limiter.check("a", now=0.0)
        await limiter.check("b", now=0.0)
        # Well past the window — every key's hits have expired.
        removed = limiter.cleanup(now=1000.0)
        assert removed == 2

    async def test_healthy(self) -> None:
        limiter = InProcessRateLimiter(SlidingWindowLimiter(1, 60))
        assert await limiter.healthy() is True


class TestRedisRateLimiter:
    @pytest.fixture()
    def redis(self):
        return fakeredis.FakeRedis(decode_responses=True)

    async def test_allows_up_to_limit_then_blocks(self, redis) -> None:
        limiter = RedisRateLimiter(redis, limit=2, window_seconds=60)
        assert await limiter.check("team") is None
        assert await limiter.check("team") is None
        retry = await limiter.check("team")
        assert retry is not None and retry > 0

    async def test_keys_are_independent(self, redis) -> None:
        limiter = RedisRateLimiter(redis, limit=1, window_seconds=60)
        assert await limiter.check("team-a") is None
        assert await limiter.check("team-b") is None  # different key, still allowed
        assert await limiter.check("team-a") is not None

    async def test_limit_is_shared_across_replicas(self, redis) -> None:
        """Two limiter instances (simulating two pods) share one Redis, so the
        per-credential limit holds across the fleet instead of being multiplied
        by the replica count."""
        pod_a = RedisRateLimiter(redis, limit=2, window_seconds=60)
        pod_b = RedisRateLimiter(redis, limit=2, window_seconds=60)
        assert await pod_a.check("team") is None
        assert await pod_b.check("team") is None
        # Third request on either pod exceeds the shared limit of 2.
        assert await pod_a.check("team") is not None

    async def test_window_expiry_via_ttl(self, redis) -> None:
        # A fixed wall-clock `now` far in the future frees the window.
        limiter = RedisRateLimiter(redis, limit=1, window_seconds=1)
        assert await limiter.check("team", now=1_000.0) is None
        assert await limiter.check("team", now=1_000.0) is not None
        assert await limiter.check("team", now=1_010.0) is None  # window passed

    async def test_healthy(self, redis) -> None:
        limiter = RedisRateLimiter(redis, limit=1, window_seconds=60)
        assert await limiter.healthy() is True

    async def test_from_string(self, redis) -> None:
        limiter = RedisRateLimiter.from_string(redis, "1/second")
        assert limiter.limit == 1
        assert limiter.window_seconds == 1.0


class TestFactory:
    async def test_returns_in_process_without_redis_url(self) -> None:
        settings = _Settings(rate_limit="60/minute", redis_url="")
        limiter = await create_rate_limiter(settings)
        assert isinstance(limiter, InProcessRateLimiter)

    async def test_returns_redis_when_url_set(self, monkeypatch) -> None:
        import redis.asyncio as aioredis

        monkeypatch.setattr(
            aioredis, "from_url", lambda *a, **k: fakeredis.FakeRedis(decode_responses=True)
        )
        settings = _Settings(rate_limit="60/minute", redis_url="redis://localhost:6379/0")
        limiter = await create_rate_limiter(settings)
        assert isinstance(limiter, RedisRateLimiter)


class _Settings:
    def __init__(self, rate_limit: str, redis_url: str) -> None:
        self.rate_limit = rate_limit
        self.redis_url = redis_url
