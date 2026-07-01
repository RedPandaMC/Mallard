"""Live InfluxDB write/read test — exercises the real client, not a mock.

Every other Influx-touching test in this suite (test_influx.py, the `client`
fixture in conftest.py) mocks `server.influx.make_client`/the write_api, so
nothing today actually performs a real InfluxDB write or read. server.yml's
`test` job already runs a live `influxdb:2` service container for this
purpose; this test is the first thing that actually uses it.

Skips automatically when INFLUX_URL isn't set or isn't reachable, so a plain
local `pytest` run without Docker still passes.
"""

from __future__ import annotations

import os
import time
import uuid
from typing import Iterator

import pytest
from influxdb_client import InfluxDBClient
from influxdb_client.client.write_api import SYNCHRONOUS, WriteApi

from server.influx import _MEASUREMENT, write_payload
from server.normalize import NormalizedMetric

LiveInflux = tuple[InfluxDBClient, WriteApi, str, str]


def _live_influx_settings() -> tuple[str, str, str, str] | None:
    url = os.environ.get("INFLUX_URL", "").strip()
    token = os.environ.get("INFLUX_TOKEN", "").strip()
    org = os.environ.get("INFLUX_ORG", "mallard").strip()
    bucket = os.environ.get("INFLUX_BUCKET", "metrics").strip()
    if not url or not token:
        return None
    return url, token, org, bucket


@pytest.fixture()
def live_influx() -> Iterator[LiveInflux]:
    settings = _live_influx_settings()
    if settings is None:
        pytest.skip("INFLUX_URL/INFLUX_TOKEN not set — skipping live InfluxDB test")

    url, token, org, bucket = settings
    client = InfluxDBClient(url=url, token=token, org=org)
    try:
        if not client.ping():
            pytest.skip(f"InfluxDB at {url} is not reachable — skipping live InfluxDB test")
    except Exception:
        pytest.skip(f"InfluxDB at {url} is not reachable — skipping live InfluxDB test")

    write_api = client.write_api(write_options=SYNCHRONOUS)
    try:
        yield client, write_api, org, bucket
    finally:
        client.close()


class TestLiveInfluxWriteAndRead:
    def test_write_payload_lands_and_is_queryable(self, live_influx: LiveInflux) -> None:
        client, write_api, org, bucket = live_influx
        instance_id = f"live-test-{uuid.uuid4().hex[:12]}"
        ts_ms = int(time.time() * 1000)

        metric = NormalizedMetric(
            schema_version=2,
            instance_id=instance_id,
            ts_ms=ts_ms,
            connector="claude-code",
            mtd_credits=42.5,
            today_credits=3.5,
            active_models=["claude-sonnet-4-5"],
            top_model="claude-sonnet-4-5",
        )

        write_payload(write_api, bucket=bucket, org=org, metric=metric, source="live-e2e-test")

        query_api = client.query_api()
        flux = f'''
        from(bucket: "{bucket}")
          |> range(start: -5m)
          |> filter(fn: (r) => r._measurement == "{_MEASUREMENT}")
          |> filter(fn: (r) => r.instance_id == "{instance_id}")
        '''
        tables = query_api.query(flux, org=org)

        fields: dict[str, object] = {}
        for table in tables:
            for record in table.records:
                fields[record.get_field()] = record.get_value()

        assert fields.get("mtd_credits") == 42.5
        assert fields.get("top_model") == "claude-sonnet-4-5"
        assert fields.get("active_models_count") == 1
