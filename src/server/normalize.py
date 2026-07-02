"""Normalizes every known (and unknown) wire version into one canonical shape.

Tolerant reader, conservative writer: a client is never rejected just
because the server doesn't yet recognize a field or a `schema_version` —
whatever can be mapped is mapped and typed; whatever can't is preserved in
`extra` rather than discarded, so a future server version can make sense of
it without needing the client to resend. The only thing every version must
carry is `schema_version` itself; that's the one thing worth rejecting a
request over. This lets the extension and server evolve independently: an
old server still accepts a newer client's payload in degraded mode, and a
new server still fully understands an old client's payload.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from pydantic import ValidationError

from .schemas import IngestPayloadV1, IngestPayloadV2


class InvalidIngestPayload(Exception):
    """Raised only for the one thing that can't be worked around: a payload
    with no `schema_version` at all, or a body that isn't a JSON object."""


@dataclass
class NormalizedMetric:
    schema_version: int
    instance_id: str | None
    ts_ms: int
    connector: str | None = None
    credits_velocity_per_hour: float | None = None
    mtd_budget_pct: float | None = None
    mtd_credits: float | None = None
    mtd_cost_usd: float | None = None
    today_credits: float | None = None
    today_cost_usd: float | None = None
    active_models: list[str] = field(default_factory=list)
    top_model: str | None = None
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
    extra: dict[str, Any] = field(default_factory=dict)


def _iso_to_epoch_ms(ts: str) -> int:
    """ISO-8601 → epoch ms. Naive timestamps (no offset, no 'Z') are treated as
    UTC — interpreting them in the server's local timezone would silently shift
    the point by the host's UTC offset."""
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _extra_fields(raw: dict[str, Any], known: frozenset[str]) -> dict[str, Any]:
    return {k: v for k, v in raw.items() if k not in known}


_KNOWN_V1_FIELDS = frozenset(IngestPayloadV1.model_fields.keys())
_KNOWN_V2_FIELDS = frozenset(IngestPayloadV2.model_fields.keys())


def normalize_v1(raw: dict[str, Any]) -> NormalizedMetric:
    payload = IngestPayloadV1.model_validate(raw)
    extra = _extra_fields(raw, _KNOWN_V1_FIELDS)
    for dist_name in ("model_dist", "surface_dist", "cost_dist"):
        dist = getattr(payload, dist_name)
        if dist:
            extra[dist_name] = dist
    try:
        ts_ms = _iso_to_epoch_ms(payload.ts)
    except ValueError:
        ts_ms = int(time.time() * 1000)
    return NormalizedMetric(
        schema_version=payload.schema_version,
        instance_id=None,
        ts_ms=ts_ms,
        connector=payload.source_connector,
        credits_velocity_per_hour=payload.credits_velocity_per_hour,
        mtd_budget_pct=payload.mtd_budget_pct,
        repo_count=payload.repo_count,
        peak_usage_hour=payload.peak_usage_hour,
        daily_credit_variance=payload.daily_credit_variance,
        model_count=payload.model_count,
        surface_concentration=payload.surface_concentration,
        estimated_event_ratio=payload.estimated_event_ratio,
        forecast_basis=payload.forecast_basis,
        budget_trend=payload.budget_trend,
        token_per_credit=payload.token_per_credit,
        forecast_low=payload.forecast_low,
        forecast_high=payload.forecast_high,
        extra=extra,
    )


def normalize_v2(raw: dict[str, Any]) -> NormalizedMetric:
    payload = IngestPayloadV2.model_validate(raw)
    extra = _extra_fields(raw, _KNOWN_V2_FIELDS)
    for dist_name in ("model_dist", "surface_dist", "cost_dist"):
        dist = getattr(payload, dist_name)
        if dist:
            extra[dist_name] = dist
    return NormalizedMetric(
        schema_version=payload.schema_version,
        instance_id=payload.instance_id,
        ts_ms=payload.ts,
        connector=payload.source_connector,
        credits_velocity_per_hour=payload.credits_velocity_per_hour,
        mtd_budget_pct=payload.mtd_budget_pct,
        mtd_credits=payload.mtd_credits,
        mtd_cost_usd=payload.mtd_cost_usd,
        today_credits=payload.today_credits,
        today_cost_usd=payload.today_cost_usd,
        active_models=payload.active_models,
        top_model=payload.top_model,
        repo_count=payload.repo_count,
        peak_usage_hour=payload.peak_usage_hour,
        daily_credit_variance=payload.daily_credit_variance,
        model_count=payload.model_count,
        surface_concentration=payload.surface_concentration,
        estimated_event_ratio=payload.estimated_event_ratio,
        forecast_basis=payload.forecast_basis,
        budget_trend=payload.budget_trend,
        token_per_credit=payload.token_per_credit,
        forecast_low=payload.forecast_low,
        forecast_high=payload.forecast_high,
        extra=extra,
    )


