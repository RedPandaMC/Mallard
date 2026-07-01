"""Tests for InfluxDB write helper — uses a mock write_api."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from server.normalize import NormalizedMetric


@pytest.fixture()
def sample_metric() -> NormalizedMetric:
    return NormalizedMetric(
        schema_version=2,
        instance_id="inst-abc",
        ts_ms=1_700_000_000_000,
        connector="copilot",
        credits_velocity_per_hour=2.5,
        mtd_budget_pct=55.0,
        mtd_credits=200.0,
        mtd_cost_usd=7.00,
        today_credits=20.0,
        today_cost_usd=0.70,
        active_models=["claude-sonnet-4-5"],
        top_model="claude-sonnet-4-5",
    )


class TestWritePayload:
    def test_write_called_once(self, sample_metric: NormalizedMetric) -> None:
        from server.influx import write_payload

        mock_api = MagicMock()
        write_payload(mock_api, bucket="metrics", org="mallard", metric=sample_metric)
        assert mock_api.write.call_count == 1

    def test_write_receives_correct_bucket_and_org(self, sample_metric: NormalizedMetric) -> None:
        from server.influx import write_payload

        mock_api = MagicMock()
        write_payload(mock_api, bucket="my-bucket", org="my-org", metric=sample_metric)

        _, kwargs = mock_api.write.call_args
        assert kwargs["bucket"] == "my-bucket"
        assert kwargs["org"] == "my-org"

    def test_point_measurement_name(self, sample_metric: NormalizedMetric) -> None:
        """The InfluxDB Point should use the 'mallard_metrics' measurement."""
        from influxdb_client import Point

        from server.influx import _MEASUREMENT, write_payload

        captured_points: list[Point] = []

        def capture_write(**kwargs):  # type: ignore[no-untyped-def]
            captured_points.append(kwargs["record"])

        mock_api = MagicMock()
        mock_api.write.side_effect = capture_write

        write_payload(mock_api, bucket="metrics", org="mallard", metric=sample_metric)

        assert len(captured_points) == 1
        # Point._name is the measurement name
        assert captured_points[0]._name == _MEASUREMENT

    def test_point_contains_instance_id_and_connector_tags(self, sample_metric: NormalizedMetric) -> None:
        from server.influx import write_payload

        captured: list = []

        def capture(**kwargs):  # type: ignore[no-untyped-def]
            captured.append(kwargs["record"])

        mock_api = MagicMock()
        mock_api.write.side_effect = capture

        write_payload(mock_api, bucket="metrics", org="mallard", metric=sample_metric)

        point = captured[0]
        assert point._tags.get("instance_id") == "inst-abc"
        assert point._tags.get("connector") == "copilot"

    def test_missing_instance_id_and_connector_tagged_unknown(self) -> None:
        from server.influx import write_payload

        metric = NormalizedMetric(schema_version=1, instance_id=None, ts_ms=1_700_000_000_000, connector=None)
        captured: list = []
        mock_api = MagicMock()
        mock_api.write.side_effect = lambda **kw: captured.append(kw["record"])

        write_payload(mock_api, bucket="metrics", org="mallard", metric=metric)

        point = captured[0]
        assert point._tags.get("instance_id") == "unknown"
        assert point._tags.get("connector") == "unknown"

    def test_point_contains_numeric_fields(self, sample_metric: NormalizedMetric) -> None:
        from server.influx import write_payload

        captured: list = []

        def capture(**kwargs):  # type: ignore[no-untyped-def]
            captured.append(kwargs["record"])

        mock_api = MagicMock()
        mock_api.write.side_effect = capture

        write_payload(mock_api, bucket="metrics", org="mallard", metric=sample_metric)

        point = captured[0]
        assert point._fields["mtd_cost_usd"] == 7.00
        assert point._fields["today_credits"] == 20.0
        assert point._fields["credits_velocity_per_hour"] == 2.5

    def test_none_fields_are_omitted_not_zeroed(self) -> None:
        """A field a given schema version never supplied should be absent
        from the point, not silently written as 0."""
        from server.influx import write_payload

        metric = NormalizedMetric(schema_version=1, instance_id=None, ts_ms=1_700_000_000_000, connector="claude-code")
        captured: list = []
        mock_api = MagicMock()
        mock_api.write.side_effect = lambda **kw: captured.append(kw["record"])

        write_payload(mock_api, bucket="metrics", org="mallard", metric=metric)

        point = captured[0]
        assert "mtd_cost_usd" not in point._fields
        assert "today_credits" not in point._fields

    def test_extra_fields_stored_as_json(self) -> None:
        from server.influx import write_payload

        metric = NormalizedMetric(
            schema_version=3,
            instance_id="inst-future",
            ts_ms=1_700_000_000_000,
            connector="copilot",
            extra={"some_new_field": 42, "model_dist": {"gpt-4o": 0.6}},
        )
        captured: list = []
        mock_api = MagicMock()
        mock_api.write.side_effect = lambda **kw: captured.append(kw["record"])

        write_payload(mock_api, bucket="metrics", org="mallard", metric=metric)

        point = captured[0]
        stored = json.loads(point._fields["extra_json"])
        assert stored["some_new_field"] == 42
        assert stored["model_dist"] == {"gpt-4o": 0.6}

    def test_no_extra_json_field_when_extra_is_empty(self, sample_metric: NormalizedMetric) -> None:
        from server.influx import write_payload

        captured: list = []
        mock_api = MagicMock()
        mock_api.write.side_effect = lambda **kw: captured.append(kw["record"])

        write_payload(mock_api, bucket="metrics", org="mallard", metric=sample_metric)

        assert "extra_json" not in captured[0]._fields

    def test_null_top_model_stored_as_empty_string(self) -> None:
        from server.influx import write_payload

        metric = NormalizedMetric(
            schema_version=2,
            instance_id="inst-xyz",
            ts_ms=1_700_000_000_000,
            connector="copilot",
            credits_velocity_per_hour=0.0,
            mtd_budget_pct=0.0,
            mtd_credits=0.0,
            mtd_cost_usd=0.0,
            today_credits=0.0,
            today_cost_usd=0.0,
            active_models=[],
            top_model=None,
        )

        captured: list = []

        def capture(**kwargs):  # type: ignore[no-untyped-def]
            captured.append(kwargs["record"])

        mock_api = MagicMock()
        mock_api.write.side_effect = capture

        write_payload(mock_api, bucket="metrics", org="mallard", metric=metric)

        point = captured[0]
        assert point._fields["top_model"] == ""


class TestMakeClient:
    def test_make_client_passes_url_token_org(self) -> None:
        from unittest.mock import patch

        from server.config import Settings

        settings = Settings(
            influx_url="http://myinflux:8086",
            influx_token="mytoken",
            influx_org="myorg",
            influx_bucket="mybucket",
            api_keys="k1",
        )

        with patch("server.influx.InfluxDBClient") as MockClient:
            from server.influx import make_client

            make_client(settings)
            MockClient.assert_called_once_with(
                url="http://myinflux:8086",
                token="mytoken",
                org="myorg",
            )


class TestPingInflux:
    @pytest.mark.asyncio
    async def test_ping_returns_true_on_success(self) -> None:
        from server.influx import ping_influx

        mock_client = MagicMock()
        mock_client.ping.return_value = True
        result = await ping_influx(mock_client)
        assert result is True

    @pytest.mark.asyncio
    async def test_ping_returns_false_on_exception(self) -> None:
        from server.influx import ping_influx

        mock_client = MagicMock()
        mock_client.ping.side_effect = Exception("connection refused")
        result = await ping_influx(mock_client)
        assert result is False
