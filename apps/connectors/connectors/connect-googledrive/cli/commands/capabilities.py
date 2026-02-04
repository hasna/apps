from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Dict, List, Literal, Optional

import httpx
import typer
from rich.console import Console
from rich.markdown import Markdown
from rich.table import Table
from typer.main import get_command
import click

FormatOption = Literal["json", "md", "table"]
ExportOption = Literal["openapi", "routes", "cli"]

console = Console()


def resolve_backend_url(override: str | None) -> str:
    candidates = [
        override,
        os.getenv("CONNECT_GOOGLEDRIVE_BACKEND_URL"),
        os.getenv("CONNECT_BACKEND_URL"),
        os.getenv("BACKEND_URL"),
    ]
    for candidate in candidates:
        if candidate:
            return candidate.rstrip("/")
    return "http://127.0.0.1:8000"


def build_cli_tree(app: typer.Typer) -> Dict[str, Any]:
    click_app = get_command(app)

    def walk(command: click.Command, parent: str) -> Dict[str, Any]:
        name = command.name or parent or "connect-googledrive"
        path = f"{parent} {name}".strip() if parent else name
        node: Dict[str, Any] = {
            "name": name,
            "path": path,
            "help": (command.help or "").strip(),
            "options": [],
            "subcommands": [],
        }
        for param in command.params:
            entry = {
                "name": param.name,
                "param_type": param.param_type_name,
                "help": getattr(param, "help", None),
                "required": getattr(param, "required", False),
                "opts": list(getattr(param, "opts", [])),
                "secondary_opts": list(getattr(param, "secondary_opts", [])),
            }
            node["options"].append(entry)

        if isinstance(command, click.MultiCommand):
            ctx = click.Context(command, info_name=name)
            for sub_name in sorted(command.list_commands(ctx)):
                sub_cmd = command.get_command(ctx, sub_name)
                if sub_cmd is None:
                    continue
                node["subcommands"].append(walk(sub_cmd, path))

        return node

    return walk(click_app, "")


async def _fetch_json(client: httpx.AsyncClient, url: str) -> Any:
    response = await client.get(url)
    response.raise_for_status()
    return response.json()


def _render_capabilities_md(payload: Dict[str, Any]) -> None:
    scopes = payload.get("authentication", {}).get("scopes", [])
    problem_types = payload.get("problem_types", [])
    lines: List[str] = [
        f"# {payload.get('name', 'Connector Capabilities')}",
        "",
        f"- **Version:** `{payload.get('version', 'unknown')}`",
        f"- **Issued At:** `{payload.get('issued_at', 'n/a')}`",
        f"- **Schema Version:** `{payload.get('schema_version', 'n/a')}`",
        "",
        "## Endpoints",
        f"- OpenAPI: `{payload.get('openapi_url', 'n/a')}`",
        f"- Routes Index: `{payload.get('routes_url', 'n/a')}`",
        f"- Problem Types: `{payload.get('problem_details_url', 'n/a')}`",
        "",
        "## Authentication",
        f"- Type: `{payload.get('authentication', {}).get('type', 'n/a')}`",
        f"- Scheme: `{payload.get('authentication', {}).get('scheme', 'n/a')}`",
        f"- Token URL: `{payload.get('authentication', {}).get('token_url', 'n/a')}`",
        f"- Authorization URL: `{payload.get('authentication', {}).get('authorization_url', 'n/a')}`",
        f"- Scopes: `{', '.join(scopes) if scopes else 'n/a'}`",
        "",
        "## CLI",
        f"- Discovery Command: `{payload.get('cli', {}).get('discovery_command', 'connect-googledrive capabilities')}`",
    ]
    for example in payload.get("cli", {}).get("usage", []):
        lines.append(f"  - `{example}`")

    if problem_types:
        lines.append("")
        lines.append("## Problem Types")
        lines.append("| Type | Title | Status | Description |")
        lines.append("| --- | --- | --- | --- |")
        for entry in problem_types:
            lines.append(
                f"| `{entry.get('type')}` | {entry.get('title')} | {entry.get('status')} | {entry.get('description', '')} |"
            )

    console.print(Markdown("\n".join(lines)))


