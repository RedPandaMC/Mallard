"""Configuration via pydantic-settings; all values come from environment variables."""

from __future__ import annotations

from functools import cached_property
from typing import TYPE_CHECKING, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

if TYPE_CHECKING:
    from .credential_verifier import JwtConfig


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # InfluxDB
    influx_url: str = Field(..., description="InfluxDB v2 URL, e.g. http://influxdb:8086")
    influx_token: str = Field(..., description="InfluxDB API token")
    influx_org: str = Field("mallard", description="InfluxDB organisation")
    influx_bucket: str = Field("metrics", description="InfluxDB bucket")

    # Auth — comma-separated plain-text keys in label:secret or bare format.
    # Read by StaticCredentialVerifier, the default (static) secret backend.
    api_keys: str = Field("", description="Comma-separated API keys (label:key or bare key)")

    # Server
    server_host: str = Field("0.0.0.0", description="Bind address")  # nosec B104 — intentional for containerised deployment
    server_port: int = Field(8080, description="Listen port")

    # Rate limiting
    rate_limit: str = Field("60/minute", description="Per-key rate limit (slowapi format)")
    # When set, the post-auth per-credential limiter is backed by Redis so the
    # limit holds across all replicas (the in-process limiter multiplies the
    # effective limit by the replica count and resets on restart). Empty falls
    # back to the in-process limiter (single-node / local dev only).
    redis_url: str = Field(
        "", description="Redis URL for the shared per-credential rate limiter (e.g. redis://redis:6379/0)"
    )

    # Logging
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        "INFO", description="Python logging level"
    )

    # MQTT (optional — embedded broker started when mqtt_enabled = true)
    mqtt_enabled: bool = Field(False, description="Start the embedded MQTT broker on mqtt_port")
    mqtt_port: int = Field(8083, description="WebSocket MQTT port (internal; proxied by Caddy/Ingress)")
    mqtt_topic_prefix: str = Field(
        "mallard/",
        description="Only MQTT messages on topics under this prefix are ingested (topic scoping)",
    )
    mqtt_password: str = Field(
        "",
        description=(
            "Single shared password for the embedded MQTT broker. All MQTT ingest is "
            "tagged source='mqtt'; per-credential labels exist only for API keys "
            "(and cert CNs via CERT_LABELS). With SECRET_MANAGER_TYPE=openbao the "
            "value is read from the secret manager instead."
        ),
    )

    # mTLS cert labels — 'label:cn' pairs mapping a client-cert CommonName to a
    # source label; CNs without an entry fall back to the CN itself as the source.
    cert_labels: str = Field(
        "",
        description="Comma-separated 'label:cn' pairs for mTLS clients",
    )

    # Optional HMAC request signing. When non-empty, every ingest request must
    # carry a valid X-Mallard-Signature-256 header (HMAC-SHA256 of the raw
    # body). Comma-separated plain values so a new secret can be added before
    # the old one is retired (rotation window).
    webhook_hmac_secrets: str = Field(
        "",
        description=(
            "Comma-separated HMAC signing secrets for X-Mallard-Signature-256 "
            "verification. Empty disables signature checking. With openbao the "
            "value is read from the secret manager instead."
        ),
    )

    # JWT bearer auth (optional). Symmetric (HS*) via jwt_hmac_secret, or
    # asymmetric (RS*/ES*/PS*) via a PEM jwt_public_key or a jwt_jwks_url.
    # With openbao the material is read from the secret manager instead.
    jwt_hmac_secret: str = Field("", description="HS* shared secret")
    jwt_public_key: str = Field("", description="PEM public key for RS*/ES*/PS*")
    jwt_jwks_url: str = Field("", description="JWKS endpoint for asymmetric keys")
    jwt_algorithms: str = Field("", description="Comma-separated allowed algs (default HS256 or RS256/ES256)")
    jwt_issuer: str = Field("", description="Required 'iss' claim (empty = not enforced)")
    jwt_audience: str = Field("", description="Required 'aud' claim (empty = not enforced)")
    jwt_label_claim: str = Field("sub", description="Claim used to derive the source label")
    jwt_labels: str = Field("", description="Comma-separated 'label:claimValue' pairs")

    # Secret backend. "static" (the default) reads credentials from the env
    # vars above — a plain .env file or Kubernetes Secret is a first-class
    # production setup. "openbao" fetches them live from an OpenBao KV store
    # for rotation without restarts (the advanced path).
    secret_manager_type: Literal["static", "openbao"] = Field(
        "static",
        description=(
            "Credential backend: 'static' (env vars / K8s Secret, the default) or "
            "'openbao' (live-fetched from OpenBao for rotation without restarts)."
        ),
    )
    secret_manager_url: str = Field("", description="Secret manager API base URL")
    secret_manager_token: str = Field("", description="Auth token for the secret manager")
    secret_manager_ca_cert_path: str = Field(
        "", description="Path to CA cert PEM for secret manager TLS (empty = system CAs)"
    )

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
        if self.secret_manager_type == "openbao":
            if not self.secret_manager_url.strip():
                raise ValueError("SECRET_MANAGER_URL must be set when SECRET_MANAGER_TYPE=openbao")
            if not self.secret_manager_token.strip():
                raise ValueError("SECRET_MANAGER_TOKEN must be set when SECRET_MANAGER_TYPE=openbao")
        return self

    @cached_property
    def hashed_api_keys(self) -> dict[str, str]:
        """SHA-256 hash → label map for configured API keys (computed once)."""
        # Local import: credential_verifier imports Settings for typing, so a
        # module-level import here would be circular.
        from .credential_verifier import CredentialStore

        return CredentialStore.parse_labeled(self.api_keys)

    @cached_property
    def parsed_cert_labels(self) -> dict[str, str]:
        """CN → label map for mTLS clients (computed once)."""
        from .credential_verifier import CredentialStore

        return CredentialStore.parse_cert_labels(self.cert_labels)

    @cached_property
    def parsed_webhook_hmac_secrets(self) -> list[str]:
        """HMAC signing secrets (computed once)."""
        from .credential_verifier import CredentialStore

        return CredentialStore.parse_secret_list(self.webhook_hmac_secrets)

    @cached_property
    def parsed_jwt(self) -> "JwtConfig":
        """JWT verification config (computed once)."""
        from .credential_verifier import _jwt_config_from

        return _jwt_config_from(
            {
                "jwt_hmac_secret": self.jwt_hmac_secret,
                "jwt_public_key": self.jwt_public_key,
                "jwt_jwks_url": self.jwt_jwks_url,
                "jwt_algorithms": self.jwt_algorithms,
                "jwt_issuer": self.jwt_issuer,
                "jwt_audience": self.jwt_audience,
                "jwt_label_claim": self.jwt_label_claim,
                "jwt_labels": self.jwt_labels,
            }
        )

    @property
    def secret_manager_base_url(self) -> str:
        """secret_manager_url normalised for the verifier: no trailing slash."""
        return self.secret_manager_url.rstrip("/")


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()  # type: ignore[call-arg]
    return _settings
