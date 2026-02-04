from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class DriveFile(BaseModel):
    id: str
    name: str
    mime_type: str = Field(alias="mimeType")
    modified_time: Optional[datetime] = Field(default=None, alias="modifiedTime")
    parents: Optional[List[str]] = None
    size: Optional[int] = None
    web_view_link: Optional[str] = Field(default=None, alias="webViewLink")
    icon_link: Optional[str] = Field(default=None, alias="iconLink")
    owned_by_me: Optional[bool] = Field(default=None, alias="ownedByMe")
    md5_checksum: Optional[str] = Field(default=None, alias="md5Checksum")

    class Config:
        populate_by_name = True


class FileListResponse(BaseModel):
    files: List[DriveFile]
    next_page_token: Optional[str] = Field(default=None, alias="nextPageToken")
    pages_fetched: int = Field(default=1, alias="pagesFetched")
    has_more: bool = Field(default=False, alias="hasMore")

    class Config:
        populate_by_name = True


class ListFilesQuery(BaseModel):
    page_size: int = Field(default=100, ge=1, le=1000)
    page_token: Optional[str] = None
    query: Optional[str] = None


class FolderCreateRequest(BaseModel):
    name: str
    parents: Optional[List[str]] = None


class FileUploadResponse(BaseModel):
    id: str
    name: str
    mime_type: str = Field(alias="mimeType")
    parents: Optional[List[str]] = None
    web_view_link: Optional[str] = Field(default=None, alias="webViewLink")

    class Config:
        populate_by_name = True


class DriveChange(BaseModel):
    file_id: Optional[str] = Field(default=None, alias="fileId")
    removed: Optional[bool] = None
    time: Optional[datetime] = None
    file: Optional[DriveFile] = None

    class Config:
        populate_by_name = True


class ChangeListResponse(BaseModel):
    changes: List[DriveChange]
    cursor: str
    initialised: bool
    has_more: bool
