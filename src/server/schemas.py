"""Pydantic model for the one wire version: the v1 event-stream batch.

Intentionally permissive (`extra="allow"`) — an unrecognized field on an
otherwise-known payload is not a reason to reject the whole batch. See
`normalize.py` for how each event is coerced into the canonical shape.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class IngestEnvelope(BaseModel):
    """Just enough to route: every payload must carry a schema_version."""

    model_config = ConfigDict(extra="allow")

    schema_version: int


class StreamBatchV1(BaseModel):
    """The streaming payload (schema_version: 1): a batch of priced, labeled
    usage events. All extraction/pricing/labeling happened on-device; the
    server stores the finished records."""

    model_config = ConfigDict(extra="allow")

    schema_version: int
    instance_id: str | None = Field(None, description="Stable anonymous hash identifying the VS Code instance")
    sent_at: int | None = Field(None, description="Unix epoch milliseconds when the batch was sent")
    tz_offset_minutes: int | None = Field(None, description="Client UTC offset in minutes at send time")
    events: list[Any] = Field(default_factory=list, description="Usage events (see normalize.py); non-object entries are skipped")
