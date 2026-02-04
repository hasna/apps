from __future__ import annotations

import asyncio
import json
from typing import Any, Optional

import typer

from apps.api.clients.googledrive import DriveAPIError
from cli.commands.context import connector_context

folders_app = typer.Typer(help="Google Drive folder operations")


@folders_app.command("create")
def create_folder(
    name: str = typer.Argument(..., help="Name of the folder to create"),
    parents: Optional[str] = typer.Option(
        None,
        help="Comma-separated list of parent folder IDs",
    ),
    ) -> None:
    """Create a folder in Google Drive."""

    async def _create() -> None:
        try:
            async with connector_context() as (service, _, _, _, _):
                result = await service.create_folder(
                    name=name,
                    parents=parents.split(",") if parents else None,
                )
                typer.echo(json.dumps(result, indent=2))
        except DriveAPIError as exc:
            typer.secho(f"Error creating folder: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_create())


@folders_app.command("list")
def list_folders(
    page_size: int = typer.Option(20, help="Number of items per page (max 1000)"),
    parent: Optional[str] = typer.Option(None, help="Restrict results to folders whose parent matches this ID"),
    scope: str = typer.Option(
        "shared-drive",
        help="Search scope: shared-drive (default), all, or my-drive",
        case_sensitive=False,
        show_choices=True,
        rich_help_panel="Filters",
    ),
    drive_name: Optional[str] = typer.Option(None, help="Shared drive name when scope is shared-drive"),
    drive_id: Optional[str] = typer.Option(None, help="Shared drive ID override when scope is shared-drive"),
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
        help="Maximum number of pages to fetch (per drive when scanning shared drives).",
        rich_help_panel="Pagination",
    ),
) -> None:
    """List folders accessible to the connector."""

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

            base_query = "mimeType='application/vnd.google-apps.folder'"
            if parent:
                base_query += f" and '{parent}' in parents"

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
                                query=base_query,
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
                                        "folders": accumulated,
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
                                        "folders": accumulated,
                                        "nextPageToken": None,
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
                            query=base_query,
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
                                    "folders": collected,
                                    "nextPageToken": token,
                                    "pagesFetched": pages_fetched,
                                    "hasMore": token is not None,
                                }
                                break
                            if not token:
                                final_payload = {
                                    "folders": collected,
                                    "nextPageToken": None,
                                    "pagesFetched": pages_fetched,
                                    "hasMore": False,
                                }
                                break
                        else:
                            payload["folders"] = payload.pop("files", [])
                            payload["pagesFetched"] = pages_fetched
                            if max_pages is not None and pages_fetched >= max_pages and payload.get("nextPageToken"):
                                payload["hasMore"] = True
                            else:
                                payload["hasMore"] = bool(payload.get("nextPageToken"))
                            final_payload = payload
                            break

                        if not token:
                            break

                    if final_payload is None and all_pages:
                        final_payload = {
                            "folders": collected,
                            "nextPageToken": token,
                            "pagesFetched": pages_fetched,
                            "hasMore": token is not None,
                        }

                    typer.echo(json.dumps(final_payload or {}, indent=2))
        except DriveAPIError as exc:
            typer.secho(f"Error listing folders: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_list())
