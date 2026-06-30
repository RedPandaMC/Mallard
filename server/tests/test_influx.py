"""Tests for InfluxDB write helper — uses a mock write_api."""

from __future__ import annotations

from unittest.mock import MagicMock, call, patch

import pytest

from server.schemas import IngestPayload


@pytest.fixture()
def sample_payload() -> IngestPayload:
    return IngestPayload(
        instance_id="inst-abc",
        schema_version=2,
        ts=1_700_000_000_000,
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
    def test_write_called_once(self, sample_payload: IngestPayload) -> None:
        from server.influx import write_payload

        mock_api = MagicMock()
        write_payload(mock_api, bucket="metrics", org="mallard", payload=sample_payload)
        assert mock_api.write.call_count == 1

    def test_write_receives_correct_bucket_and_org(self, sample_payload: IngestPayload) -> None:
        from server.influx import write_payload

        mock_api = MagicMock()
        write_payload(mock_api, bucket="my-bucket", org="my-org", payload=sample_payload)

        _, kwargs = mock_api.write.call_args
        assert kwargs["bucket"] == "my-bucket"
        assert kwargs["org"] == "my-org"

    def test_point_measurement_name(self, sample_payload: IngestPayload) -> None:
        """The InfluxDB Point should use the 'mallard_metrics' measurement."""
        from influxdb_client import Point

        from server.influx import write_payload, _MEASUREMENT

        captured_points: list[Point] = []

        def capture_write(**kwargs):  # type: ignore[no-untyped-def]
            captured_points.append(kwargs["record"])

        mock_api = MagicMock()
        mock_api.write.side_effect = capture_write

        write_payload(mock_api, bucket="metrics", org="mallard", payload=sample_payload)

        assert len(captured_points) == 1
        # Point._name is the measurement name
        assert captured_points[0]._name == _MEASUREMENT

    def test_point_contains_instance_id_tag(self, sample_payload: IngestPayload) -> None:
        from server.influx import write_payload

        captured: list = []

        def capture(**kwargs):  # type: ignore[no-untyped-def]
            captured.append(kwargs["record"])

        mock_api = MagicMock()
        mock_api.write.side_effect = capture

        write_payload(mock_api, bucket="metrics", org="mallard", payload=sample_payload)

        point = captured[0]
        assert point._tags.get("instance_id") == "inst-abc"

    def test_point_contains_numeric_fields(self, sample_payload: IngestPayload) -> None:
        from server.influx import write_payload

        captured: list = []

        def capture(**kwargs):  # type: ignore[no-untyped-def]
            captured.append(kwargs["record"])

        mock_api = MagicMock()
        mock_api.write.side_effect = capture

        write_payload(mock_api, bucket="metrics", org="mallard", payload=sample_payload)

        point = captured[0]
        assert point._fields["mtd_cost_usd"] == 7.00
        assert point._fields["today_credits"] == 20.0
        assert point._fields["credits_velocity_per_hour"] == 2.5

    def test_null_top_model_stored_as_empty_string(self) -> None:
        from server.influx import write_payload
        from server.schemas import IngestPayload

        payload = IngestPayload(
            instance_id="inst-xyz",
            schema_version=2,
            ts=1_700_000_000_000,
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

        write_payload(mock_api, bucket="metrics", org="mallard", payload=payload)

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
