"""Tests for the post-auth per-credential sliding-window rate limiter."""

from __future__ import annotations

import pytest

from server.rate_limit import SlidingWindowLimiter


class TestFromString:
    def test_parses_per_minute(self) -> None:
        limiter = SlidingWindowLimiter.from_string("60/minute")
        assert limiter.limit == 60
        assert limiter.window_seconds == 60.0

    @pytest.mark.parametrize(
        ("spec", "limit", "window"),
        [
            ("1/second", 1, 1.0),
            ("100/hour", 100, 3600.0),
            ("5/day", 5, 86400.0),
            (" 10 / minute ", 10, 60.0),
        ],
    )
    def test_parses_all_periods(self, spec: str, limit: int, window: float) -> None:
        limiter = SlidingWindowLimiter.from_string(spec)
        assert limiter.limit == limit
        assert limiter.window_seconds == window

    @pytest.mark.parametrize("spec", ["", "banana", "60", "/minute", "60/fortnight", "-1/minute"])
    def test_rejects_invalid_specs(self, spec: str) -> None:
        with pytest.raises(ValueError):
            SlidingWindowLimiter.from_string(spec)

    def test_rejects_zero_limit(self) -> None:
        with pytest.raises(ValueError):
            SlidingWindowLimiter(0, 60)


class TestCheck:
    def test_allows_up_to_limit(self) -> None:
        limiter = SlidingWindowLimiter(3, 60)
        assert limiter.check("a", now=0.0) is None
        assert limiter.check("a", now=1.0) is None
        assert limiter.check("a", now=2.0) is None

    def test_blocks_over_limit_with_retry_seconds(self) -> None:
        limiter = SlidingWindowLimiter(2, 60)
        assert limiter.check("a", now=0.0) is None
        assert limiter.check("a", now=10.0) is None
        retry = limiter.check("a", now=20.0)
        # Oldest hit (t=0) leaves the window at t=60 → 40s to wait
        assert retry == pytest.approx(40.0)

    def test_window_slides(self) -> None:
        limiter = SlidingWindowLimiter(1, 60)
        assert limiter.check("a", now=0.0) is None
        assert limiter.check("a", now=30.0) is not None
        assert limiter.check("a", now=61.0) is None  # old hit expired

    def test_keys_are_independent(self) -> None:
        limiter = SlidingWindowLimiter(1, 60)
        assert limiter.check("a", now=0.0) is None
        assert limiter.check("a", now=1.0) is not None
        assert limiter.check("b", now=1.0) is None

    def test_blocked_attempt_does_not_consume_budget(self) -> None:
        limiter = SlidingWindowLimiter(1, 60)
        assert limiter.check("a", now=0.0) is None
        assert limiter.check("a", now=1.0) is not None
        # The blocked call above must not have extended the window
        assert limiter.check("a", now=60.5) is None
