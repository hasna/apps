from __future__ import annotations

import asyncio
import json
from datetime import timedelta
from typing import Optional

import typer

from apps.api.clients.googledrive import DriveAPIError
from cli.commands.context import connector_context

watch_app = typer.Typer(help="Google Drive watch management")


@watch_app.command("register")
def register_watch(ttl_seconds: int = typer.Option(86400, help="Channel lifetime in seconds")) -> None:
    async def _register() -> None:
        try:
            async with connector_context() as (_, __, watch_service, _, _):
                channel = await watch_service.register_changes_watch(ttl_seconds=ttl_seconds)
                typer.echo(json.dumps(
                    {
                        "channel_id": channel.channel_id,
                        "resource_id": channel.resource_id,
                        "expiration": channel.expiration.isoformat() if channel.expiration else None,
                        "token": channel.token,
                    },
                    indent=2,
                ))
        except (DriveAPIError, ValueError) as exc:
            typer.secho(f"Error registering watch: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_register())


@watch_app.command("list")
def list_watches() -> None:
    async def _list() -> None:
        async with connector_context() as (_, __, watch_service, _, _):
            channels = await watch_service.list_channels()
            typer.echo(
                json.dumps(
                    [
                        {
                            "channel_id": c.channel_id,
                            "resource_id": c.resource_id,
                            "expiration": c.expiration.isoformat() if c.expiration else None,
                            "token": c.token,
                        }
                        for c in channels
                    ],
                    indent=2,
                )
            )

    asyncio.run(_list())


@watch_app.command("delete")
def delete_watch(channel_id: str = typer.Argument(..., help="Channel identifier to stop"), resource_id: Optional[str] = typer.Option(None, help="Resource id")) -> None:
    async def _delete() -> None:
        try:
            async with connector_context() as (_, __, watch_service, _, _):
                await watch_service.delete_watch(channel_id=channel_id, resource_id=resource_id)
                typer.echo("Deleted")
        except DriveAPIError as exc:
            typer.secho(f"Error deleting watch: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_delete())


@watch_app.command("renew")
def renew_watches(
    hours: int = typer.Option(24, help="Renew channels expiring within this many hours"),
    ttl_seconds: int = typer.Option(86400, help="TTL to request for renewed channels"),
) -> None:
    async def _renew() -> None:
        try:
            async with connector_context() as (_, __, watch_service, _, _):
                renewed = await watch_service.renew_channels(
                    threshold=timedelta(hours=hours),
                    ttl_seconds=ttl_seconds,
                )
                typer.echo(json.dumps({"renewed": renewed}, indent=2))
        except DriveAPIError as exc:
            typer.secho(f"Error renewing watches: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_renew())
