"""Tests for Settings field validators and credential parsing."""

from __future__ import annotations

import hashlib

import pytest
from pydantic import ValidationError


class TestSettingsValidators:
    def test_empty_influx_url_raises(self) -> None:
        from server.config import Settings

        with pytest.raises(ValidationError, match="INFLUX_URL must not be empty"):
            Settings(influx_url="", influx_token="tok", api_keys="key")

    def test_whitespace_influx_url_raises(self) -> None:
        from server.config import Settings

        with pytest.raises(ValidationError, match="INFLUX_URL must not be empty"):
            Settings(influx_url="   ", influx_token="tok", api_keys="key")

    def test_valid_influx_url_is_stripped(self) -> None:
        from server.config import Settings

        s = Settings(influx_url="  http://x:8086  ", influx_token="tok", api_keys="k")
        assert s.influx_url == "http://x:8086"

    def test_empty_api_keys_raises(self) -> None:
        from server.config import Settings

        with pytest.raises(ValidationError, match="API_KEYS must contain at least one key"):
            Settings(influx_url="http://x:8086", influx_token="tok", api_keys="")

    def test_whitespace_only_api_keys_raises(self) -> None:
        from server.config import Settings

        with pytest.raises(ValidationError, match="API_KEYS must contain at least one key"):
            Settings(influx_url="http://x:8086", influx_token="tok", api_keys="   ")


class TestParseLabeledFunction:
    def test_bare_key_gets_unknown_label(self) -> None:
        from server.config import _parse_labeled

        result = _parse_labeled("mykey")
        h = hashlib.sha256(b"mykey").hexdigest()
        assert result == {h: "unknown"}

    def test_labeled_key_stores_label(self) -> None:
        from server.config import _parse_labeled

        result = _parse_labeled("team-alpha:mykey")
        h = hashlib.sha256(b"mykey").hexdigest()
        assert result == {h: "team-alpha"}

    def test_multiple_entries(self) -> None:
        from server.config import _parse_labeled

        result = _parse_labeled("alice:pass1,bob:pass2")
        h1 = hashlib.sha256(b"pass1").hexdigest()
        h2 = hashlib.sha256(b"pass2").hexdigest()
        assert result[h1] == "alice"
        assert result[h2] == "bob"

    def test_empty_string_returns_empty_dict(self) -> None:
        from server.config import _parse_labeled

        assert _parse_labeled("") == {}

    def test_whitespace_only_entries_skipped(self) -> None:
        from server.config import _parse_labeled

        assert _parse_labeled("  ,  ,  ") == {}

    def test_mixed_bare_and_labeled(self) -> None:
        from server.config import _parse_labeled

        result = _parse_labeled("bare-key,team:secret")
        h_bare = hashlib.sha256(b"bare-key").hexdigest()
        h_labeled = hashlib.sha256(b"secret").hexdigest()
        assert result[h_bare] == "unknown"
        assert result[h_labeled] == "team"


class TestHashedCredentials:
    def test_hashed_api_keys_bare_format(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "key-a,key-b")

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()

        expected_a = hashlib.sha256(b"key-a").hexdigest()
        expected_b = hashlib.sha256(b"key-b").hexdigest()
        assert expected_a in settings.hashed_api_keys
        assert expected_b in settings.hashed_api_keys
        assert settings.hashed_api_keys[expected_a] == "unknown"

    def test_hashed_api_keys_labeled_format(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "team-alpha:key-a,team-beta:key-b")

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()

        expected_a = hashlib.sha256(b"key-a").hexdigest()
        expected_b = hashlib.sha256(b"key-b").hexdigest()
        assert settings.hashed_api_keys[expected_a] == "team-alpha"
        assert settings.hashed_api_keys[expected_b] == "team-beta"

    def test_plain_keys_not_stored(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "plain-text-key")

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()

        assert "plain-text-key" not in settings.hashed_api_keys

    def test_empty_mqtt_credentials_returns_empty_dict(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "k")
        monkeypatch.setenv("MQTT_CREDENTIALS", "")

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()
        assert settings.hashed_mqtt_credentials == {}

    def test_mqtt_credentials_labeled_format(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "k")
        monkeypatch.setenv("MQTT_CREDENTIALS", "sensor-1:mqtt-pass")

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()

        h = hashlib.sha256(b"mqtt-pass").hexdigest()
        assert settings.hashed_mqtt_credentials[h] == "sensor-1"

    def test_secret_manager_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "k")

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()
        assert settings.secret_manager_type == ""
        assert settings.secret_manager_url == ""
        assert settings.infisical_env_slug == "prod"
        assert settings.openbao_secret_path == "secret/data/mallard/server"
