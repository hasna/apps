from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Annotated, List, Optional

import typer

from apps.api.clients.googledrive import DriveAPIError
from cli.commands.context import connector_context

FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
DEFAULT_DOWNLOAD_DIR = Path.home() / "Downloads"

downloads_app = typer.Typer(help="Download utilities and history")


def _sanitize_name(name: str, fallback: str) -> str:
    cleaned = re.sub(r"[\/:*?\"<>|]", "_", name).strip()
    return cleaned or fallback


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    counter = 1
    while True:
        candidate = path.with_name(f"{stem} ({counter}){suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


async def _download_file(service, file_id: str, destination: Path, preferred_name: Optional[str] = None) -> Path:
    metadata = await service.get_file(file_id)
    name = preferred_name or metadata.get("name") or f"{file_id}.bin"
    safe_name = _sanitize_name(name, file_id)
    target = _unique_path(destination / safe_name)
    metadata, iterator = await service.download_file(file_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as handle:
        async for chunk in iterator:
            handle.write(chunk)
    return target


async def _download_folder(service, folder_id: str, destination: Path) -> Path:
    folder_meta = await service.get_file(folder_id)
    folder_name = _sanitize_name(folder_meta.get("name") or folder_id, folder_id)
    target_dir = _unique_path(destination / folder_name)
    target_dir.mkdir(parents=True, exist_ok=True)
    items = await service.list_folder_items(folder_id)
    for item in items:
        item_id = item.get("id")
        if not item_id:
            continue
        if item.get("mimeType") == FOLDER_MIME_TYPE:
            await _download_folder(service, item_id, target_dir)
        else:
            await _download_file(service, item_id, target_dir, preferred_name=item.get("name"))
    return target_dir


@downloads_app.command("pull")
def pull(
    file_ids: Annotated[Optional[List[str]], typer.Option("--file", "-f", help="Download a file by ID", show_default=False)] = None,
    folder_ids: Annotated[Optional[List[str]], typer.Option("--folder", "-d", help="Download a folder (recursive) by ID")] = None,
    output: Annotated[Optional[Path], typer.Option("--output", "-o", help="Destination directory")] = None,
) -> None:
    """Download one or more files or folders to the local filesystem."""

    if not file_ids and not folder_ids:
        typer.secho("Provide at least one --file or --folder identifier.", err=True, fg=typer.colors.RED)
        raise typer.Exit(code=2)

    destination = (output or DEFAULT_DOWNLOAD_DIR).expanduser()
    destination.mkdir(parents=True, exist_ok=True)

    async def _pull() -> None:
        try:
            async with connector_context() as (file_service, _, _, _, _):
                for file_id in file_ids or []:
                    await _download_file(file_service, file_id, destination)
                for folder_id in folder_ids or []:
                    await _download_folder(file_service, folder_id, destination)
        except DriveAPIError as exc:
            typer.secho(f"Error downloading: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_pull())


@downloads_app.command("list")
def list_downloads(
    limit: Annotated[int, typer.Option("--limit", help="Number of records to return")] = 20,
    offset: Annotated[int, typer.Option("--offset", help="Records to skip")] = 0,
    status: Annotated[Optional[str], typer.Option("--status", help="Filter by status (completed, failed, started)")] = None,
) -> None:
    """Show recorded download history."""

    async def _list() -> None:
        async with connector_context() as (_, __, ___, ____, history_service):
            records = await history_service.list_downloads(limit=limit, offset=offset, status=status)
            payload = [
                {
                    "id": record.id,
                    "file_id": record.file_id,
                    "file_name": record.file_name,
                    "bytes_downloaded": record.bytes_downloaded,
                    "status": record.status,
                    "error": record.error,
                    "completed_at": record.completed_at.isoformat() if record.completed_at else None,
                    "created_at": record.created_at.isoformat(),
                    "updated_at": record.updated_at.isoformat(),
                }
                for record in records
            ]
            typer.echo(json.dumps(payload, indent=2))

    asyncio.run(_list())
