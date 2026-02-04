"""MCP server entrypoint exposing Google Drive connector capabilities."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from apps.api.clients.googledrive import DriveAPIError, GoogleDriveClient, OAuthTokenProvider
from apps.api.core.config import get_settings
from apps.api.core.database import get_session_factory
from apps.api.services.files import DriveFileService
from apps.api.services.token_store import TokenRepository
from apps.api.services.watch import WatchService


@asynccontextmanager
async def drive_context() -> tuple[DriveFileService, WatchService]:
    settings = get_settings()
    session_factory = get_session_factory(settings)
    async with session_factory() as session:
        repository = TokenRepository(session)
        token_provider = OAuthTokenProvider(settings, repository=repository)
        client = GoogleDriveClient(settings=settings, token_provider=token_provider)
        file_service = DriveFileService(client=client, settings=settings, session=session)
        watch_service = WatchService(session=session, client=client, settings=settings)
        try:
            yield file_service, watch_service
        finally:
            await client.aclose()


def _serialize_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _checkpoint_to_dict(checkpoint) -> Dict[str, Any]:
    return {
        "id": checkpoint.id,
        "account_id": checkpoint.account_id,
        "resource": checkpoint.resource,
        "cursor": checkpoint.cursor,
        "last_synced_at": _serialize_datetime(checkpoint.last_synced_at),
        "updated_at": _serialize_datetime(checkpoint.updated_at),
    }


def _success(request: Dict[str, Any], result: Any) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request.get("id"), "result": result}


def _error(request: Dict[str, Any], code: int, message: str) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request.get("id"), "error": {"code": code, "message": message}}


async def handle_request(request: Dict[str, Any]) -> Dict[str, Any]:
    method = request.get("method")
    params: Dict[str, Any] = request.get("params", {}) or {}

    try:
        if method == "drive.list_files":
            async with drive_context() as (service, _):
                payload = await service.list_files(
                    page_size=params.get("page_size", 100),
                    page_token=params.get("page_token"),
                    query=params.get("query"),
                )
            return _success(request, payload)

        if method == "drive.create_folder":
            async with drive_context() as (service, _):
                result = await service.create_folder(
                    name=params["name"],
                    parents=params.get("parents"),
                )
            return _success(request, result)

        if method == "drive.get_checkpoint":
            resource = params.get("resource", "files")
            async with drive_context() as (service, _):
                checkpoint = await service.get_sync_checkpoint(resource)
            return _success(request, _checkpoint_to_dict(checkpoint) if checkpoint else None)

        if method == "drive.update_checkpoint":
            resource = params.get("resource", "files")
            cursor = params.get("cursor")
            last_synced_at = params.get("last_synced_at")
            parsed_last_synced = None
            if last_synced_at:
                parsed_last_synced = datetime.fromisoformat(last_synced_at)
            async with drive_context() as (service, _):
                checkpoint = await service.update_sync_checkpoint(
                    resource,
                    cursor,
                    last_synced_at=parsed_last_synced,
                )
            return _success(request, {"id": checkpoint.id, "cursor": checkpoint.cursor})

        if method == "maintenance.prune_downloads":
            hours = params.get("hours", 24)
            async with drive_context() as (service, _):
                cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
                deleted = await service.sync_state.prune_downloads(cutoff)
            return _success(request, {"deleted": deleted, "cutoff": cutoff.isoformat()})

        if method == "maintenance.health":
            async with drive_context() as (service, watch_service):
                channels = await watch_service.list_channels()
                return _success(
                    request,
                    {
                        "watch_channels": len(channels),
                        "webhook_url": get_settings().connector_webhook_url,
                    },
                )

        if method == "watch.list_channels":
            async with drive_context() as (_, watch_service):
                channels = await watch_service.list_channels()
            return _success(
                request,
                [
                    {
                        "channel_id": c.channel_id,
                        "resource_id": c.resource_id,
                        "resource_uri": c.resource_uri,
                        "expiration": _serialize_datetime(c.expiration),
                        "token": c.token,
                        "kind": c.kind,
                    }
                    for c in channels
                ],
            )

        if method == "watch.register_channel":
            ttl = int(params.get("ttl_seconds", 86400))
            async with drive_context() as (_, watch_service):
                channel = await watch_service.register_changes_watch(ttl_seconds=ttl)
            return _success(
                request,
                {
                    "channel_id": channel.channel_id,
                    "resource_id": channel.resource_id,
                    "resource_uri": channel.resource_uri,
                    "expiration": _serialize_datetime(channel.expiration),
                    "token": channel.token,
                },
            )

        if method == "watch.delete_channel":
            channel_id = params.get("channel_id")
            if not channel_id:
                return _error(request, -32602, "channel_id required")
            async with drive_context() as (_, watch_service):
                await watch_service.delete_watch(channel_id=channel_id, resource_id=params.get("resource_id"))
            return _success(request, {"deleted": channel_id})

        if method == "permissions.list":
            file_id = params.get("file_id")
            if not file_id:
                return _error(request, -32602, "file_id required")
            async with drive_context() as (service, _):
                payload = await service.list_permissions(file_id)
            return _success(request, payload)

        if method == "permissions.grant":
            file_id = params.get("file_id")
            role = params.get("role")
            type_ = params.get("type")
            if not all([file_id, role, type_]):
                return _error(request, -32602, "file_id, role, type required")
            async with drive_context() as (service, _):
                result = await service.grant_permission(
                    file_id,
                    role=role,
                    type_=type_,
                    email_address=params.get("email_address"),
                    domain=params.get("domain"),
                    allow_file_discovery=params.get("allow_file_discovery"),
                    send_notification_email=params.get("send_notification_email", False),
                )
            return _success(request, result)

        if method == "permissions.revoke":
            file_id = params.get("file_id")
            permission_id = params.get("permission_id")
            if not all([file_id, permission_id]):
                return _error(request, -32602, "file_id and permission_id required")
            async with drive_context() as (service, _):
                await service.revoke_permission(file_id, permission_id)
            return _success(request, {"revoked": permission_id})

        if method == "permissions.update":
            file_id = params.get("file_id")
            permission_id = params.get("permission_id")
            if not all([file_id, permission_id]):
                return _error(request, -32602, "file_id and permission_id required")
            async with drive_context() as (service, _):
                result = await service.update_permission(
                    file_id,
                    permission_id,
                    role=params.get("role"),
                    allow_file_discovery=params.get("allow_file_discovery"),
                )
            return _success(request, result)

        return _error(request, -32601, "Method not found")

    except DriveAPIError as exc:
        return _error(request, exc.status_code, str(exc))
    except Exception as exc:  # noqa: BLE001
        return _error(request, -32000, str(exc))
