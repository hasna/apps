from __future__ import annotations

from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.database.models import DownloadAudit


class DownloadHistoryService:
    """Provide access to recorded download audit entries."""

    def __init__(self, session: AsyncSession, account_id: str) -> None:
        self._session = session
        self._account_id = account_id

    async def list_downloads(
        self,
        *,
        limit: int = 100,
        offset: int = 0,
        status: Optional[str] = None,
    ) -> List[DownloadAudit]:
        stmt = (
            select(DownloadAudit)
            .where(DownloadAudit.account_id == self._account_id)
            .order_by(DownloadAudit.updated_at.desc())
            .offset(offset)
            .limit(limit)
        )
        if status:
            stmt = stmt.where(DownloadAudit.status == status)

        result = await self._session.execute(stmt)
        return list(result.scalars())
