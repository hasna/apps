from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class DownloadRecord(BaseModel):
    id: int
    account_id: str
    file_id: str
    file_name: Optional[str] = None
    mime_type: Optional[str] = None
    bytes_downloaded: int = Field(default=0)
    checksum: Optional[str] = None
    status: str
    error: Optional[str] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class DownloadListResponse(BaseModel):
    downloads: list[DownloadRecord]