_NORMALIZERS: dict[int, Callable[[dict[str, Any]], NormalizedMetric]] = {
    1: normalize_v1,
    2: normalize_v2,
}

KNOWN_SCHEMA_VERSIONS = sorted(_NORMALIZERS)


def _coerce_float(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _coerce_int(v: Any) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return None


def _coerce_str(v: Any) -> str | None:
    return v if isinstance(v, str) else None


def _coerce_ts_ms(raw: dict[str, Any]) -> int:
    ts = raw.get("ts")
    if isinstance(ts, (int, float)) and not isinstance(ts, bool):
        return int(ts)
    if isinstance(ts, str):
        try:
            return _iso_to_epoch_ms(ts)
        except ValueError:
            pass
    # No usable timestamp — fall back to receipt time rather than reject the payload.
    return int(time.time() * 1000)


_BEST_EFFORT_KNOWN_FIELDS = frozenset(_KNOWN_V1_FIELDS | _KNOWN_V2_FIELDS)


def normalize_unknown(raw: dict[str, Any]) -> NormalizedMetric:
    """Best-effort mapping for a `schema_version` this server doesn't know
    about yet (a newer client than this server has seen), or for a known
    version whose payload didn't actually match its expected shape. Maps
    every field it recognizes by name with a permissive type coercion;
    anything it can't confidently coerce is dropped from the typed fields
    but kept in `extra`, and never raises."""
    version = raw.get("schema_version")
    extra = _extra_fields(raw, _BEST_EFFORT_KNOWN_FIELDS)

    def coerce(name: str, coercer: Callable[[Any], Any]) -> Any:
        """Coerce a known field by its raw key name. If the field was
        present but didn't survive coercion, keep the original value in
        `extra` instead of losing it outright — a name being "known"
        shouldn't disqualify its value from the same preservation an
        actually-unknown field gets."""
        value = raw.get(name)
        coerced = coercer(value)
        if coerced is None and value is not None:
            extra[name] = value
        return coerced

    active_models_raw = raw.get("active_models")
    if isinstance(active_models_raw, list):
        active_models = active_models_raw
    else:
        active_models = []
        if active_models_raw is not None:
            extra["active_models"] = active_models_raw

    return NormalizedMetric(
        schema_version=version if isinstance(version, int) else -1,
        instance_id=coerce("instance_id", _coerce_str),
        ts_ms=_coerce_ts_ms(raw),
        connector=coerce("source_connector", _coerce_str),
        credits_velocity_per_hour=coerce("credits_velocity_per_hour", _coerce_float),
        mtd_budget_pct=coerce("mtd_budget_pct", _coerce_float),
        mtd_credits=coerce("mtd_credits", _coerce_float),
        mtd_cost_usd=coerce("mtd_cost_usd", _coerce_float),
        today_credits=coerce("today_credits", _coerce_float),
        today_cost_usd=coerce("today_cost_usd", _coerce_float),
        active_models=active_models,
        top_model=coerce("top_model", _coerce_str),
        repo_count=coerce("repo_count", _coerce_int),
        peak_usage_hour=coerce("peak_usage_hour", _coerce_int),
        daily_credit_variance=coerce("daily_credit_variance", _coerce_float),
        model_count=coerce("model_count", _coerce_int),
        surface_concentration=coerce("surface_concentration", _coerce_float),
        estimated_event_ratio=coerce("estimated_event_ratio", _coerce_float),
        forecast_basis=coerce("forecast_basis", _coerce_str),
        budget_trend=coerce("budget_trend", _coerce_int),
        token_per_credit=coerce("token_per_credit", _coerce_float),
        forecast_low=coerce("forecast_low", _coerce_float),
        forecast_high=coerce("forecast_high", _coerce_float),
        extra=extra,
    )


def normalize_payload(raw: dict[str, Any]) -> NormalizedMetric:
    """Dispatch *raw* to the normalizer for its `schema_version`, falling
    back to best-effort handling for a version this server doesn't
    recognize, or one that claimed a known version but didn't match its
    shape. Raises `InvalidIngestPayload` only when there's no
    `schema_version` to dispatch on at all."""
    version = raw.get("schema_version")
    if not isinstance(version, int):
        raise InvalidIngestPayload("Payload must include an integer 'schema_version'")

    normalizer = _NORMALIZERS.get(version)
    if normalizer is None:
        return normalize_unknown(raw)
    try:
        return normalizer(raw)
    except ValidationError:
        return normalize_unknown(raw)
