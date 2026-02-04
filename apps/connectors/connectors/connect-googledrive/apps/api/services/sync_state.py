from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.logging import get_logger
from apps.api.database.models import DownloadAudit, SyncCheckpoint


class SyncStateService:
    def __init__(self, session: AsyncSession, account_id: str) -> None:
        self._session = session
        self._account_id = account_id
        self._logger = get_logger(__name__)

    async def get_checkpoint(self, resource: str) -> SyncCheckpoint | None:
        stmt = (
            select(SyncCheckpoint)
            .where(SyncCheckpoint.account_id == self._account_id)
            .where(SyncCheckpoint.resource == resource)
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def upsert_checkpoint(
        self,
        resource: str,
        cursor: str | None,
        *,
        last_synced_at: datetime | None = None,
    ) -> SyncCheckpoint:
        checkpoint = await self.get_checkpoint(resource)
        if checkpoint:
            checkpoint.cursor = cursor
            checkpoint.last_synced_at = last_synced_at
        else:
            checkpoint = SyncCheckpoint(
                account_id=self._account_id,
                resource=resource,
                cursor=cursor,
                last_synced_at=last_synced_at,
            )
            self._session.add(checkpoint)
        await self._session.commit()
        await self._session.refresh(checkpoint)
        return checkpoint

    async def record_download_start(
        self,
        *,
        file_id: str,
        file_name: str | None,
        mime_type: str | None,
        checksum: str | None,
    ) -> DownloadAudit:
        record = DownloadAudit(
            account_id=self._account_id,
            file_id=file_id,
            file_name=file_name,
            mime_type=mime_type,
            checksum=checksum,
        )
        self._session.add(record)
        await self._session.commit()
        await self._session.refresh(record)
        return record

    async def record_download_complete(
        self,
        audit_id: int,
        *,
        bytes_downloaded: int,
    ) -> None:
        stmt = (
            update(DownloadAudit)
            .where(DownloadAudit.id == audit_id)
            .values(
                bytes_downloaded=bytes_downloaded,
                status="completed",
                completed_at=datetime.now(timezone.utc),
            )
        )
        await self._session.execute(stmt)
        await self._session.commit()

    async def record_download_failure(self, audit_id: int, error: str) -> None:
        stmt = (
            update(DownloadAudit)
            .where(DownloadAudit.id == audit_id)
            .values(status="failed", error=error, completed_at=datetime.now(timezone.utc))
        )
        await self._session.execute(stmt)
        await self._session.commit()

    async def prune_downloads(self, older_than: datetime) -> int:
        stmt = (
            delete(DownloadAudit)
            .where(DownloadAudit.completed_at.isnot(None))
            .where(DownloadAudit.completed_at < older_than)
        )
        result = await self._session.execute(stmt)
        await self._session.commit()
        deleted = result.rowcount or 0
        self._logger.info("download_audit.pruned", count=deleted)
        return deleted
