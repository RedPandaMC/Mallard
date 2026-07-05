"""Tests for Settings field validators and credential parsing."""

from __future__ import annotations

import hashlib

import pytest
from pydantic import ValidationError

# Every Settings() must now name a secret manager and its connection details —
# static env-var-only credentials are not a supported production configuration.
# OpenBao is used as the default in these tests since it has no extra required
# field beyond url/token (unlike Infisical, which also needs a project id).
_SM_KWARGS = {
    "secret_manager_type": "openbao",
    "secret_manager_url": "http://sm.example",
    "secret_manager_token": "sm-token",
}
_SM_ENV = {
    "SECRET_MANAGER_TYPE": "openbao",
    "SECRET_MANAGER_URL": "http://sm.example",
    "SECRET_MANAGER_TOKEN": "sm-token",
}


def _set_sm_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for k, v in _SM_ENV.items():
        monkeypatch.setenv(k, v)


@pytest.fixture(autouse=True)
def _no_leaked_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Some other test modules (e.g. the fuzz suite) set process env vars via
    os.environ.setdefault() rather than monkeypatch, which never gets reverted
    within a pytest session. Direct Settings(...) construction in this file
    relies on specific fields being *absent* unless a test supplies them, so
    scrub anything that could leak in from an earlier test module."""
    for key in ("SECRET_MANAGER_TYPE", "SECRET_MANAGER_URL", "SECRET_MANAGER_TOKEN", "API_KEYS"):
        monkeypatch.delenv(key, raising=False)


class TestSettingsValidators:
    def test_empty_influx_url_raises(self) -> None:
        from server.config import Settings

        with pytest.raises(ValidationError, match="INFLUX_URL must not be empty"):
            Settings(influx_url="", influx_token="tok", **_SM_KWARGS)

    def test_whitespace_influx_url_raises(self) -> None:
        from server.config import Settings

        with pytest.raises(ValidationError, match="INFLUX_URL must not be empty"):
            Settings(influx_url="   ", influx_token="tok", **_SM_KWARGS)

    def test_valid_influx_url_is_stripped(self) -> None:
        from server.config import Settings

        s = Settings(influx_url="  http://x:8086  ", influx_token="tok", **_SM_KWARGS)
        assert s.influx_url == "http://x:8086"

    def test_missing_secret_manager_type_raises(self) -> None:
        from server.config import Settings

        with pytest.raises(ValidationError, match="secret_manager_type"):
            Settings(
                influx_url="http://x:8086",
                influx_token="tok",
                secret_manager_url="http://sm.example",
                secret_manager_token="sm-token",
            )

    def test_static_is_not_an_accepted_secret_manager_type(self) -> None:
        from server.config import Settings

        with pytest.raises(ValidationError):
            Settings(
                influx_url="http://x:8086",
                influx_token="tok",
                secret_manager_type="static",  # type: ignore[arg-type]
            )

    def test_missing_secret_manager_url_raises(self) -> None:
        from server.config import Settings

        with pytest.raises(ValidationError, match="SECRET_MANAGER_URL must be set"):
            Settings(
                influx_url="http://x:8086",
                influx_token="tok",
                secret_manager_type="openbao",
                secret_manager_token="sm-token",
            )

    def test_missing_secret_manager_token_raises(self) -> None:
        from server.config import Settings

        with pytest.raises(ValidationError, match="SECRET_MANAGER_TOKEN must be set"):
            Settings(
                influx_url="http://x:8086",
                influx_token="tok",
                secret_manager_type="openbao",
                secret_manager_url="http://sm.example",
            )

    def test_infisical_requires_project_id(self) -> None:
        from server.config import Settings

        with pytest.raises(ValidationError, match="INFISICAL_PROJECT_ID"):
            Settings(
                influx_url="http://x:8086",
                influx_token="tok",
                secret_manager_type="infisical",
                secret_manager_url="http://sm.example",
                secret_manager_token="sm-token",
            )

    def test_infisical_with_project_id_succeeds(self) -> None:
        from server.config import Settings

        s = Settings(
            influx_url="http://x:8086",
            influx_token="tok",
            secret_manager_type="infisical",
            secret_manager_url="http://sm.example",
            secret_manager_token="sm-token",
            infisical_project_id="proj-1",
        )
        assert s.secret_manager_type == "infisical"

    def test_api_keys_defaults_to_empty(self) -> None:
        """api_keys is no longer required — it's only meaningful for
        StaticCredentialVerifier, which production config can't select."""
        from server.config import Settings

        s = Settings(influx_url="http://x:8086", influx_token="tok", **_SM_KWARGS)
        assert s.api_keys == ""


