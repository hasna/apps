from __future__ import annotations

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class TokenCredential(TimestampMixin, Base):
    __tablename__ = "token_credentials"
    __table_args__ = (UniqueConstraint("account_id", name="uq_token_account"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[str] = mapped_column(String(255), nullable=False)
    access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scopes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_service_account: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class SyncCheckpoint(TimestampMixin, Base):
    __tablename__ = "sync_checkpoints"
    __table_args__ = (UniqueConstraint("account_id", "resource", name="uq_checkpoint_resource"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[str] = mapped_column(String(255), nullable=False)
    resource: Mapped[str] = mapped_column(String(255), nullable=False)
    cursor: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DownloadStatus(str, PyEnum):
    STARTED = "started"
    COMPLETED = "completed"
    FAILED = "failed"


class DownloadAudit(TimestampMixin, Base):
    __tablename__ = "download_audit"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[str] = mapped_column(String(255), nullable=False)
    file_id: Mapped[str] = mapped_column(String(255), nullable=False)
    file_name: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    bytes_downloaded: Mapped[int] = mapped_column(Integer, default=0)
    checksum: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(32), default=DownloadStatus.STARTED.value, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WatchChannel(TimestampMixin, Base):
    __tablename__ = "watch_channels"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    channel_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    resource_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    expiration: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    account_id: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(64), default="changes", nullable=False)


class DriveKind(str, PyEnum):
    MY_DRIVE = "my_drive"
    SHARED_DRIVE = "shared_drive"


class DriveCatalog(TimestampMixin, Base):
    __tablename__ = "drive_catalog"
    __table_args__ = (UniqueConstraint("drive_id", name="uq_drive_catalog_id"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    drive_id: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(64), nullable=False, default=DriveKind.SHARED_DRIVE.value)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
