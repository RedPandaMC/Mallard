"""Tests for the versioned ingest normalization pipeline (normalize.py)."""

from __future__ import annotations

import pytest

from server.normalize import (
    InvalidIngestPayload,
    KNOWN_SCHEMA_VERSIONS,
    normalize_payload,
    normalize_unknown,
    normalize_v1,
    normalize_v2,
)


class TestNormalizeV1:
    def test_maps_iso_ts_to_epoch_ms(self) -> None:
        metric = normalize_v1({"schema_version": 1, "ts": "2023-11-14T22:13:20+00:00"})
        assert metric.ts_ms == 1_700_000_000_000

    def test_no_instance_id_in_v1(self) -> None:
        metric = normalize_v1({"schema_version": 1, "ts": "2023-11-14T22:13:20+00:00"})
        assert metric.instance_id is None

    def test_source_connector_becomes_connector(self) -> None:
        metric = normalize_v1({"schema_version": 1, "ts": "2023-11-14T22:13:20+00:00", "source_connector": "claude-code"})
        assert metric.connector == "claude-code"

    def test_analytics_fields_pass_through(self) -> None:
        metric = normalize_v1({
            "schema_version": 1,
            "ts": "2023-11-14T22:13:20+00:00",
            "credits_velocity_per_hour": 1.5,
            "repo_count": 3,
            "forecast_basis": "linear",
        })
        assert metric.credits_velocity_per_hour == 1.5
        assert metric.repo_count == 3
        assert metric.forecast_basis == "linear"

    def test_distributions_captured_in_extra(self) -> None:
        metric = normalize_v1({
            "schema_version": 1,
            "ts": "2023-11-14T22:13:20+00:00",
            "model_dist": {"gpt-4o": 1.0},
        })
        assert metric.extra["model_dist"] == {"gpt-4o": 1.0}

    def test_unparseable_ts_falls_back_to_now(self) -> None:
        metric = normalize_v1({"schema_version": 1, "ts": "not-a-date"})
        assert metric.ts_ms > 0


class TestNormalizeV2:
    def test_required_fields_mapped(self) -> None:
        metric = normalize_v2({
            "schema_version": 2,
            "instance_id": "abc",
            "ts": 1_700_000_000_000,
            "mtd_credits": 100.0,
            "mtd_cost_usd": 4.0,
            "today_credits": 10.0,
            "today_cost_usd": 0.4,
            "active_models": ["gpt-4o"],
            "top_model": "gpt-4o",
        })
        assert metric.instance_id == "abc"
        assert metric.ts_ms == 1_700_000_000_000
        assert metric.mtd_credits == 100.0
        assert metric.active_models == ["gpt-4o"]

    def test_missing_optional_analytics_fields_are_none(self) -> None:
        metric = normalize_v2({
            "schema_version": 2,
            "instance_id": "abc",
            "ts": 1_700_000_000_000,
            "mtd_credits": 0,
            "mtd_cost_usd": 0,
            "today_credits": 0,
            "today_cost_usd": 0,
        })
        assert metric.repo_count is None
        assert metric.forecast_basis is None


