"""Tests for payload normalization (v3 + tolerant handling of everything else)."""

from __future__ import annotations

import time

import pytest

from server.normalize import (
    KNOWN_SCHEMA_VERSIONS,
    InvalidIngestPayload,
    normalize_payload,
    normalize_unknown,
    normalize_v3,
)


def v3_payload(**overrides: object) -> dict:
    base: dict = {
        "schema_version": 3,
        "instance_id": "abc123",
        "ts": 1_700_000_000_000,
        "tz_offset_minutes": 120,
        "mtd_credits": 100.0,
        "mtd_cost_usd": 4.0,
        "today_credits": 10.0,
        "today_cost_usd": 0.4,
        "mtd_budget_pct": 42.0,
        "forecast_basis": "linear",
        "forecast_low": 120.0,
        "forecast_high": 160.0,
        "budget_trend": 1,
        "daily_credit_stddev": 2.5,
        "total_credits": 30.0,
        "total_tokens": 9000,
        "total_event_count": 12,
        "estimated_event_count": 9,
        "model_credits": {"claude-sonnet-4-5": 18.0, "gpt-4o": 12.0},
        "surface_credits": {"agent": 18.0, "chat": 12.0},
        "cost_by_category": {"input": 0.5, "output": 0.7},
        "active_models": ["claude-sonnet-4-5", "gpt-4o"],
        "top_model": "claude-sonnet-4-5",
        "model_count": 2,
        "repo_count": 1,
        "source_connector": "claude-code",
    }
    base.update(overrides)
    return base


class TestNormalizeV3:
    def test_all_fields_mapped(self) -> None:
        m = normalize_v3(v3_payload())
        assert m.schema_version == 3
        assert m.instance_id == "abc123"
        assert m.ts_ms == 1_700_000_000_000
        assert m.tz_offset_minutes == 120
        assert m.connector == "claude-code"
        assert m.mtd_credits == 100.0
        assert m.today_cost_usd == 0.4
        assert m.daily_credit_stddev == 2.5
        assert m.total_credits == 30.0
        assert m.total_event_count == 12
        assert m.estimated_event_count == 9
        assert m.model_credits == {"claude-sonnet-4-5": 18.0, "gpt-4o": 12.0}
        assert m.surface_credits == {"agent": 18.0, "chat": 12.0}
        assert m.cost_by_category == {"input": 0.5, "output": 0.7}
        assert m.active_models == ["claude-sonnet-4-5", "gpt-4o"]
        assert m.top_model == "claude-sonnet-4-5"

    def test_missing_optional_fields_are_none_or_empty(self) -> None:
        minimal = {
            "schema_version": 3,
            "instance_id": "abc",
            "ts": 1_700_000_000_000,
            "mtd_credits": 1.0,
            "mtd_cost_usd": 0.04,
            "today_credits": 0.0,
            "today_cost_usd": 0.0,
        }
        m = normalize_v3(minimal)
        assert m.tz_offset_minutes is None
        assert m.forecast_basis is None
        assert m.total_event_count is None
        assert m.model_credits == {}
        assert m.active_models == []

    def test_unknown_fields_preserved_in_extra(self) -> None:
        m = normalize_v3(v3_payload(brand_new_field="hello"))
        assert m.extra["brand_new_field"] == "hello"

    def test_non_numeric_map_entries_dropped(self) -> None:
        m = normalize_v3(v3_payload(model_credits={"good": 1.5, "bad": "NaN-ish"}))
        assert m.model_credits == {"good": 1.5}


