from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field
from pydantic.config import ConfigDict


class PermissionEntry(BaseModel):
    id: str
    type: str
    role: str
    email_address: Optional[str] = Field(default=None, alias="emailAddress")
    domain: Optional[str] = None
    allow_file_discovery: Optional[bool] = Field(default=None, alias="allowFileDiscovery")

    class Config:
        populate_by_name = True
        extra = "ignore"


class PermissionListResponse(BaseModel):
    permissions: List[PermissionEntry] = []

    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class PermissionGrantRequest(BaseModel):
    role: str
    type: str = Field(alias="type")
    email_address: Optional[str] = Field(default=None, alias="emailAddress")
    domain: Optional[str] = None
    allow_file_discovery: Optional[bool] = Field(default=None, alias="allowFileDiscovery")
    send_notification_email: bool = Field(default=False, alias="sendNotificationEmail")


class PermissionUpdateRequest(BaseModel):
    role: Optional[str] = None
    allow_file_discovery: Optional[bool] = Field(default=None, alias="allowFileDiscovery")
