from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class Drive(BaseModel):
    drive_id: str
    name: str
    kind: Literal["my_drive", "shared_drive"]
    is_active: bool
    last_synced_at: datetime | None = None


class DriveListResponse(BaseModel):
    drives: list[Drive]