def _render_capabilities_table(payload: Dict[str, Any]) -> None:
    table = Table(title="Connector Capabilities", show_lines=False)
    table.add_column("Field", style="cyan", no_wrap=True)
    table.add_column("Value", style="white")

    table.add_row("Name", str(payload.get("name", "Connector Capabilities")))
    table.add_row("Version", str(payload.get("version", "unknown")))
    table.add_row("Issued At", str(payload.get("issued_at", "n/a")))
    table.add_row("Schema Version", str(payload.get("schema_version", "n/a")))
    table.add_row("OpenAPI URL", str(payload.get("openapi_url", "n/a")))
    table.add_row("Routes URL", str(payload.get("routes_url", "n/a")))
    table.add_row("Problem Types URL", str(payload.get("problem_details_url", "n/a")))

    auth = payload.get("authentication", {})
    scopes = ", ".join(auth.get("scopes", []))
    table.add_row("Auth Type", str(auth.get("type", "n/a")))
    table.add_row("Auth Scheme", str(auth.get("scheme", "n/a")))
    table.add_row("Token URL", str(auth.get("token_url", "n/a")))
    table.add_row("Authorization URL", str(auth.get("authorization_url", "n/a")))
    table.add_row("Scopes", scopes or "n/a")

    cli = payload.get("cli", {})
    table.add_row("CLI Discovery", str(cli.get("discovery_command", "connect-googledrive capabilities")))
    usage = "\n".join(cli.get("usage", []))
    table.add_row("Usage", usage or "n/a")

    console.print(table)

    problem_types = payload.get("problem_types", [])
    if problem_types:
        problem_table = Table(title="Problem Catalog", show_lines=False)
        problem_table.add_column("Type", style="magenta")
        problem_table.add_column("Title", style="cyan")
        problem_table.add_column("Status", style="white")
        problem_table.add_column("Description", style="white")
        for entry in problem_types:
            problem_table.add_row(
                str(entry.get("type")),
                str(entry.get("title")),
                str(entry.get("status")),
                str(entry.get("description", "")),
            )
        console.print(problem_table)


def _render_routes(routes: List[Dict[str, Any]], fmt: FormatOption) -> None:
    if fmt == "json":
        typer.echo(json.dumps(routes, indent=2))
        return
    if fmt == "md":
        lines = ["| Method | Path | Summary | Request Schema | Response Schema |", "| --- | --- | --- | --- | --- |"]
        for route in routes:
            lines.append(
                f"| {route['method']} | {route['path']} | {route.get('summary', '') or ''} | "
                f"{route.get('requestSchemaRef') or ''} | {route.get('responseSchemaRef') or ''} |"
            )
        lines.append("")
        lines.append("Examples:")
        for route in routes:
            lines.append(f"- `{route['method']} {route['path']}`")
            examples = route.get("examples", {})
            if examples:
                lines.append(f"  - curl: `{examples.get('curl')}`")
                lines.append(f"  - httpie: `{examples.get('httpie')}`")
        console.print(Markdown("\n".join(lines)))
        return

    table = Table(title="API Routes", show_lines=False)
    table.add_column("Method", style="cyan", no_wrap=True)
    table.add_column("Path", style="white")
    table.add_column("Summary", style="white")
    table.add_column("Request Schema", style="magenta")
    table.add_column("Response Schema", style="green")
    for route in routes:
        table.add_row(
            route["method"],
            route["path"],
            route.get("summary") or "",
            route.get("requestSchemaRef") or "",
            route.get("responseSchemaRef") or "",
        )
    console.print(table)


async def run_capabilities_command(
    *,
    app: typer.Typer,
    backend_override: Optional[str],
    fmt: FormatOption,
    export: Optional[ExportOption],
) -> None:
    if export == "cli":
        if fmt != "json":
            raise typer.BadParameter("CLI export is only available with --format json.")
        tree = build_cli_tree(app)
        typer.echo(json.dumps(tree, indent=2))
        return

    backend_url = resolve_backend_url(backend_override)
    well_known = f"{backend_url}/.well-known/ai-capabilities.json"

    capabilities: Dict[str, Any] | None = None
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            capabilities = await _fetch_json(client, well_known)

            if export == "openapi":
                openapi_url = capabilities.get("openapi_url") or f"{backend_url}/openapi.json"
                document = await _fetch_json(client, openapi_url)
                typer.echo(json.dumps(document, indent=2))
                return

            if export == "routes":
                routes_url = capabilities.get("routes_url") or f"{backend_url}/api/v1/_meta/routes"
                routes = await _fetch_json(client, routes_url)
                _render_routes(routes, fmt)
                return

    except httpx.HTTPError as exc:
        typer.secho(
            f"Failed to fetch discovery metadata from {well_known}: {exc}",
            err=True,
            fg=typer.colors.RED,
        )
        raise typer.Exit(code=1) from exc

    if capabilities is None:
        typer.secho("Capability payload was not retrieved.", err=True, fg=typer.colors.RED)
        raise typer.Exit(code=1)

    if fmt == "json":
        typer.echo(json.dumps(capabilities, indent=2))
    elif fmt == "md":
        _render_capabilities_md(capabilities)
    else:
        _render_capabilities_table(capabilities)


def run_capabilities(
    app: typer.Typer,
    backend_override: Optional[str],
    fmt: FormatOption,
    export: Optional[ExportOption],
) -> None:
    asyncio.run(
        run_capabilities_command(
            app=app,
            backend_override=backend_override,
            fmt=fmt,
            export=export,
        )
    )
