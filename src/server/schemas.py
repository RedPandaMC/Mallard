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


class IngestPayloadV3(BaseModel):
    """Current payload shape (schema_version: 3).

    Design principle: additive counters + per-instance gauges. The client no
    longer sends normalized fractions, local-time peak hours, or other derived
    ratios — those cannot be re-aggregated across instances (an average of
    ratios is not the ratio of sums), so v3 sends the absolute inputs and the
    server/Grafana derives what it needs.
    """

    model_config = ConfigDict(extra="allow")

    schema_version: int
    instance_id: str = Field(..., description="Stable anonymous hash identifying the VS Code instance")
    ts: int = Field(..., description="Unix epoch milliseconds")
    tz_offset_minutes: int | None = Field(
        None, description="Client UTC offset in minutes; day/month windows are client-local"
    )

    # Gauges — last() per instance
    mtd_credits: float = Field(..., description="Month-to-date credits consumed")
    mtd_cost_usd: float = Field(..., description="Month-to-date cost in USD")
    today_credits: float = Field(..., description="Credits consumed today")
    today_cost_usd: float = Field(..., description="Cost today in USD")
    mtd_budget_pct: float | None = None
    forecast_basis: str | None = None
    forecast_low: float | None = None
    forecast_high: float | None = None
    budget_trend: int | None = None
    daily_credit_stddev: float | None = None

    # Counters — additive across instances. The maps are deliberately loose
    # (dict[str, Any]): one malformed entry should be dropped by the
    # normalizer, not degrade the whole payload to the unknown-version path.
    total_credits: float | None = None
    total_tokens: float | None = None
    total_event_count: int | None = None
    estimated_event_count: int | None = None
    model_credits: dict[str, object] = Field(default_factory=dict)
    surface_credits: dict[str, object] = Field(default_factory=dict)
    language_credits: dict[str, object] = Field(default_factory=dict)
    cost_by_category: dict[str, object] = Field(default_factory=dict)

    # Dimension metadata
    active_models: list[str] = Field(default_factory=list, description="Models used in the current session")
    top_model: str | None = Field(None, description="Most-used model by credit consumption")
    model_count: int | None = None
    repo_count: int | None = None
    source_connector: str | None = None
