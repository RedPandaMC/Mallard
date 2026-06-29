"""Tests for Settings field validators."""

from __future__ import annotations

import pytest
from pydantic import ValidationError


class TestSettingsValidators:
    def test_empty_influx_url_raises(self) -> None:
        from src.config import Settings

        with pytest.raises(ValidationError, match="INFLUX_URL must not be empty"):
            Settings(influx_url="", influx_token="tok", api_keys="key")

    def test_whitespace_influx_url_raises(self) -> None:
        from src.config import Settings

        with pytest.raises(ValidationError, match="INFLUX_URL must not be empty"):
            Settings(influx_url="   ", influx_token="tok", api_keys="key")

    def test_valid_influx_url_is_stripped(self) -> None:
        from src.config import Settings

        s = Settings(influx_url="  http://x:8086  ", influx_token="tok", api_keys="k")
        assert s.influx_url == "http://x:8086"

    def test_empty_api_keys_raises(self) -> None:
        from src.config import Settings

        with pytest.raises(ValidationError, match="API_KEYS must contain at least one key"):
            Settings(influx_url="http://x:8086", influx_token="tok", api_keys="")

    def test_whitespace_only_api_keys_raises(self) -> None:
        from src.config import Settings

        with pytest.raises(ValidationError, match="API_KEYS must contain at least one key"):
            Settings(influx_url="http://x:8086", influx_token="tok", api_keys="   ")
