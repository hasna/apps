from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.clients.googledrive import GoogleDriveClient
from apps.api.core.config import Settings
from apps.api.core.logging import get_logger
from apps.api.database.models import WatchChannel


class WatchService:
    def __init__(self, *, session: AsyncSession, client: GoogleDriveClient, settings: Settings) -> None:
        self._session = session
        self._client = client
        self._settings = settings
        self._logger = get_logger(__name__)

    async def list_channels(self) -> list[WatchChannel]:
        stmt = select(WatchChannel)
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def get_channel(self, channel_id: str) -> WatchChannel | None:
        stmt = select(WatchChannel).where(WatchChannel.channel_id == channel_id)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def register_changes_watch(self, *, ttl_seconds: int = 86400) -> WatchChannel:
        if not self._settings.connector_webhook_url:
            raise ValueError("CONNECTOR_WEBHOOK_URL must be configured to register watches")

        channel_id = secrets.token_hex(16)
        token = secrets.token_hex(12)
        payload = {
            "id": channel_id,
            "type": "web_hook",
            "address": self._settings.connector_webhook_url,
            "token": token,
            "params": {"ttl": str(ttl_seconds)},
        }
        start_token = await self._client.get_start_page_token()

        response = await self._client.start_changes_watch(page_token=start_token, body=payload)
        expiration_ms = int(response.get("expiration", 0))
        expiration = (
            datetime.fromtimestamp(expiration_ms / 1000, tz=timezone.utc) if expiration_ms else None
        )
        record = WatchChannel(
            channel_id=channel_id,
            resource_id=response.get("resourceId"),
            resource_uri=response.get("resourceUri"),
            expiration=expiration,
            token=token,
            account_id=self._settings.googledrive_default_account_id,
            kind="changes",
        )
        self._session.add(record)
        await self._session.commit()
        await self._session.refresh(record)
        self._logger.info(
            "watch.registered",
            channel_id=channel_id,
            resource_id=record.resource_id,
            expiration=expiration.isoformat() if expiration else None,
        )
        return record

    async def delete_watch(self, *, channel_id: str, resource_id: str | None = None) -> None:
        record = await self.get_channel(channel_id)
        await self._client.stop_channel(
            channel_id=channel_id,
            resource_id=resource_id or (record.resource_id if record else None),
        )
        if record:
            await self._session.delete(record)
            await self._session.commit()
            self._logger.info("watch.deleted", channel_id=channel_id)

    async def upsert_channel(self, data: dict[str, str]) -> WatchChannel:
        channel_id = data.get("id")
        if not channel_id:
            raise ValueError("Channel id missing from webhook notification")
        record = await self.get_channel(channel_id)
        if record is None:
            record = WatchChannel(
                channel_id=channel_id,
                account_id=self._settings.googledrive_default_account_id,
                kind=data.get("kind", "changes"),
            )
            self._session.add(record)
        record.resource_id = data.get("resourceId")
        record.resource_uri = data.get("resourceUri")
        expiration_header = data.get("X-Goog-Channel-Expiration")
        if expiration_header:
            try:
                record.expiration = parsedate_to_datetime(expiration_header)
            except Exception:  # noqa: BLE001
                record.expiration = None
        await self._session.commit()
        await self._session.refresh(record)
        return record

    async def ensure_valid_channel(self, channel_id: str, token: str | None) -> WatchChannel:
        record = await self.get_channel(channel_id)
        if record is None:
            raise PermissionError("Unknown channel")
        if record.token and token != record.token:
            raise PermissionError("Invalid channel token")
        return record

    async def renew_channels(self, *, threshold: timedelta, ttl_seconds: int = 86400) -> list[str]:
        now = datetime.now(timezone.utc)
        renewed: list[str] = []
        channels = await self.list_channels()
        for channel in channels:
            if channel.expiration is None or channel.expiration - now > threshold:
                continue
            await self.delete_watch(channel_id=channel.channel_id, resource_id=channel.resource_id)
            new_channel = await self.register_changes_watch(ttl_seconds=ttl_seconds)
            renewed.append(new_channel.channel_id)
        return renewed