class TestParseLabeledDelegation:
    """config.py delegates label parsing to CredentialStore.parse_labeled, so the
    Settings path gets the same _LABEL_RE sanitisation as the remote verifiers.
    The parse itself is unit-tested in test_credential_verifier.py."""

    def test_settings_path_sanitises_invalid_labels(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "bad label!:mykey")
        _set_sm_env(monkeypatch)

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()

        h = hashlib.sha256(b"mykey").hexdigest()
        assert settings.hashed_api_keys[h] == "unknown"

    def test_settings_path_sanitises_oversized_labels(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", f"{'x' * 65}:mykey")
        _set_sm_env(monkeypatch)

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()

        h = hashlib.sha256(b"mykey").hexdigest()
        assert settings.hashed_api_keys[h] == "unknown"

    def test_settings_path_matches_credential_store_parse(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from server.credential_verifier import CredentialStore

        raw = "team-alpha:key-a,bare-key,bad label!:key-b"
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", raw)
        _set_sm_env(monkeypatch)

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()

        assert settings.hashed_api_keys == CredentialStore.parse_labeled(raw)


class TestHashedCredentials:
    def test_hashed_api_keys_bare_format(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "key-a,key-b")
        _set_sm_env(monkeypatch)

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
        _set_sm_env(monkeypatch)

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
        _set_sm_env(monkeypatch)

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()

        assert "plain-text-key" not in settings.hashed_api_keys

    def test_mqtt_password_defaults_to_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "k")
        _set_sm_env(monkeypatch)

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()
        assert settings.mqtt_password == ""

    def test_cert_labels_parsed_and_sanitised(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        monkeypatch.setenv("API_KEYS", "k")
        monkeypatch.setenv("CERT_LABELS", "team-a:machine-01,bad entry")
        _set_sm_env(monkeypatch)

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()
        assert settings.parsed_cert_labels == {"machine-01": "team-a"}

    def test_secret_manager_base_url_strips_trailing_api(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Regression: a SECRET_MANAGER_URL configured with a trailing /api made the
        Infisical verifier fetch /api/api/v3/... — the property normalises it away."""
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        _set_sm_env(monkeypatch)
        monkeypatch.setenv(
            "SECRET_MANAGER_URL", "http://infisical.infisical.svc.cluster.local/api"
        )

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()
        assert settings.secret_manager_base_url == "http://infisical.infisical.svc.cluster.local"
        # And a URL without the suffix is untouched (bar trailing-slash cleanup)
        monkeypatch.setenv("SECRET_MANAGER_URL", "http://openbao:8200/")
        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()
        assert settings.secret_manager_base_url == "http://openbao:8200"

    def test_secret_manager_field_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("INFLUX_URL", "http://localhost:8086")
        monkeypatch.setenv("INFLUX_TOKEN", "tok")
        _set_sm_env(monkeypatch)

        import server.config as config_module

        monkeypatch.setattr(config_module, "_settings", None)
        settings = config_module.get_settings()
        assert settings.secret_manager_type == "openbao"
        assert settings.infisical_env_slug == "prod"
        assert settings.openbao_secret_path == "secret/data/mallard/server"
