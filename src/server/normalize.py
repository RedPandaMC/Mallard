"""Normalizes the v1 event-stream payload into canonical event records.

Tolerant reader, conservative writer: a batch is never rejected just because
the server doesn't recognize a field — whatever can be mapped is mapped and
typed; whatever can't is preserved per event in `extra`. The only hard
requirements are a JSON object carrying `schema_version` and an `events`
list. There is exactly one wire version (v1); a *newer* schema_version is
still read best-effort with the same field names so an upgraded client keeps
working against an older server.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from .schemas import StreamBatchV1


class InvalidIngestPayload(Exception):
    """Raised only for the things that can't be worked around: a body that
    isn't a JSON object, no `schema_version`, or no usable `events` list."""


# Token fields carried per event, wire name → canonical name (identical today).
_TOKEN_FIELDS = (
    "prompt_tokens",
    "completion_tokens",
    "cache_creation_tokens",
    "cache_read_tokens",
    "thinking_tokens",
)

_KNOWN_EVENT_FIELDS = frozenset(
    ("id", "ts", "connector", "model", "surface", "credits", "cost_usd",
     "estimated", "cost_by_category", "language", "repo", "branch",
     "attribution", *_TOKEN_FIELDS)
)


@dataclass
class NormalizedEvent:
    """One usage event, typed and defaulted, ready for storage."""

    ts_ms: int
    connector: str
    model: str
    surface: str
    credits: float
    cost_usd: float
    estimated: bool
    event_id: str | None = None
    language: str | None = None
    repo: str | None = None
    branch: str | None = None
    attribution: str | None = None
    tokens: dict[str, int] = field(default_factory=dict)
    cost_by_category: dict[str, float] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class NormalizedBatch:
    schema_version: int
    instance_id: str | None
    sent_at_ms: int
    tz_offset_minutes: int | None
    events: list[NormalizedEvent] = field(default_factory=list)


KNOWN_SCHEMA_VERSIONS = [1]


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


def _normalize_event(raw: dict[str, Any], fallback_ts_ms: int) -> NormalizedEvent:
    ts = _coerce_int(raw.get("ts"))
    tokens: dict[str, int] = {}
    for name in _TOKEN_FIELDS:
        value = _coerce_int(raw.get(name))
        if value is not None:
            tokens[name] = value
    return NormalizedEvent(
        ts_ms=ts if ts is not None else fallback_ts_ms,
        connector=_coerce_str(raw.get("connector")) or "unknown",
        model=_coerce_str(raw.get("model")) or "unknown",
        surface=_coerce_str(raw.get("surface")) or "unknown",
        credits=_coerce_float(raw.get("credits")) or 0.0,
        cost_usd=_coerce_float(raw.get("cost_usd")) or 0.0,
        estimated=bool(raw.get("estimated", True)),
        event_id=_coerce_str(raw.get("id")),
        language=_coerce_str(raw.get("language")),
        repo=_coerce_str(raw.get("repo")),
        branch=_coerce_str(raw.get("branch")),
        attribution=_coerce_str(raw.get("attribution")),
        tokens=tokens,
        cost_by_category=_coerce_num_map(raw.get("cost_by_category")),
        extra={k: v for k, v in raw.items() if k not in _KNOWN_EVENT_FIELDS},
    )


def normalize_payload(raw: dict[str, Any]) -> NormalizedBatch:
    """Normalize a raw JSON body into a NormalizedBatch, or raise
    InvalidIngestPayload when the body is structurally unusable."""
    if not isinstance(raw, dict):
        raise InvalidIngestPayload("Payload must be a JSON object")
    version = raw.get("schema_version")
    if not isinstance(version, int) or isinstance(version, bool):
        raise InvalidIngestPayload("Payload must carry an integer schema_version")

    try:
        batch = StreamBatchV1.model_validate(raw)
    except ValidationError as exc:
        raise InvalidIngestPayload(f"Malformed stream batch: {exc.error_count()} invalid field(s)") from exc

    raw_events = raw.get("events")
    if not isinstance(raw_events, list):
        raise InvalidIngestPayload("Payload must carry an events list")

    sent_at = batch.sent_at if batch.sent_at is not None else int(time.time() * 1000)
    events = [_normalize_event(e, sent_at) for e in raw_events if isinstance(e, dict)]
    return NormalizedBatch(
        schema_version=version,
        instance_id=batch.instance_id,
        sent_at_ms=sent_at,
        tz_offset_minutes=batch.tz_offset_minutes,
        events=events,
    )
