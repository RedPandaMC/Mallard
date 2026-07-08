"""Normalizes every known (and unknown) wire version into one canonical shape.

Tolerant reader, conservative writer: a client is never rejected just
because the server doesn't yet recognize a field or a `schema_version` —
whatever can be mapped is mapped and typed; whatever can't is preserved in
`extra` rather than discarded, so a future server version can make sense of
it without needing the client to resend. The only thing every version must
carry is `schema_version` itself; that's the one thing worth rejecting a
request over. This lets the extension evolve ahead of the server: an old
server still accepts a newer client's payload in degraded mode.

v3 is the only known version — nothing shipped with v1/v2, so there is no
legacy traffic to keep decoding.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable

from pydantic import ValidationError

from .schemas import IngestPayloadV3


class InvalidIngestPayload(Exception):
    """Raised only for the one thing that can't be worked around: a payload
    with no `schema_version` at all, or a body that isn't a JSON object."""


@dataclass
class NormalizedMetric:
    schema_version: int
    instance_id: str | None
    ts_ms: int
    connector: str | None = None
    tz_offset_minutes: int | None = None

    # Gauges — last() per instance
    mtd_budget_pct: float | None = None
    mtd_credits: float | None = None
    mtd_cost_usd: float | None = None
    today_credits: float | None = None
    today_cost_usd: float | None = None
    forecast_basis: str | None = None
    forecast_low: float | None = None
    forecast_high: float | None = None
    budget_trend: int | None = None
    daily_credit_stddev: float | None = None

    # Counters — additive across instances
    total_credits: float | None = None
    total_tokens: float | None = None
    total_event_count: int | None = None
    estimated_event_count: int | None = None
    model_credits: dict[str, float] = field(default_factory=dict)
    surface_credits: dict[str, float] = field(default_factory=dict)
    # Heuristic client-side detection (active editor at parse time) — directional.
    language_credits: dict[str, float] = field(default_factory=dict)
    cost_by_category: dict[str, float] = field(default_factory=dict)

    # Dimension metadata
    active_models: list[str] = field(default_factory=list)
    top_model: str | None = None
    model_count: int | None = None
    repo_count: int | None = None

    extra: dict[str, Any] = field(default_factory=dict)


def _extra_fields(raw: dict[str, Any], known: frozenset[str]) -> dict[str, Any]:
    return {k: v for k, v in raw.items() if k not in known}


_KNOWN_V3_FIELDS = frozenset(IngestPayloadV3.model_fields.keys())


def normalize_v3(raw: dict[str, Any]) -> NormalizedMetric:
    payload = IngestPayloadV3.model_validate(raw)
    extra = _extra_fields(raw, _KNOWN_V3_FIELDS)
    return NormalizedMetric(
        schema_version=payload.schema_version,
        instance_id=payload.instance_id,
        ts_ms=payload.ts,
        connector=payload.source_connector,
        tz_offset_minutes=payload.tz_offset_minutes,
        mtd_budget_pct=payload.mtd_budget_pct,
        mtd_credits=payload.mtd_credits,
        mtd_cost_usd=payload.mtd_cost_usd,
        today_credits=payload.today_credits,
        today_cost_usd=payload.today_cost_usd,
        forecast_basis=payload.forecast_basis,
        forecast_low=payload.forecast_low,
        forecast_high=payload.forecast_high,
        budget_trend=payload.budget_trend,
        daily_credit_stddev=payload.daily_credit_stddev,
        total_credits=payload.total_credits,
        total_tokens=payload.total_tokens,
        total_event_count=payload.total_event_count,
        estimated_event_count=payload.estimated_event_count,
        model_credits=_coerce_num_map(payload.model_credits),
        surface_credits=_coerce_num_map(payload.surface_credits),
        language_credits=_coerce_num_map(payload.language_credits),
        cost_by_category=_coerce_num_map(payload.cost_by_category),
        active_models=payload.active_models,
        top_model=payload.top_model,
        model_count=payload.model_count,
        repo_count=payload.repo_count,
        extra=extra,
    )


_NORMALIZERS: dict[int, Callable[[dict[str, Any]], NormalizedMetric]] = {
    3: normalize_v3,
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


def _coerce_num_map(v: Any) -> dict[str, float]:
    """Keep only string→number entries of a mapping; anything else is dropped."""
    if not isinstance(v, dict):
        return {}
    out: dict[str, float] = {}
    for k, val in v.items():
        num = _coerce_float(val)
        if isinstance(k, str) and num is not None:
            out[k] = num
    return out


def _coerce_ts_ms(raw: dict[str, Any]) -> int:
    ts = raw.get("ts")
    if isinstance(ts, (int, float)) and not isinstance(ts, bool):
        return int(ts)
    # No usable timestamp — fall back to receipt time rather than reject the payload.
    return int(time.time() * 1000)


def normalize_unknown(raw: dict[str, Any]) -> NormalizedMetric:
    """Best-effort mapping for a `schema_version` this server doesn't know
    about yet (a newer client than this server has seen), or for a known
    version whose payload didn't actually match its expected shape. Maps
    every field it recognizes by name with a permissive type coercion;
    anything it can't confidently coerce is dropped from the typed fields
    but kept in `extra`, and never raises."""
    version = raw.get("schema_version")
    extra = _extra_fields(raw, _KNOWN_V3_FIELDS)

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
        # Keep only string entries: a non-string element (e.g. a number from a
        # malformed client) would otherwise crash ",".join(active_models) in
        # influx.py and surface as a misleading retryable 503. Consistent with
        # the tolerant-reader contract (never raise), the original list is kept
        # in `extra` when anything was dropped so nothing is silently lost.
        active_models = [m for m in active_models_raw if isinstance(m, str)]
        if len(active_models) != len(active_models_raw):
            extra["active_models"] = active_models_raw
    else:
        active_models = []
        if active_models_raw is not None:
            extra["active_models"] = active_models_raw

    return NormalizedMetric(
        schema_version=version if isinstance(version, int) else -1,
        instance_id=coerce("instance_id", _coerce_str),
        ts_ms=_coerce_ts_ms(raw),
        connector=coerce("source_connector", _coerce_str),
        tz_offset_minutes=coerce("tz_offset_minutes", _coerce_int),
        mtd_budget_pct=coerce("mtd_budget_pct", _coerce_float),
        mtd_credits=coerce("mtd_credits", _coerce_float),
        mtd_cost_usd=coerce("mtd_cost_usd", _coerce_float),
        today_credits=coerce("today_credits", _coerce_float),
        today_cost_usd=coerce("today_cost_usd", _coerce_float),
        forecast_basis=coerce("forecast_basis", _coerce_str),
        forecast_low=coerce("forecast_low", _coerce_float),
        forecast_high=coerce("forecast_high", _coerce_float),
        budget_trend=coerce("budget_trend", _coerce_int),
        daily_credit_stddev=coerce("daily_credit_stddev", _coerce_float),
        total_credits=coerce("total_credits", _coerce_float),
        total_tokens=coerce("total_tokens", _coerce_float),
        total_event_count=coerce("total_event_count", _coerce_int),
        estimated_event_count=coerce("estimated_event_count", _coerce_int),
        model_credits=_coerce_num_map(raw.get("model_credits")),
        surface_credits=_coerce_num_map(raw.get("surface_credits")),
        language_credits=_coerce_num_map(raw.get("language_credits")),
        cost_by_category=_coerce_num_map(raw.get("cost_by_category")),
        active_models=active_models,
        top_model=coerce("top_model", _coerce_str),
        model_count=coerce("model_count", _coerce_int),
        repo_count=coerce("repo_count", _coerce_int),
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
