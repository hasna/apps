from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.clients.googledrive import GoogleDriveClient
from apps.api.core.config import Settings
from apps.api.core.logging import get_logger


class PermissionService:
    def __init__(self, client: GoogleDriveClient, settings: Settings, session: AsyncSession) -> None:
        self._client = client
        self._settings = settings
        self._session = session
        self._logger = get_logger(__name__)

    async def list_permissions(self, file_id: str) -> dict[str, Any]:
        self._logger.info("permissions.list", file_id=file_id)
        return await self._client.list_permissions(file_id)

    async def grant_permission(
        self,
        file_id: str,
        role: str,
        type_: str,
        *,
        email_address: str | None = None,
        domain: str | None = None,
        allow_file_discovery: bool | None = None,
        send_notification_email: bool = False,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"role": role, "type": type_}
        if email_address:
            body["emailAddress"] = email_address
        if domain:
            body["domain"] = domain
        if allow_file_discovery is not None:
            body["allowFileDiscovery"] = allow_file_discovery
        self._logger.info("permissions.grant", file_id=file_id, role=role, type=type_)
        return await self._client.create_permission(
            file_id,
            body,
            send_notification_email=send_notification_email,
        )

    async def revoke_permission(self, file_id: str, permission_id: str) -> None:
        self._logger.info("permissions.revoke", file_id=file_id, permission_id=permission_id)
        await self._client.delete_permission(file_id, permission_id)

    async def update_permission(
        self,
        file_id: str,
        permission_id: str,
        *,
        role: str | None = None,
        allow_file_discovery: bool | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if role:
            body["role"] = role
        if allow_file_discovery is not None:
            body["allowFileDiscovery"] = allow_file_discovery
        if not body:
            return await self._client.list_permissions(file_id)
        self._logger.info("permissions.update", file_id=file_id, permission_id=permission_id)
        return await self._client.update_permission(file_id, permission_id, body)
