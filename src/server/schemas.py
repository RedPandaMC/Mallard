"""Pydantic models — mirrors the Mallard client payload v2."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class IngestPayload(BaseModel):
    model_config = ConfigDict(strict=True)

    instance_id: str = Field(..., description="Stable anonymous hash identifying the VS Code instance")
    schema_version: int = Field(..., description="Payload schema version")
    ts: int = Field(..., description="Unix epoch milliseconds")
    credits_velocity_per_hour: float = Field(..., description="Current credit burn rate per hour")
    mtd_budget_pct: float = Field(..., description="Month-to-date budget consumed as a percentage (0–100)")
    mtd_credits: float = Field(..., description="Month-to-date credits consumed")
    mtd_cost_usd: float = Field(..., description="Month-to-date cost in USD")
    today_credits: float = Field(..., description="Credits consumed today")
    today_cost_usd: float = Field(..., description="Cost today in USD")
    active_models: list[str] = Field(..., description="Models used in the current session")
    top_model: str | None = Field(None, description="Most-used model by credit consumption")
