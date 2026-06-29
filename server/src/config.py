"""Configuration via pydantic-settings; all values come from environment variables."""

from __future__ import annotations

import hashlib
from functools import cached_property
from typing import Annotated

from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # InfluxDB
    influx_url: str = Field(..., description="InfluxDB v2 URL, e.g. http://influxdb:8086")
    influx_token: str = Field(..., description="InfluxDB API token")
    influx_org: str = Field("mallard", description="InfluxDB organisation")
    influx_bucket: str = Field("metrics", description="InfluxDB bucket")

    # Auth — comma-separated plain-text keys; hashed in memory at startup
    api_keys: str = Field(..., description="Comma-separated plain-text API keys")

    # Server
    server_host: str = Field("0.0.0.0", description="Bind address")
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
        "", description="Comma-separated MQTT passwords (independent of API_KEYS)"
    )

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
    def hashed_api_keys(self) -> set[str]:
        """SHA-256 hashes of the configured plain-text API keys (computed once)."""
        return {
            hashlib.sha256(key.strip().encode()).hexdigest()
            for key in self.api_keys.split(",")
            if key.strip()
        }

    @cached_property
    def hashed_mqtt_credentials(self) -> set[str]:
        """SHA-256 hashes of the configured MQTT passwords (computed once)."""
        if not self.mqtt_credentials.strip():
            return set()
        return {
            hashlib.sha256(cred.strip().encode()).hexdigest()
            for cred in self.mqtt_credentials.split(",")
            if cred.strip()
        }


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()  # type: ignore[call-arg]
    return _settings
