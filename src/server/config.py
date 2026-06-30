"""Configuration via pydantic-settings; all values come from environment variables."""

from __future__ import annotations

import hashlib
from functools import cached_property
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _parse_labeled(raw: str) -> dict[str, str]:
    """'label:secret,...' → {sha256(secret): label}. Bare values get label 'unknown'."""
    result: dict[str, str] = {}
    for entry in (e.strip() for e in raw.split(",") if e.strip()):
        label, _, key = entry.partition(":")
        if not key:
            label, key = "unknown", label
        result[hashlib.sha256(key.encode()).hexdigest()] = label.strip()
    return result


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # InfluxDB
    influx_url: str = Field(..., description="InfluxDB v2 URL, e.g. http://influxdb:8086")
    influx_token: str = Field(..., description="InfluxDB API token")
    influx_org: str = Field("mallard", description="InfluxDB organisation")
    influx_bucket: str = Field("metrics", description="InfluxDB bucket")

    # Auth — comma-separated plain-text keys in label:secret or bare format
    api_keys: str = Field(..., description="Comma-separated API keys (label:key or bare key)")

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

    # Secret manager (optional — enables remote credential refresh)
    secret_manager_type: Literal["", "infisical", "openbao"] = Field(
        "", description="Secret manager backend; empty = use static env vars"
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

    @field_validator("api_keys")
    @classmethod
    def _api_keys_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("API_KEYS must contain at least one key")
        return v

    @cached_property
    def hashed_api_keys(self) -> dict[str, str]:
        """SHA-256 hash → label map for configured API keys (computed once)."""
        return _parse_labeled(self.api_keys)

    @cached_property
    def hashed_mqtt_credentials(self) -> dict[str, str]:
        """SHA-256 hash → label map for configured MQTT passwords (computed once)."""
        if not self.mqtt_credentials.strip():
            return {}
        return _parse_labeled(self.mqtt_credentials)


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()  # type: ignore[call-arg]
    return _settings
