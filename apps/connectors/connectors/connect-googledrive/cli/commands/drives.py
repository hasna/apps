from __future__ import annotations

import asyncio
import csv
import json
from io import StringIO
from pathlib import Path
from typing import Any, Literal, Optional

import typer

from cli.commands.context import connector_context

drives_app = typer.Typer(help="Drive directory operations")


def _render_drives(drives: list[dict[str, Any]], fmt: str, output: Optional[Path]) -> None:
    fmt = fmt.lower()
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "csv":
        fieldnames = ["drive_id", "name", "kind", "is_active", "last_synced_at"]
        stream = StringIO()
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        for drive in drives:
            writer.writerow(drive)
        content = stream.getvalue()
        if output:
            output.write_text(content)
        else:
            typer.echo(content.rstrip("\n"))
    else:
        payload = json.dumps(drives, indent=2)
        if output:
            output.write_text(payload + "\n")
        else:
            typer.echo(payload)


@drives_app.command("list")
def list_drives(
    include_inactive: bool = typer.Option(False, help="Show inactive drives as well"),
    format: Literal["json", "csv"] = typer.Option(
        "json",
        "--format",
        "-f",
        case_sensitive=False,
        help="Output format.",
    ),
    output: Optional[Path] = typer.Option(
        None,
        "--output",
        "-o",
        help="File path to write results; stdout when omitted.",
    ),
) -> None:
    """List cached Google Drive directories."""

    async def _list() -> None:
        async with connector_context() as (_, __, ___, directory_service, ___):
            drives = await directory_service.list_drives(include_inactive=include_inactive)

        if not drives:
            typer.secho(
                "Drive catalog is empty. Run `connector-googledrive drives sync` to populate it.",
                err=True,
                fg=typer.colors.YELLOW,
            )
        _render_drives(drives, format, output)

    asyncio.run(_list())


@drives_app.command("sync")
def sync_drives(
    format: Literal["json", "csv"] = typer.Option(
        "json",
        "--format",
        "-f",
        case_sensitive=False,
        help="Output format.",
    ),
    output: Optional[Path] = typer.Option(
        None,
        "--output",
        "-o",
        help="File path to write results; stdout when omitted.",
    ),
) -> None:
    """Synchronize shared drive directory from Google."""

    async def _sync() -> None:
        async with connector_context() as (_, __, ___, directory_service, ___):
            drives = await directory_service.sync()
        _render_drives(drives, format, output)

    asyncio.run(_sync())
