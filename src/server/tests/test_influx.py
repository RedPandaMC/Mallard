"""Tests for the per-event InfluxDB writer."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from server.influx import write_payload
from server.normalize import NormalizedBatch, NormalizedEvent


def _event(**overrides) -> NormalizedEvent:
    base = dict(
        ts_ms=1_700_000_000_000,
        connector="local",
        model="claude-sonnet-4-5",
        surface="agent",
        credits=5.0,
        cost_usd=0.2,
        estimated=True,
        event_id="local:f1:span-1",
        language="typescript",
        repo="org/app",
        branch="main",
        attribution="heuristic",
        tokens={"prompt_tokens": 100},
        cost_by_category={"input": 0.12},
    )
    base.update(overrides)
    return NormalizedEvent(**base)


def _batch(events: list[NormalizedEvent]) -> NormalizedBatch:
    return NormalizedBatch(
        schema_version=1,
        instance_id="abc123",
        sent_at_ms=1_700_000_000_500,
        tz_offset_minutes=120,
        events=events,
    )


@pytest.fixture
def write_api() -> AsyncMock:
    return AsyncMock()


def _lines(write_api: AsyncMock) -> list[str]:
    records = write_api.write.call_args.kwargs["record"]
    return [p.to_line_protocol() for p in records]


class TestWritePayload:
    @pytest.mark.asyncio
    async def test_one_point_per_event_single_write_call(self, write_api: AsyncMock) -> None:
        await write_payload(write_api, "b", "o", _batch([_event(), _event(ts_ms=2)]), source="team-a")
        assert write_api.write.call_count == 1
        assert len(_lines(write_api)) == 2

    @pytest.mark.asyncio
    async def test_bucket_and_org_passed_through(self, write_api: AsyncMock) -> None:
        await write_payload(write_api, "the-bucket", "the-org", _batch([_event()]))
        kwargs = write_api.write.call_args.kwargs
        assert kwargs["bucket"] == "the-bucket"
        assert kwargs["org"] == "the-org"

    @pytest.mark.asyncio
    async def test_empty_batch_writes_nothing(self, write_api: AsyncMock) -> None:
        await write_payload(write_api, "b", "o", _batch([]))
        assert write_api.write.call_count == 0

    @pytest.mark.asyncio
    async def test_tags_carry_all_dimensions(self, write_api: AsyncMock) -> None:
        await write_payload(write_api, "b", "o", _batch([_event()]), source="team-a")
        line = _lines(write_api)[0]
        assert line.startswith("mallard_events,")
        for tag in ("source=team-a", "connector=local", "model=claude-sonnet-4-5",
                    "surface=agent", "language=typescript", "instance_id=abc123",
                    "schema_version=1", "repo=org/app", "branch=main",
                    "attribution=heuristic"):
            assert tag in line, tag

    @pytest.mark.asyncio
    async def test_missing_language_tagged_unknown(self, write_api: AsyncMock) -> None:
        await write_payload(write_api, "b", "o", _batch([_event(language=None)]))
        assert "language=unknown" in _lines(write_api)[0]

    @pytest.mark.asyncio
    async def test_missing_repo_and_branch_get_neutral_tags(self, write_api: AsyncMock) -> None:
        line_source = _batch([_event(repo=None, branch=None, attribution=None)])
        await write_payload(write_api, "b", "o", line_source)
        line = _lines(write_api)[0]
        assert "repo=unattributed" in line
        assert "branch=unknown" in line
        assert "attribution=" not in line

    @pytest.mark.asyncio
    async def test_fields_carry_metrics_and_tokens(self, write_api: AsyncMock) -> None:
        await write_payload(write_api, "b", "o", _batch([_event()]))
        line = _lines(write_api)[0]
        for f in ("credits=5", "cost_usd=0.2", "count=1i", "prompt_tokens=100i", "cbc_input=0.12"):
            assert f in line, f

    @pytest.mark.asyncio
    async def test_point_timestamp_is_the_event_ts(self, write_api: AsyncMock) -> None:
        await write_payload(write_api, "b", "o", _batch([_event(ts_ms=1_700_000_000_000)]))
        assert _lines(write_api)[0].endswith(" 1700000000000")  # WritePrecision.MS

    @pytest.mark.asyncio
    async def test_hostile_tag_values_sanitised(self, write_api: AsyncMock) -> None:
        await write_payload(
            write_api, "b", "o",
            _batch([_event(model='evil,tag=1 field="x"', surface="a" * 100)]),
        )
        line = _lines(write_api)[0]
        assert "evil_tag_1_field_x" in line.replace("\\ ", " ") or "evil_tag" in line
        # 64-char cap on tag values
        assert "a" * 65 not in line

    @pytest.mark.asyncio
    async def test_extra_fields_stored_as_json(self, write_api: AsyncMock) -> None:
        await write_payload(write_api, "b", "o", _batch([_event(extra={"future": 1})]))
        assert "extra_json=" in _lines(write_api)[0]

    @pytest.mark.asyncio
    async def test_no_extra_json_when_empty(self, write_api: AsyncMock) -> None:
        await write_payload(write_api, "b", "o", _batch([_event()]))
        assert "extra_json" not in _lines(write_api)[0]

    @pytest.mark.asyncio
    async def test_event_id_written_as_field_not_tag(self, write_api: AsyncMock) -> None:
        await write_payload(write_api, "b", "o", _batch([_event()]))
        line = _lines(write_api)[0]
        tags_section = line.split(" ")[0]
        assert "event_id" not in tags_section
        assert 'event_id="local:f1:span-1"' in line
