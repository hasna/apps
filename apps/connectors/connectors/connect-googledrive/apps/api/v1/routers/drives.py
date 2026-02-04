from __future__ import annotations

from fastapi import APIRouter, Depends

from apps.api.services.drives import DriveDirectoryService

from ..dependencies.drive import get_drive_directory_service
from ..schemas.drives import DriveListResponse

router = APIRouter()


@router.get("/", response_model=DriveListResponse)
async def list_drives(
    include_inactive: bool = False,
    service: DriveDirectoryService = Depends(get_drive_directory_service),
) -> DriveListResponse:
    drives = await service.list_drives(include_inactive=include_inactive)
    return DriveListResponse(drives=drives)


@router.post("/sync", response_model=DriveListResponse)
async def sync_drives(
    service: DriveDirectoryService = Depends(get_drive_directory_service),
) -> DriveListResponse:
    await service.sync()
    drives = await service.list_drives()
    return DriveListResponse(drives=drives)
