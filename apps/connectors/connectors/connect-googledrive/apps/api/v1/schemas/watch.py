from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class WatchRegisterRequest(BaseModel):
    ttl_seconds: int = Field(default=86400, ge=60, le=604800)


class WatchChannelResponse(BaseModel):
    channel_id: str
    resource_id: str | None = None
    resource_uri: str | None = None
    expiration: datetime | None = None
    token: str | None = None
    kind: str


class WatchRegisterResponse(WatchChannelResponse):
    pass
