"""Configuration via pydantic-settings; all values come from environment variables."""

from __future__ import annotations

from functools import cached_property
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # InfluxDB
    influx_url: str = Field(..., description="InfluxDB v2 URL, e.g. http://influxdb:8086")
    influx_token: str = Field(..., description="InfluxDB API token")
    influx_org: str = Field("mallard", description="InfluxDB organisation")
    influx_bucket: str = Field("metrics", description="InfluxDB bucket")

    # Auth — comma-separated plain-text keys in label:secret or bare format. Only meaningful for
    # StaticCredentialVerifier, which production deployments no longer select (see
    # secret_manager_type below); kept so it can still be constructed directly in tests.
    api_keys: str = Field("", description="Comma-separated API keys (label:key or bare key), static-mode only")

    # Server
    server_host: str = Field("0.0.0.0", description="Bind address")  # nosec B104 — intentional for containerised deployment
    server_port: int = Field(8080, description="Listen port")

    # Rate limiting
    rate_limit: str = Field("60/minute", description="Per-key rate limit (slowapi format)")

    # Logging
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        "INFO", description="Python logging level"
    )

    # MQTT (optional — embedded broker started when mqtt_enabled = true)
    mqtt_enabled: bool = Field(False, description="Start the embedded MQTT broker on mqtt_port")
    mqtt_port: int = Field(8083, description="WebSocket MQTT port (internal; proxied by Caddy/Ingress)")
    mqtt_credentials: str = Field(
        "", description="Comma-separated MQTT passwords in label:secret or bare format"
    )

    # Secret manager (required — every deployment must pick one; there is no
    # supported static/env-var-only production path)
    secret_manager_type: Literal["infisical", "openbao"] = Field(
        ...,
        description=(
            "Secret manager backend. Static env-var credentials are not a supported "
            "production configuration; every deployment must pick Infisical or OpenBao."
        ),
    )
    secret_manager_url: str = Field("", description="Secret manager API base URL")
    secret_manager_token: str = Field("", description="Auth token for the secret manager")
    secret_manager_ca_cert_path: str = Field(
        "", description="Path to CA cert PEM for secret manager TLS (empty = system CAs)"
    )

    # Infisical-specific
    infisical_project_id: str = Field("", description="Infisical workspace/project ID")
    infisical_env_slug: str = Field("prod", description="Infisical environment slug")

    # OpenBao-specific
    openbao_secret_path: str = Field(
        "secret/data/mallard/server", description="OpenBao KV v2 secret path"
    )
    openbao_namespace: str = Field("", description="OpenBao namespace (enterprise only)")

    @field_validator("influx_url")
    @classmethod
    def _influx_url_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("INFLUX_URL must not be empty")
        return v.strip()

    @model_validator(mode="after")
    def _secret_manager_configured(self) -> "Settings":
        """Fail fast at startup rather than at the first ingest request."""
        if not self.secret_manager_url.strip():
            raise ValueError("SECRET_MANAGER_URL must be set")
        if not self.secret_manager_token.strip():
            raise ValueError("SECRET_MANAGER_TOKEN must be set")
        if self.secret_manager_type == "infisical" and not self.infisical_project_id.strip():
            raise ValueError("INFISICAL_PROJECT_ID must be set when SECRET_MANAGER_TYPE=infisical")
        return self

    @cached_property
    def hashed_api_keys(self) -> dict[str, str]:
        """SHA-256 hash → label map for configured API keys (computed once)."""
        # Local import: credential_verifier imports Settings for typing, so a
        # module-level import here would be circular.
        from .credential_verifier import CredentialStore

        return CredentialStore.parse_labeled(self.api_keys)

    @cached_property
    def hashed_mqtt_credentials(self) -> dict[str, str]:
        """SHA-256 hash → label map for configured MQTT passwords (computed once)."""
        from .credential_verifier import CredentialStore

        if not self.mqtt_credentials.strip():
            return {}
        return CredentialStore.parse_labeled(self.mqtt_credentials)


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()  # type: ignore[call-arg]
    return _settings