class TestNormalizePayloadDispatch:
    def test_dispatches_v1_by_schema_version(self) -> None:
        metric = normalize_payload({"schema_version": 1, "ts": "2023-11-14T22:13:20+00:00"})
        assert metric.schema_version == 1
        assert metric.instance_id is None

    def test_dispatches_v2_by_schema_version(self) -> None:
        metric = normalize_payload({
            "schema_version": 2,
            "instance_id": "abc",
            "ts": 1_700_000_000_000,
            "mtd_credits": 0,
            "mtd_cost_usd": 0,
            "today_credits": 0,
            "today_cost_usd": 0,
        })
        assert metric.instance_id == "abc"

    def test_raises_when_schema_version_missing(self) -> None:
        with pytest.raises(InvalidIngestPayload):
            normalize_payload({"ts": 1_700_000_000_000})

    def test_raises_when_schema_version_not_an_int(self) -> None:
        with pytest.raises(InvalidIngestPayload):
            normalize_payload({"schema_version": "two"})

    def test_unknown_future_version_falls_back_to_best_effort(self) -> None:
        metric = normalize_payload({
            "schema_version": 99,
            "instance_id": "future-inst",
            "ts": 1_700_000_000_000,
            "mtd_credits": 12.5,
            "brand_new_field_the_server_has_never_seen": "surprise",
        })
        assert metric.schema_version == 99
        assert metric.instance_id == "future-inst"
        assert metric.mtd_credits == 12.5
        assert metric.extra["brand_new_field_the_server_has_never_seen"] == "surprise"

    def test_known_version_with_wrong_shape_falls_back_to_best_effort(self) -> None:
        """schema_version: 2 but missing every required v2 field — a
        malformed/corrupted message, not a version mismatch. Still ingested,
        never a hard failure."""
        metric = normalize_payload({"schema_version": 2, "today_credits": "oops-a-string"})
        assert metric.schema_version == 2
        assert metric.today_credits is None  # uncoercible, not guessed
        assert metric.extra["today_credits"] == "oops-a-string"  # but not lost either


class TestNormalizeUnknown:
    def test_never_raises_on_empty_dict_with_version(self) -> None:
        metric = normalize_unknown({"schema_version": 7})
        assert metric.schema_version == 7
        assert metric.active_models == []

    def test_coerces_float_string_to_none(self) -> None:
        metric = normalize_unknown({"schema_version": 7, "mtd_credits": "not-a-number"})
        assert metric.mtd_credits is None

    def test_uncoercible_known_field_is_preserved_in_extra(self) -> None:
        """A known field name shouldn't disqualify its value from the same
        preservation an actually-unknown field gets — losing it silently
        would defeat the point of a tolerant reader."""
        metric = normalize_unknown({"schema_version": 7, "mtd_credits": "not-a-number"})
        assert metric.extra["mtd_credits"] == "not-a-number"

    def test_coerces_int_from_whole_float(self) -> None:
        metric = normalize_unknown({"schema_version": 7, "repo_count": 3.0})
        assert metric.repo_count == 3
        assert "repo_count" not in metric.extra  # coerced successfully, not duplicated

    def test_rejects_non_integer_float_for_int_field(self) -> None:
        metric = normalize_unknown({"schema_version": 7, "repo_count": 3.5})
        assert metric.repo_count is None
        assert metric.extra["repo_count"] == 3.5

    def test_bool_not_coerced_to_number(self) -> None:
        """bool is a subclass of int in Python — must not silently become 1/0."""
        metric = normalize_unknown({"schema_version": 7, "repo_count": True})
        assert metric.repo_count is None
        assert metric.extra["repo_count"] is True

    def test_ts_falls_back_to_now_when_absent(self) -> None:
        metric = normalize_unknown({"schema_version": 7})
        assert metric.ts_ms > 0

    def test_active_models_wrong_type_becomes_empty_list(self) -> None:
        metric = normalize_unknown({"schema_version": 7, "active_models": "not-a-list"})
        assert metric.active_models == []
        assert metric.extra["active_models"] == "not-a-list"

    def test_missing_field_is_not_added_to_extra(self) -> None:
        """Absent and uncoercible are different: nothing to preserve when
        the client never sent the field at all."""
        metric = normalize_unknown({"schema_version": 7})
        assert "mtd_credits" not in metric.extra

    def test_empty_active_models_list_is_not_treated_as_a_failure(self) -> None:
        """A genuinely empty list is a valid value, not a coercion failure —
        it must not get duplicated into extra."""
        metric = normalize_unknown({"schema_version": 7, "active_models": []})
        assert metric.active_models == []
        assert "active_models" not in metric.extra


def test_known_schema_versions_sorted() -> None:
    assert KNOWN_SCHEMA_VERSIONS == sorted(KNOWN_SCHEMA_VERSIONS)
    assert 1 in KNOWN_SCHEMA_VERSIONS
    assert 2 in KNOWN_SCHEMA_VERSIONS
