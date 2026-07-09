"""Live InfluxDB write/read test — exercises the real async client, not a mock.

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

import pytest
from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync

from server.influx import _MEASUREMENT, write_payload
from server.normalize import NormalizedBatch, NormalizedEvent


def _live_influx_settings() -> tuple[str, str, str, str] | None:
    url = os.environ.get("INFLUX_URL", "").strip()
    token = os.environ.get("INFLUX_TOKEN", "").strip()
    org = os.environ.get("INFLUX_ORG", "mallard").strip()
    bucket = os.environ.get("INFLUX_BUCKET", "metrics").strip()
    if not url or not token:
        return None
    return url, token, org, bucket


class TestLiveInfluxWriteAndRead:
    async def test_write_payload_lands_and_is_queryable(self) -> None:
        settings = _live_influx_settings()
        if settings is None:
            pytest.skip("INFLUX_URL/INFLUX_TOKEN not set — skipping live InfluxDB test")
        url, token, org, bucket = settings

        instance_id = f"live-test-{uuid.uuid4().hex[:12]}"
        ts_ms = int(time.time() * 1000)
        batch = NormalizedBatch(
            schema_version=1,
            instance_id=instance_id,
            sent_at_ms=ts_ms,
            tz_offset_minutes=120,
            events=[
                NormalizedEvent(
                    ts_ms=ts_ms,
                    connector="claude-code",
                    model="claude-sonnet-4-5",
                    surface="agent",
                    credits=42.5,
                    cost_usd=1.7,
                    estimated=True,
                    event_id="live:e2e:1",
                    language="typescript",
                    tokens={"prompt_tokens": 100},
                )
            ],
        )

        async with InfluxDBClientAsync(url=url, token=token, org=org) as client:
            try:
                reachable = await client.ping()
            except Exception:
                reachable = False
            if not reachable:
                pytest.skip(f"InfluxDB at {url} is not reachable — skipping live InfluxDB test")

            # The write path under test is async now — await it, as the server does.
            await write_payload(
                client.write_api(),
                bucket=bucket,
                org=org,
                batch=batch,
                source="live-e2e-test",
            )

            flux = f'''
            from(bucket: "{bucket}")
              |> range(start: -5m)
              |> filter(fn: (r) => r._measurement == "{_MEASUREMENT}")
              |> filter(fn: (r) => r.instance_id == "{instance_id}")
            '''
            tables = await client.query_api().query(flux, org=org)

        fields: dict[str, object] = {}
        for table in tables:
            for record in table.records:
                fields[record.get_field()] = record.get_value()

        assert fields.get("credits") == 42.5
        assert fields.get("cost_usd") == 1.7
        assert fields.get("prompt_tokens") == 100
