from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.clients.googledrive import DriveAPIError, GoogleDriveClient
from apps.api.core.config import Settings
from apps.api.core.logging import get_logger
from apps.api.services.sync_state import SyncStateService


class DriveFileService:
    def __init__(
        self,
        client: GoogleDriveClient,
        settings: Settings,
        session: AsyncSession,
    ) -> None:
        self._client = client
        self._settings = settings
        self._logger = get_logger(__name__)
        self._session = session
        self.sync_state = SyncStateService(
            session=session,
            account_id=settings.googledrive_default_account_id,
        )

    async def list_files(
        self,
        *,
        page_size: int = 100,
        page_token: str | None = None,
        query: str | None = None,
        corpora: str | None = None,
        drive_id: str | None = None,
        drive_name: str | None = None,
        include_items_from_all_drives: bool = True,
    ) -> dict[str, Any]:
        self._logger.info("list_files.start", page_size=page_size, page_token=page_token)
        resolved_drive_id = drive_id
        if drive_name:
            resolved_drive_id = await self._resolve_drive_id_by_name(drive_name)

        payload = await self._client.list_files(
            page_size=page_size,
            page_token=page_token,
            q=query,
            corpora=corpora,
            drive_id=resolved_drive_id,
            include_items_from_all_drives=include_items_from_all_drives,
        )
        payload["pagesFetched"] = payload.get("pagesFetched", 1)
        payload["hasMore"] = bool(payload.get("nextPageToken"))
        self._logger.info(
            "list_files.success",
            returned=len(payload.get("files", [])),
            next_page_token=payload.get("nextPageToken"),
        )
        return payload

    async def iter_files(self, **kwargs: Any) -> AsyncIterator[dict[str, Any]]:
        async for item in self._client.iter_files(**kwargs):
            yield item

    async def list_folder_items(self, folder_id: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            payload = await self._client.list_files(
                q=f"'{folder_id}' in parents",
                page_token=page_token,
                page_size=100,
            )
            items.extend(payload.get("files", []))
            page_token = payload.get("nextPageToken")
            if not page_token:
                break
        return items

    async def get_sync_checkpoint(self, resource: str):
        return await self.sync_state.get_checkpoint(resource)

    async def update_sync_checkpoint(
        self,
        resource: str,
        cursor: str | None,
        *,
        last_synced_at: datetime | None = None,
    ):
        return await self.sync_state.upsert_checkpoint(
            resource,
            cursor,
            last_synced_at=last_synced_at,
        )

    async def sync_changes(
        self,
        *,
        resource: str = "files",
        page_size: int = 100,
    ) -> Dict[str, Any]:
        checkpoint = await self.sync_state.get_checkpoint(resource)
        if not checkpoint or not checkpoint.cursor:
            self._logger.info("sync_changes.initialize", resource=resource)
            start_token = await self._client.get_start_page_token()
            await self.sync_state.upsert_checkpoint(resource, start_token, last_synced_at=datetime.now(timezone.utc))
            return {
                "changes": [],
                "cursor": start_token,
                "initialised": True,
                "has_more": False,
            }

        self._logger.info("sync_changes.fetch", resource=resource, cursor=checkpoint.cursor)
        payload = await self._client.list_changes(page_token=checkpoint.cursor, page_size=page_size)
        new_cursor = payload.get("newStartPageToken") or payload.get("nextPageToken") or checkpoint.cursor
        await self.sync_state.upsert_checkpoint(
            resource,
            new_cursor,
            last_synced_at=datetime.now(timezone.utc),
        )
        self._logger.info(
            "sync_changes.success",
            resource=resource,
            fetched=len(payload.get("changes", [])),
            new_cursor=new_cursor,
            has_more=bool(payload.get("nextPageToken")),
        )
        return {
            "changes": payload.get("changes", []),
            "cursor": new_cursor,
            "initialised": False,
            "has_more": bool(payload.get("nextPageToken")),
        }

    async def list_permissions(self, file_id: str) -> dict[str, Any]:
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
        return await self._client.create_permission(
            file_id,
            {
                "role": role,
                "type": type_,
                **({"emailAddress": email_address} if email_address else {}),
                **({"domain": domain} if domain else {}),
                **({"allowFileDiscovery": allow_file_discovery} if allow_file_discovery is not None else {}),
            },
            send_notification_email=send_notification_email,
        )

    async def revoke_permission(self, file_id: str, permission_id: str) -> None:
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
        return await self._client.update_permission(file_id, permission_id, body)

    async def get_file(self, file_id: str) -> dict[str, Any]:
        return await self._client.get_file_metadata(
            file_id,
            fields=[
                "id",
                "name",
                "mimeType",
                "modifiedTime",
                "parents",
                "size",
                "webViewLink",
                "iconLink",
                "ownedByMe",
                "md5Checksum",
            ],
        )

    async def download_file(self, file_id: str) -> tuple[dict[str, Any], AsyncIterator[bytes]]:
        metadata = await self._client.get_file_metadata(
            file_id,
            fields=[
                "id",
                "name",
                "size",
                "mimeType",
                "modifiedTime",
                "md5Checksum",
            ],
        )
        response = await self._client.download_file(file_id)

        audit_record = await self.sync_state.record_download_start(
            file_id=file_id,
            file_name=metadata.get("name"),
            mime_type=metadata.get("mimeType"),
            checksum=metadata.get("md5Checksum"),
        )

        async def audited_iterator() -> AsyncIterator[bytes]:
            bytes_downloaded = 0
            try:
                async for chunk in response.aiter_bytes():
                    bytes_downloaded += len(chunk)
                    yield chunk
            except Exception as exc:  # noqa: BLE001
                await self.sync_state.record_download_failure(audit_record.id, str(exc))
                raise
            else:
                await self.sync_state.record_download_complete(
                    audit_record.id,
                    bytes_downloaded=bytes_downloaded,
                )

        return metadata, audited_iterator()

    async def _resolve_drive_id_by_name(self, drive_name: str) -> str:
        async for drive in self._client.iter_drives():
            if drive.get("name", "").lower() == drive_name.lower():
                drive_id = drive.get("id")
                if drive_id:
                    return drive_id
        raise DriveAPIError(
            f"Shared drive named '{drive_name}' not found",
            status_code=404,
        )

    async def list_shared_drives(self) -> list[dict[str, Any]]:
        drives: list[dict[str, Any]] = []
        async for drive in self._client.iter_drives():
            drives.append(drive)
        return drives

    async def create_folder(self, *, name: str, parents: list[str] | None = None) -> dict[str, Any]:
        self._logger.info("create_folder.start", name=name, parents=parents)
        result = await self._client.create_folder(name=name, parents=parents)
        self._logger.info("create_folder.success", folder_id=result.get("id"))
        return result

    async def upload_file(
        self,
        *,
        name: str,
        mime_type: str,
        parents: list[str] | None = None,
        media: bytes | None = None,
        local_path: Path | None = None,
    ) -> dict[str, Any]:
        if media is None:
            if local_path is None:
                raise DriveAPIError(
                    "Must provide either media content or local_path",
                    status_code=400,
                    payload={},
                )
            if not local_path.exists():
                raise DriveAPIError(
                    f"Upload path {local_path} not found",
                    status_code=400,
                    payload={"path": str(local_path)},
                )
            media = local_path.read_bytes()
            self._logger.info("upload_file.read_local", path=str(local_path), size=len(media))

        self._logger.info("upload_file.start", name=name, size=len(media), mime_type=mime_type)
        result = await self._client.upload_file(
            name=name,
            media=media,
            mime_type=mime_type,
            parents=parents,
        )
        self._logger.info("upload_file.success", file_id=result.get("id"))
        return result
