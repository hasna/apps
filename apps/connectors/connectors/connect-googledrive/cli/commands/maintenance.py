from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import typer

from apps.api.core.config import get_settings
from cli.commands.context import connector_context

maintenance_app = typer.Typer(help="Maintenance operations for connector state")


@maintenance_app.command("prune-downloads")
def prune_downloads(hours: int = typer.Option(24, help="Delete audit rows older than this many hours")) -> None:
    """Prune completed download audit entries older than the specified horizon."""

    async def _prune() -> None:
        async with connector_context() as (service, _, _, _, _):
            cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
            deleted = await service.sync_state.prune_downloads(cutoff)
            typer.echo(f"Removed {deleted} download audit rows older than {hours}h")

    asyncio.run(_prune())


@maintenance_app.command("cleanup-temp")
def cleanup_temp(hours: int = typer.Option(None, help="Override retention period in hours")) -> None:
    """Remove files in storage/tmp older than the configured retention window."""

    settings = get_settings()
    retention = hours or settings.connector_download_retention_hours
    cutoff = datetime.now() - timedelta(hours=retention)
    base_path: Path = settings.connector_storage_path
    deleted = 0
    if base_path.exists():
        for path in base_path.rglob("*"):
            if path.is_file() and datetime.fromtimestamp(path.stat().st_mtime) < cutoff:
                path.unlink(missing_ok=True)
                deleted += 1
    typer.echo(f"Deleted {deleted} files older than {retention}h from {base_path}")
