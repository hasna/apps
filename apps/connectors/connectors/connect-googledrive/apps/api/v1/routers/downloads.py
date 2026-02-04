from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from apps.api.services.downloads import DownloadHistoryService

from ..dependencies.drive import get_download_history_service
from ..schemas.downloads import DownloadListResponse

router = APIRouter()


@router.get("/", response_model=DownloadListResponse)
async def list_downloads(
    limit: int = 100,
    offset: int = 0,
    status: str | None = None,
    *,
    service: Annotated[DownloadHistoryService, Depends(get_download_history_service)],
) -> DownloadListResponse:
    records = await service.list_downloads(limit=limit, offset=offset, status=status)
    downloads = [
        {
            "id": record.id,
            "account_id": record.account_id,
            "file_id": record.file_id,
            "file_name": record.file_name,
            "mime_type": record.mime_type,
            "bytes_downloaded": record.bytes_downloaded,
            "checksum": record.checksum,
            "status": record.status,
            "error": record.error,
            "completed_at": record.completed_at,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
        }
        for record in records
    ]
    return DownloadListResponse(downloads=downloads)
