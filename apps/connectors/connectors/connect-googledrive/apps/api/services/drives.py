from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, List

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.clients.googledrive import GoogleDriveClient
from apps.api.core.logging import get_logger
from apps.api.database.models import DriveCatalog, DriveKind


class DriveDirectoryService:
    def __init__(
        self,
        session: AsyncSession,
        client: GoogleDriveClient,
    ) -> None:
        self._session = session
        self._client = client
        self._logger = get_logger(__name__)

    async def ensure_synced(self, *, force: bool = False, max_age_seconds: int = 3600) -> list[dict[str, Any]]:
        """Ensure drive catalog is populated and fresh."""
        if force:
            await self.sync()
            return await self.list_drives()

        result = await self._session.execute(select(func.max(DriveCatalog.last_synced_at)))
        last_synced = result.scalar()
        now = datetime.now(timezone.utc)

        if last_synced is not None and last_synced.tzinfo is None:
            last_synced = last_synced.replace(tzinfo=timezone.utc)

        if last_synced is None or (now - last_synced).total_seconds() > max_age_seconds:
            await self.sync()

        return await self.list_drives()

    async def sync(self) -> list[dict[str, Any]]:
        """Fetch drives from Google and upsert into catalog."""
        now = datetime.now(timezone.utc)
        remote_drives: List[dict[str, Any]] = [
            {
                "drive_id": "my-drive",
                "name": "My Drive",
                "kind": DriveKind.MY_DRIVE.value,
            }
        ]

        async for drive in self._client.iter_drives():
            drive_id = drive.get("id")
            if not drive_id:
                continue
            remote_drives.append(
                {
                    "drive_id": drive_id,
                    "name": drive.get("name") or drive.get("id"),
                    "kind": DriveKind.SHARED_DRIVE.value,
                }
            )

        existing_result = await self._session.execute(select(DriveCatalog))
        existing = {record.drive_id: record for record in existing_result.scalars()}

        seen_ids: set[str] = set()
        for entry in remote_drives:
            drive_id = entry["drive_id"]
            seen_ids.add(drive_id)
            record = existing.get(drive_id)
            if record:
                record.name = entry["name"]
                record.kind = entry["kind"]
                record.is_active = True
                record.last_synced_at = now
            else:
                record = DriveCatalog(
                    drive_id=drive_id,
                    name=entry["name"],
                    kind=entry["kind"],
                    is_active=True,
                    last_synced_at=now,
                )
                self._session.add(record)

        for drive_id, record in existing.items():
            if drive_id not in seen_ids:
                record.is_active = False
                record.last_synced_at = now

        await self._session.commit()
        self._logger.info("drive_catalog.synced", total=len(remote_drives))
        return await self.list_drives()

    async def list_drives(
        self,
        *,
        include_inactive: bool = False,
        kind: str | None = None,
    ) -> list[dict[str, Any]]:
        stmt = select(DriveCatalog)
        if not include_inactive:
            stmt = stmt.where(DriveCatalog.is_active.is_(True))
        if kind:
            stmt = stmt.where(DriveCatalog.kind == kind)
        stmt = stmt.order_by(DriveCatalog.name.asc())
        result = await self._session.execute(stmt)
        return [self._serialize(record) for record in result.scalars()]

    async def list_shared_drives(self) -> list[dict[str, Any]]:
        return await self.list_drives(kind=DriveKind.SHARED_DRIVE.value)

    def _serialize(self, record: DriveCatalog) -> dict[str, Any]:
        return {
            "drive_id": record.drive_id,
            "name": record.name,
            "kind": record.kind,
            "is_active": record.is_active,
            "last_synced_at": record.last_synced_at.isoformat() if record.last_synced_at else None,
        }
