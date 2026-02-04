from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from apps.api.clients.googledrive import DriveAPIError

from ..dependencies.drive import get_permission_service
from ..schemas.permissions import (
    PermissionGrantRequest,
    PermissionListResponse,
    PermissionUpdateRequest,
)

router = APIRouter()


@router.get("/{file_id}", response_model=PermissionListResponse)
async def list_permissions(file_id: str, service=Depends(get_permission_service)) -> PermissionListResponse:
    try:
        payload = await service.list_permissions(file_id)
        return PermissionListResponse(**payload)
    except DriveAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/{file_id}", response_model=dict)
async def grant_permission(
    file_id: str,
    body: PermissionGrantRequest,
    service=Depends(get_permission_service),
) -> dict:
    try:
        return await service.grant_permission(
            file_id,
            role=body.role,
            type_=body.type,
            email_address=body.email_address,
            domain=body.domain,
            allow_file_discovery=body.allow_file_discovery,
            send_notification_email=body.send_notification_email,
        )
    except DriveAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.delete("/{file_id}/{permission_id}", status_code=204)
async def revoke_permission(
    file_id: str,
    permission_id: str,
    service=Depends(get_permission_service),
) -> None:
    try:
        await service.revoke_permission(file_id, permission_id)
    except DriveAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.patch("/{file_id}/{permission_id}", response_model=dict)
async def update_permission(
    file_id: str,
    permission_id: str,
    body: PermissionUpdateRequest,
    service=Depends(get_permission_service),
) -> dict:
    try:
        return await service.update_permission(
            file_id,
            permission_id,
            role=body.role,
            allow_file_discovery=body.allow_file_discovery,
        )
    except DriveAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
