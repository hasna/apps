from __future__ import annotations

import asyncio
import json
from typing import Optional

import typer

from apps.api.clients.googledrive import DriveAPIError
from cli.commands.context import connector_context

permissions_app = typer.Typer(help="Manage Google Drive permissions")


@permissions_app.command("list")
def list_permissions(file_id: str = typer.Argument(..., help="Drive file ID")) -> None:
    async def _list() -> None:
        try:
            async with connector_context() as (service, _, _, _, _):
                payload = await service.list_permissions(file_id)
                typer.echo(json.dumps(payload, indent=2))
        except DriveAPIError as exc:
            typer.secho(f"Error listing permissions: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_list())


@permissions_app.command("grant")
def grant_permission(
    file_id: str = typer.Argument(..., help="Drive file ID"),
    role: str = typer.Option(..., help="Permission role (e.g., reader, writer)"),
    type_: str = typer.Option(..., help="Permission type (user, group, domain, anyone)", rich_help_panel="Grant Options"),
    email: Optional[str] = typer.Option(None, help="Email address for user/group permissions"),
    domain: Optional[str] = typer.Option(None, help="Domain for domain permissions"),
    allow_file_discovery: Optional[bool] = typer.Option(None, help="Whether the permission is discoverable"),
    notify: bool = typer.Option(False, help="Send notification email"),
) -> None:
    async def _grant() -> None:
        try:
            async with connector_context() as (service, _, _, _, _):
                result = await service.grant_permission(
                    file_id,
                    role=role,
                    type_=type_,
                    email_address=email,
                    domain=domain,
                    allow_file_discovery=allow_file_discovery,
                    send_notification_email=notify,
                )
                typer.echo(json.dumps(result, indent=2))
        except DriveAPIError as exc:
            typer.secho(f"Error granting permission: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_grant())


@permissions_app.command("revoke")
def revoke_permission(
    file_id: str = typer.Argument(..., help="Drive file ID"),
    permission_id: str = typer.Argument(..., help="Permission ID to revoke"),
) -> None:
    async def _revoke() -> None:
        try:
            async with connector_context() as (service, _, _, _, _):
                await service.revoke_permission(file_id, permission_id)
                typer.echo("Revoked")
        except DriveAPIError as exc:
            typer.secho(f"Error revoking permission: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_revoke())


@permissions_app.command("update")
def update_permission(
    file_id: str = typer.Argument(..., help="Drive file ID"),
    permission_id: str = typer.Argument(..., help="Permission ID to update"),
    role: Optional[str] = typer.Option(None, help="New role"),
    allow_file_discovery: Optional[bool] = typer.Option(None, help="Adjust allowFileDiscovery"),
) -> None:
    async def _update() -> None:
        try:
            async with connector_context() as (service, _, _, _, _):
                result = await service.update_permission(
                    file_id,
                    permission_id,
                    role=role,
                    allow_file_discovery=allow_file_discovery,
                )
                typer.echo(json.dumps(result, indent=2))
        except DriveAPIError as exc:
            typer.secho(f"Error updating permission: {exc}", err=True, fg=typer.colors.RED)
            raise typer.Exit(code=1) from exc

    asyncio.run(_update())
