from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response

from apps.api.core.logging import get_logger

from ..dependencies.drive import get_watch_service

router = APIRouter()
logger = get_logger(__name__)


@router.post("/googledrive", status_code=204)
async def googledrive_webhook(
    request: Request,
    channel_id: str = Header(default=None, alias="X-Goog-Channel-Id"),
    resource_state: str = Header(default="", alias="X-Goog-Resource-State"),
    message_number: str = Header(default="", alias="X-Goog-Message-Number"),
    resource_id: str | None = Header(default=None, alias="X-Goog-Resource-Id"),
    channel_token: str | None = Header(default=None, alias="X-Goog-Channel-Token"),
    channel_expiration: str | None = Header(default=None, alias="X-Goog-Channel-Expiration"),
    service=Depends(get_watch_service),
) -> Response:
    if channel_id is None:
        raise HTTPException(status_code=400, detail="Missing channel header")

    body = await request.body()
    logger.info(
        "webhook.received",
        channel_id=channel_id,
        resource_state=resource_state,
        resource_id=resource_id,
        message_number=message_number,
        body_length=len(body),
    )

    try:
        await service.ensure_valid_channel(channel_id, channel_token)
        await service.upsert_channel(
            {
                "id": channel_id,
                "resourceId": resource_id,
                "resourceUri": str(request.url),
                "kind": resource_state,
                "X-Goog-Channel-Expiration": channel_expiration,
            }
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    return Response(status_code=204)
