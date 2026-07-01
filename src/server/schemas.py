"""Pydantic models for each known wire version of the ingest payload.

These are intentionally permissive (`extra="allow"`) — an unrecognized field
on an otherwise-known version is not a reason to reject the whole payload.
See `normalize.py` for how each version maps to the one canonical shape the
rest of the server deals with, and for how a `schema_version` this server
doesn't recognize at all is handled.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class IngestEnvelope(BaseModel):
    """Just enough to route: every version must carry a schema_version."""

    model_config = ConfigDict(extra="allow")

    schema_version: int


class IngestPayloadV1(BaseModel):
    """The extension's original payload shape (schema_version: 1): rich
    per-snapshot analytics, but no stable instance id and an ISO-8601
    string timestamp rather than epoch milliseconds."""

    model_config = ConfigDict(extra="allow")

    schema_version: int
    ts: str
    model_dist: dict[str, float] = Field(default_factory=dict)
    surface_dist: dict[str, float] = Field(default_factory=dict)
    cost_dist: dict[str, float] = Field(default_factory=dict)
    input_cost_ratio: float | None = None
    credits_velocity_per_hour: float | None = None
    mtd_budget_pct: float | None = None
    repo_count: int | None = None
    peak_usage_hour: int | None = None
    daily_credit_variance: float | None = None
    model_count: int | None = None
    surface_concentration: float | None = None
    estimated_event_ratio: float | None = None
    forecast_basis: str | None = None
    budget_trend: int | None = None
    token_per_credit: float | None = None
    forecast_low: float | None = None
    forecast_high: float | None = None
    source_connector: str | None = None


class IngestPayloadV2(BaseModel):
    """Current payload shape (schema_version: 2): adds the identity and
    absolute fields the server needs for per-instance dashboards, alongside
    the same analytics fields v1 already sent."""

    model_config = ConfigDict(extra="allow")

    schema_version: int
    instance_id: str = Field(..., description="Stable anonymous hash identifying the VS Code instance")
    ts: int = Field(..., description="Unix epoch milliseconds")
    mtd_credits: float = Field(..., description="Month-to-date credits consumed")
    mtd_cost_usd: float = Field(..., description="Month-to-date cost in USD")
    today_credits: float = Field(..., description="Credits consumed today")
    today_cost_usd: float = Field(..., description="Cost today in USD")
    active_models: list[str] = Field(default_factory=list, description="Models used in the current session")
    top_model: str | None = Field(None, description="Most-used model by credit consumption")
    credits_velocity_per_hour: float | None = None
    mtd_budget_pct: float | None = None
    repo_count: int | None = None
    peak_usage_hour: int | None = None
    daily_credit_variance: float | None = None
    model_count: int | None = None
    surface_concentration: float | None = None
    estimated_event_ratio: float | None = None
    forecast_basis: str | None = None
    budget_trend: int | None = None
    token_per_credit: float | None = None
    forecast_low: float | None = None
    forecast_high: float | None = None
    source_connector: str | None = None
    model_dist: dict[str, float] = Field(default_factory=dict)
    surface_dist: dict[str, float] = Field(default_factory=dict)
    cost_dist: dict[str, float] = Field(default_factory=dict)
