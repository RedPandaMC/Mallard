"""Tests for the v1 event-stream normalizer."""

from __future__ import annotations

import pytest

from server.normalize import (
    KNOWN_SCHEMA_VERSIONS,
    InvalidIngestPayload,
    NormalizedBatch,
    normalize_payload,
)


def _batch(**overrides) -> dict:
    base = {
        "schema_version": 1,
        "instance_id": "abc123",
        "sent_at": 1_700_000_000_500,
        "tz_offset_minutes": 120,
        "events": [
            {
                "id": "local:f1:span-1",
                "ts": 1_700_000_000_000,
                "connector": "local",
                "model": "claude-sonnet-4-5",
                "surface": "agent",
                "credits": 5.0,
                "cost_usd": 0.2,
                "estimated": True,
                "prompt_tokens": 100,
                "completion_tokens": 40,
                "cost_by_category": {"input": 0.12, "output": 0.08},
                "language": "typescript",
            }
        ],
    }
    base.update(overrides)
    return base


class TestNormalizeBatch:
    def test_known_versions_is_exactly_v1(self) -> None:
        assert KNOWN_SCHEMA_VERSIONS == [1]

    def test_maps_batch_and_event_fields(self) -> None:
        batch = normalize_payload(_batch())
        assert isinstance(batch, NormalizedBatch)
        assert batch.schema_version == 1
        assert batch.instance_id == "abc123"
        assert batch.sent_at_ms == 1_700_000_000_500
        assert batch.tz_offset_minutes == 120
        assert len(batch.events) == 1
        e = batch.events[0]
        assert e.ts_ms == 1_700_000_000_000
        assert e.connector == "local"
        assert e.model == "claude-sonnet-4-5"
        assert e.surface == "agent"
        assert e.credits == 5.0
        assert e.cost_usd == 0.2
        assert e.estimated is True
        assert e.event_id == "local:f1:span-1"
        assert e.language == "typescript"
        assert e.tokens == {"prompt_tokens": 100, "completion_tokens": 40}
        assert e.cost_by_category == {"input": 0.12, "output": 0.08}
        assert e.extra == {}

    def test_unknown_event_fields_preserved_in_extra(self) -> None:
        raw = _batch()
        raw["events"][0]["a_future_field"] = {"nested": True}
        e = normalize_payload(raw).events[0]
        assert e.extra == {"a_future_field": {"nested": True}}

    def test_missing_event_fields_get_safe_defaults(self) -> None:
        e = normalize_payload(_batch(events=[{}])).events[0]
        assert e.ts_ms == 1_700_000_000_500  # falls back to sent_at
        assert e.connector == "unknown"
        assert e.model == "unknown"
        assert e.surface == "unknown"
        assert e.credits == 0.0
        assert e.cost_usd == 0.0
        assert e.estimated is True
        assert e.event_id is None
        assert e.language is None

    def test_missing_sent_at_falls_back_to_receipt_time(self) -> None:
        raw = _batch()
        del raw["sent_at"]
        batch = normalize_payload(raw)
        assert batch.sent_at_ms > 1_700_000_000_000

    def test_wrongly_typed_numbers_are_dropped_not_fatal(self) -> None:
        raw = _batch()
        raw["events"][0]["credits"] = "many"
        raw["events"][0]["prompt_tokens"] = 1.5
        e = normalize_payload(raw).events[0]
        assert e.credits == 0.0
        assert "prompt_tokens" not in e.tokens

    def test_non_object_events_are_skipped(self) -> None:
        raw = _batch(events=[{"credits": 1.0}, "junk", 42, None])
        batch = normalize_payload(raw)
        assert len(batch.events) == 1

    def test_newer_schema_version_read_best_effort(self) -> None:
        batch = normalize_payload(_batch(schema_version=99))
        assert batch.schema_version == 99
        assert len(batch.events) == 1

    def test_missing_schema_version_raises(self) -> None:
        raw = _batch()
        del raw["schema_version"]
        with pytest.raises(InvalidIngestPayload):
            normalize_payload(raw)

    def test_boolean_schema_version_raises(self) -> None:
        with pytest.raises(InvalidIngestPayload):
            normalize_payload(_batch(schema_version=True))

    def test_missing_events_list_raises(self) -> None:
        raw = _batch()
        del raw["events"]
        with pytest.raises(InvalidIngestPayload):
            normalize_payload(raw)

    def test_events_wrong_type_raises(self) -> None:
        with pytest.raises(InvalidIngestPayload):
            normalize_payload(_batch(events="nope"))

    def test_non_dict_body_raises(self) -> None:
        with pytest.raises(InvalidIngestPayload):
            normalize_payload([1, 2, 3])  # type: ignore[arg-type]
