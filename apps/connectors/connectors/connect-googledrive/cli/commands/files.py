from __future__ import annotations

import asyncio
import json
import mimetypes
from pathlib import Path
from typing import Any, Optional

import typer

from apps.api.clients.googledrive import DriveAPIError
from cli.commands.context import connector_context

files_app = typer.Typer(help="Google Drive file operations")


@files_app.command("list")
def list_files(
    page_size: int = typer.Option(20, help="Number of items per page (max 1000)"),
    query: Optional[str] = typer.Option(None, help="Drive query string filter"),
    scope: str = typer.Option(
        "shared-drive",
        help="Search scope: shared-drive (default), all, or my-drive",
        case_sensitive=False,
        show_choices=True,
        rich_help_panel="Filters",
    ),
    drive_name: Optional[str] = typer.Option(
        None,
        help="Shared drive name when scope is shared-drive",
    ),
    drive_id: Optional[str] = typer.Option(
        None,
        help="Shared drive ID override when scope is shared-drive",
    ),
    page_token: Optional[str] = typer.Option(
        None,
        help="Resume listing from this page token (requires a single drive scope).",
        rich_help_panel="Pagination",
    ),
    all_pages: bool = typer.Option(
        False,
        "--all-pages",
        help="Fetch every page until exhausted.",
        rich_help_panel="Pagination",
    ),
    max_pages: Optional[int] = typer.Option(
        None,
        "--max-pages",
        min=1,
        help="Maximum number of pages to retrieve (per drive when scanning shared drives).",
        rich_help_panel="Pagination",
    ),
) -> None:
    """List files and folders accessible to the connector."""

    async def _list() -> None:
        try:
            resolved_scope = scope.lower()
            corpora: Optional[str] = None
            include_all = True
            search_all_shared = False

            if resolved_scope not in {"all", "my-drive", "shared-drive"}:
                typer.secho(
                    "Invalid scope value. Use one of: all, my-drive, shared-drive.",
                    err=True,
                    fg=typer.colors.RED,
                )
                raise typer.Exit(code=2)

            if (drive_name or drive_id) and resolved_scope == "my-drive":
                typer.secho(
                    "Cannot specify drive name or ID when scope is my-drive.",
                    err=True,
                    fg=typer.colors.RED,
                )
                raise typer.Exit(code=2)

            if (drive_name or drive_id) and resolved_scope == "all":
                resolved_scope = "shared-drive"

            if page_token and resolved_scope == "shared-drive" and not (drive_name or drive_id):
                typer.secho(
                    "A page token can only be used when targeting a single shared drive. "
                    "Provide --drive-name or --drive-id.",
                    err=True,
                    fg=typer.colors.RED,
                )
                raise typer.Exit(code=2)

            if resolved_scope == "my-drive":
                include_all = False
            elif resolved_scope == "shared-drive":
                include_all = True
                corpora = "drive"
                if not drive_id and not drive_name:
                    search_all_shared = True
            else:
                corpora = "allDrives"

            async with connector_context() as (service, _, _, directory_service, _):
                if search_all_shared:
                    if page_token:
                        typer.secho(
                            "Cannot use --page-token when scanning all shared drives. "
                            "Specify --drive-name/--drive-id instead.",
                            err=True,
                            fg=typer.colors.RED,
                        )
                        raise typer.Exit(code=2)

                    drives = await directory_service.list_shared_drives()
                    if not drives:
                        typer.secho(
                            "No shared drives found in the local catalog. Run `connector-googledrive drives sync` first.",
                            err=True,
                            fg=typer.colors.YELLOW,
                        )
                        raise typer.Exit(code=2)
                    aggregated: list[dict[str, Any]] = []
                    for drive in drives:
                        token = None
                        accumulated: list[dict[str, Any]] = []
                        pages_fetched = 0
                        while True:
                            payload = await service.list_files(
                                page_size=page_size,
                                query=query,
                                corpora="drive",
                                drive_id=drive["drive_id"],
                                include_items_from_all_drives=True,
                                page_token=token,
                            )
                            pages_fetched += 1
                            accumulated.extend(payload.get("files", []))
                            token = payload.get("nextPageToken")
                            if max_pages is not None and pages_fetched >= max_pages:
                                aggregated.append(
                                    {
                                        "drive": {
                                            "id": drive["drive_id"],
                                            "name": drive["name"],
                                        },
                                        "files": accumulated,
                                        "nextPageToken": token,
                                        "pagesFetched": pages_fetched,
                                        "hasMore": token is not None,
                                    }
                                )
                                break
                            if not token:
                                aggregated.append(
                                    {
                                        "drive": {
                                            "id": drive["drive_id"],
                                            "name": drive["name"],
                                        },
                                        "files": accumulated,
                                        "nextPageToken": token,
                                        "pagesFetched": pages_fetched,
                                        "hasMore": False,
                                    }
                                )
                                break
                    typer.echo(json.dumps({"results": aggregated}, indent=2))
                else:
                    token = page_token
                    pages_fetched = 0
                    collected: list[dict[str, Any]] = []
                    final_payload: dict[str, Any] | None = None

                    while True:
                        payload = await service.list_files(
                            page_size=page_size,
                            query=query,
                            page_token=token,
                            corpora=corpora,
                            drive_id=drive_id,
                            drive_name=drive_name,
                            include_items_from_all_drives=include_all,
                        )
                        pages_fetched += 1

                        if all_pages:
                            collected.extend(payload.get("files", []))
                            token = payload.get("nextPageToken")
                            if max_pages is not None and pages_fetched >= max_pages:
                                final_payload = {
                                    "files": collected,
                                    "nextPageToken": token,
                                    "pagesFetched": pages_fetched,
                                    "hasMore": token is not None,
                                }
                                break
                            if not token:
                                final_payload = {
                                    "files": collected,
                                    "nextPageToken": None,
                                    "pagesFetched": pages_fetched,
                                    "hasMore": False,
                                }
                                break
                        else:
                            payload["pagesFetched"] = pages_fetched
                            if max_pages is not None and pages_fetched >= max_pages and payload.get("nextPageToken"):
                                payload["hasMore"] = True
                            else:
                                payload["hasMore"] = bool(payload.get("nextPageToken"))
                            final_payload = payload
                            break

                        # Continue loop only when token remains and all_pages is True
                        if not token:
                            break

                    if final_payload is None and all_pages:
                        final_payload = {
                            "files": collected,
                            "nextPageToken": token,
                            "pagesFetched": pages_fetched,
                            "hasMore": token is not None,
                        }

                    typer.echo(json.dumps(final_payload or {}, indent=2))
        except DriveAPIError as exc:
            typer.secho(f"Error listing files: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_list())


@files_app.command("download")
def download_file(
    file_id: str = typer.Argument(..., help="Google Drive file ID"),
    output: Path = typer.Option(Path.cwd(), "--output", "-o", help="Directory or file path destination"),
    filename: Optional[str] = typer.Option(None, help="Override download filename"),
) -> None:
    """Download a file from Google Drive."""

    async def _download() -> None:
        try:
            async with connector_context() as (service, _, _, _, _):
                metadata, iterator = await service.download_file(file_id)
                target_path = output
                if output.is_dir():
                    resolved_name = filename or metadata.get("name") or f"{file_id}.bin"
                    target_path = output / resolved_name

                with target_path.open("wb") as f:
                    async for chunk in iterator:
                        f.write(chunk)
                typer.echo(f"Saved to {target_path}")
        except DriveAPIError as exc:
            typer.secho(f"Error downloading file: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_download())


@files_app.command("upload")
def upload_file(
    path: Path = typer.Argument(..., exists=True, resolve_path=True, help="Path to the local file"),
    parents: Optional[str] = typer.Option(
        None,
        help="Comma-separated list of Drive folder IDs to place the file in",
    ),
    name: Optional[str] = typer.Option(None, help="Override file name in Drive"),
    mime_type: Optional[str] = typer.Option(None, help="Override MIME type"),
) -> None:
    """Upload a local file to Google Drive."""

    async def _upload() -> None:
        try:
            async with connector_context() as (service, _, _, _, _):
                derived_name = name or path.name
                derived_mime = mime_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                result = await service.upload_file(
                    name=derived_name,
                    mime_type=derived_mime,
                    parents=parents.split(",") if parents else None,
                    local_path=path,
                )
                typer.echo(json.dumps(result, indent=2))
        except DriveAPIError as exc:
            typer.secho(f"Error uploading file: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_upload())


@files_app.command("sync")
def sync_changes(
    page_size: int = typer.Option(100, help="Number of changes to request"),
    resource: str = typer.Option("files", help="Sync checkpoint resource key"),
) -> None:
    """Fetch incremental changes using the stored sync checkpoint."""

    async def _sync() -> None:
        try:
            async with connector_context() as (service, _, _, _, _):
                payload = await service.sync_changes(resource=resource, page_size=page_size)
                typer.echo(json.dumps(payload, indent=2, default=str))
        except DriveAPIError as exc:
            typer.secho(f"Error syncing changes: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_sync())
