from __future__ import annotations

from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException

from apps.api.clients.googledrive import DriveAPIError

from ..dependencies.drive import get_watch_service
from ..schemas.watch import WatchChannelResponse, WatchRegisterRequest, WatchRegisterResponse

router = APIRouter()


@router.get("/channels", response_model=List[WatchChannelResponse])
async def list_channels(service=Depends(get_watch_service)) -> Any:
    channels = await service.list_channels()
    return [
        WatchChannelResponse(
            channel_id=channel.channel_id,
            resource_id=channel.resource_id,
            resource_uri=channel.resource_uri,
            expiration=channel.expiration,
            token=channel.token,
            kind=channel.kind,
        )
        for channel in channels
    ]


@router.post("/channels", response_model=WatchRegisterResponse)
async def register_channel(body: WatchRegisterRequest, service=Depends(get_watch_service)) -> Any:
    try:
        channel = await service.register_changes_watch(ttl_seconds=body.ttl_seconds)
        return WatchRegisterResponse(
            channel_id=channel.channel_id,
            resource_id=channel.resource_id,
            resource_uri=channel.resource_uri,
            expiration=channel.expiration,
            token=channel.token,
            kind=channel.kind,
        )
    except (DriveAPIError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/channels/{channel_id}", status_code=204)
async def delete_channel(channel_id: str, service=Depends(get_watch_service)) -> None:
    try:
        await service.delete_watch(channel_id=channel_id)
    except DriveAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