class TestNormalizePayloadDispatch:
    def test_dispatches_v3_by_schema_version(self) -> None:
        m = normalize_payload(v3_payload())
        assert m.schema_version == 3
        assert m.instance_id == "abc123"

    def test_raises_when_schema_version_missing(self) -> None:
        with pytest.raises(InvalidIngestPayload):
            normalize_payload({"instance_id": "x"})

    def test_raises_when_schema_version_not_an_int(self) -> None:
        with pytest.raises(InvalidIngestPayload):
            normalize_payload({"schema_version": "three"})

    def test_unknown_future_version_falls_back_to_best_effort(self) -> None:
        m = normalize_payload(v3_payload(schema_version=99, hyper_metric=42))
        assert m.schema_version == 99
        assert m.instance_id == "abc123"
        assert m.extra["hyper_metric"] == 42

    def test_retired_v2_version_is_handled_best_effort_not_rejected(self) -> None:
        # v1/v2 never shipped, but a stray old build must still get a 202-path
        # normalization rather than an error.
        m = normalize_payload(
            {
                "schema_version": 2,
                "instance_id": "old",
                "ts": 1_700_000_000_000,
                "mtd_credits": 5.0,
                "estimated_event_ratio": 0.5,
            }
        )
        assert m.schema_version == 2
        assert m.instance_id == "old"
        assert m.mtd_credits == 5.0
        # Retired v2-only fields are preserved, not typed
        assert m.extra["estimated_event_ratio"] == 0.5

    def test_known_version_with_wrong_shape_falls_back_to_best_effort(self) -> None:
        # Claims v3 but misses required fields — degraded handling, not a 4xx.
        m = normalize_payload({"schema_version": 3, "instance_id": "x"})
        assert m.schema_version == 3
        assert m.instance_id == "x"


class TestNormalizeUnknown:
    def test_never_raises_on_empty_dict_with_version(self) -> None:
        m = normalize_unknown({"schema_version": 42})
        assert m.schema_version == 42
        assert m.instance_id is None

    def test_ts_falls_back_to_now_when_absent(self) -> None:
        before = int(time.time() * 1000)
        m = normalize_unknown({"schema_version": 9})
        after = int(time.time() * 1000)
        assert before <= m.ts_ms <= after

    def test_coerces_float_string_to_none(self) -> None:
        m = normalize_unknown({"schema_version": 9, "mtd_credits": "12.5"})
        assert m.mtd_credits is None

    def test_uncoercible_known_field_is_preserved_in_extra(self) -> None:
        m = normalize_unknown({"schema_version": 9, "mtd_credits": "12.5"})
        assert m.extra["mtd_credits"] == "12.5"

    def test_coerces_int_from_whole_float(self) -> None:
        m = normalize_unknown({"schema_version": 9, "repo_count": 3.0})
        assert m.repo_count == 3

    def test_rejects_non_integer_float_for_int_field(self) -> None:
        m = normalize_unknown({"schema_version": 9, "repo_count": 3.7})
        assert m.repo_count is None

    def test_bool_not_coerced_to_number(self) -> None:
        m = normalize_unknown({"schema_version": 9, "mtd_credits": True, "repo_count": False})
        assert m.mtd_credits is None
        assert m.repo_count is None

    def test_active_models_wrong_type_becomes_empty_list(self) -> None:
        m = normalize_unknown({"schema_version": 9, "active_models": "not-a-list"})
        assert m.active_models == []
        assert m.extra["active_models"] == "not-a-list"

    def test_counter_maps_coerced_best_effort(self) -> None:
        m = normalize_unknown(
            {"schema_version": 9, "model_credits": {"a": 1, "b": "x"}, "surface_credits": "junk"}
        )
        assert m.model_credits == {"a": 1.0}
        assert m.surface_credits == {}

    def test_missing_field_is_not_added_to_extra(self) -> None:
        m = normalize_unknown({"schema_version": 9})
        assert "mtd_credits" not in m.extra

    def test_string_ts_is_not_parsed_in_v3_world(self) -> None:
        # v3 requires epoch ms; a string ts falls back to receipt time.
        before = int(time.time() * 1000)
        m = normalize_unknown({"schema_version": 9, "ts": "2026-01-15T12:00:00Z"})
        assert m.ts_ms >= before


def test_known_schema_versions_is_exactly_v3() -> None:
    assert KNOWN_SCHEMA_VERSIONS == [3]
