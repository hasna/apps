from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.database.models import TokenCredential


class TokenRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_credentials(self, account_id: str) -> Optional[TokenCredential]:
        stmt = select(TokenCredential).where(TokenCredential.account_id == account_id)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def upsert_credentials(
        self,
        *,
        account_id: str,
        access_token: str,
        refresh_token: str | None,
        expires_in: int,
        scopes: str | None = None,
        is_service_account: bool = False,
    ) -> TokenCredential:
        record = await self.get_credentials(account_id)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        if record:
            record.access_token = access_token
            if refresh_token:
                record.refresh_token = refresh_token
            record.expires_at = expires_at
            if scopes:
                record.scopes = scopes
            record.is_service_account = is_service_account
        else:
            record = TokenCredential(
                account_id=account_id,
                access_token=access_token,
                refresh_token=refresh_token,
                expires_at=expires_at,
                scopes=scopes,
                is_service_account=is_service_account,
            )
            self._session.add(record)

        await self._session.commit()
        await self._session.refresh(record)
        return record

    async def store_refresh_token(
        self,
        *,
        account_id: str,
        refresh_token: str,
        scopes: str | None = None,
    ) -> TokenCredential:
        record = await self.get_credentials(account_id)
        if record:
            record.refresh_token = refresh_token
            if scopes:
                record.scopes = scopes
        else:
            record = TokenCredential(
                account_id=account_id,
                refresh_token=refresh_token,
                scopes=scopes,
            )
            self._session.add(record)
        await self._session.commit()
        await self._session.refresh(record)
        return record

