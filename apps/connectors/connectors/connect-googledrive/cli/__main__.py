from typing import Optional, cast

import typer

from cli.commands.capabilities import ExportOption, FormatOption, run_capabilities
from cli.commands.downloads import downloads_app
from cli.commands.drives import drives_app
from cli.commands.oauth import oauth_app, auth_app
from cli.commands.files import files_app
from cli.commands.folders import folders_app
from cli.commands.maintenance import maintenance_app
from cli.commands.permissions import permissions_app
from cli.commands.watch import watch_app

app = typer.Typer(
    help=(
        "Connect Google Drive Connector CLI\n\n"
        "Use these commands to manage catalogued drives, list or download content, "
        "and administer watch channels. Activate the Python virtual environment "
        "(or run the ./connect-googledrive wrapper) before invoking any commands."
    ),
    no_args_is_help=True,
)
app.info_name = "connect-googledrive"
app.add_typer(files_app, name="files")
app.add_typer(folders_app, name="folders")
app.add_typer(maintenance_app, name="maintenance")
app.add_typer(watch_app, name="watch")
app.add_typer(permissions_app, name="permissions")
app.add_typer(drives_app, name="drives")
app.add_typer(downloads_app, name="downloads")
app.add_typer(oauth_app, name="oauth")
app.add_typer(auth_app, name="auth")


@app.command("capabilities")
def capabilities(
    format: str = typer.Option("md", "--format", "-f", case_sensitive=False, help="Output format: json, md, or table."),
    export: Optional[str] = typer.Option(
        None,
        "--export",
        case_sensitive=False,
        help="Special exporters: openapi, routes, cli.",
    ),
    backend: Optional[str] = typer.Option(
        None,
        "--backend",
        help="Override the connector backend base URL (defaults to env vars).",
    ),
) -> None:
    fmt_normalized = format.lower()
    if fmt_normalized not in {"json", "md", "table"}:
        raise typer.BadParameter("Format must be one of: json, md, table.")
    fmt = cast(FormatOption, fmt_normalized)

    export_normalized = export.lower() if export else None
    if export_normalized and export_normalized not in {"openapi", "routes", "cli"}:
        raise typer.BadParameter("Export must be one of: openapi, routes, cli.")
    export_option = cast(Optional[ExportOption], export_normalized)

    run_capabilities(app=app, backend_override=backend, fmt=fmt, export=export_option)


def run() -> None:
    app(prog_name="connect-googledrive")


if __name__ == "__main__":
    run()
