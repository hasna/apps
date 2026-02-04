from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from apps.api.clients.googledrive import DriveAPIError
from apps.api.services.files import DriveFileService

from ..dependencies.drive import get_drive_file_service
from ..schemas.files import (
    DriveFile,
    FileListResponse,
    FileUploadResponse,
    FolderCreateRequest,
    ChangeListResponse,
)

router = APIRouter()


@router.get("/", response_model=FileListResponse)
async def list_files(
    page_size: int = 100,
    page_token: str | None = None,
    query: str | None = None,
    service: DriveFileService = Depends(get_drive_file_service),
) -> Any:
    try:
        payload = await service.list_files(page_size=page_size, page_token=page_token, query=query)
    except DriveAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return payload


@router.get("/{file_id}", response_model=DriveFile)
async def get_file(
    file_id: str,
    service: DriveFileService = Depends(get_drive_file_service),
) -> Any:
    try:
        return await service.get_file(file_id)
    except DriveAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/{file_id}/download")
async def download_file(
    file_id: str,
    service: DriveFileService = Depends(get_drive_file_service),
) -> StreamingResponse:
    try:
        metadata, iterator = await service.download_file(file_id)
    except DriveAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    filename = metadata.get("name", f"{file_id}.bin")
    content_type = metadata.get("mimeType", "application/octet-stream")
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
    }
    return StreamingResponse(iterator, media_type=content_type, headers=headers)


@router.post("/folders", response_model=DriveFile)
async def create_folder(
    body: FolderCreateRequest,
    service: DriveFileService = Depends(get_drive_file_service),
) -> Any:
    try:
        return await service.create_folder(name=body.name, parents=body.parents)
    except DriveAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    *,
    name: str,
    mime_type: str,
    parents: list[str] | None = None,
    upload: UploadFile = File(...),
    service: DriveFileService = Depends(get_drive_file_service),
) -> Any:
    try:
        content = await upload.read()
        result = await service.upload_file(
            name=name,
            mime_type=mime_type or upload.content_type or "application/octet-stream",
            media=content,
            parents=parents,
        )
        return result
    except DriveAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    finally:
        await upload.close()


@router.get("/changes", response_model=ChangeListResponse)
async def list_changes(
    page_size: int = 100,
    resource: str = "files",
    service: DriveFileService = Depends(get_drive_file_service),
) -> Any:
    try:
        payload = await service.sync_changes(resource=resource, page_size=page_size)
        return payload
    except DriveAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
