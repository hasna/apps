from __future__ import annotations

import asyncio
import json
import urllib.parse
from typing import Optional

import httpx
import typer

from apps.api.core.config import get_settings
from apps.api.core.database import get_session_factory
from apps.api.services.token_store import TokenRepository

oauth_app = typer.Typer(help="OAuth management commands")
auth_app = typer.Typer(help="Authentication commands")


def _default_redirect(settings) -> str:
    return settings.googledrive_redirect_uri


@oauth_app.command("authorize")
def authorize(state: str = typer.Option("manual", help="Opaque state parameter"), redirect_uri: Optional[str] = typer.Option(None, help="Override redirect URI")) -> None:
    """Print the Google authorization URL."""
    settings = get_settings()
    redirect = redirect_uri or _default_redirect(settings)
    params = {
        "client_id": settings.googledrive_client_id,
        "redirect_uri": redirect,
        "response_type": "code",
        "scope": " ".join(settings.googledrive_scopes),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    url = f"{settings.googledrive_auth_url}?{urllib.parse.urlencode(params)}"
    typer.echo(url)
    typer.echo("Opening browser...")
    try:
        import webbrowser
        webbrowser.open_new_tab(url)
    except Exception as exc:
        typer.secho(f"Failed to open browser automatically: {exc}", err=True, fg=typer.colors.YELLOW)


@oauth_app.command("exchange")
def exchange(code: str = typer.Option(..., "--code", help="Authorization code from the redirect"), redirect_uri: Optional[str] = typer.Option(None, help="Redirect URI used during authorization")) -> None:
    """Exchange an authorization code for tokens."""
    settings = get_settings()
    redirect = redirect_uri or _default_redirect(settings)
    payload = {
        "client_id": settings.googledrive_client_id,
        "client_secret": settings.googledrive_client_secret,
        "code": code,
        "redirect_uri": redirect,
        "grant_type": "authorization_code",
    }
    with httpx.Client(timeout=20) as client:
        response = client.post(settings.googledrive_token_url, data=payload, headers={"Content-Type": "application/x-www-form-urlencoded"})
    response.raise_for_status()
    typer.echo(json.dumps(response.json(), indent=2))


@auth_app.command("login")
def login(
    state: str = typer.Option("manual", help="Opaque state parameter"),
    redirect_uri: Optional[str] = typer.Option(None, help="Override redirect URI"),
) -> None:
    """Authenticate with Google Drive. Opens browser for OAuth flow."""
    settings = get_settings()

    # Verify credentials are configured
    if not settings.googledrive_client_id or not settings.googledrive_client_secret:
        typer.secho("OAuth credentials not configured.", err=True, fg=typer.colors.RED)
        typer.secho(
            "Set GOOGLEDRIVE_CLIENT_ID and GOOGLEDRIVE_CLIENT_SECRET in .env file.",
            fg=typer.colors.YELLOW,
        )
        raise typer.Exit(code=1)

    redirect = redirect_uri or _default_redirect(settings)
    params = {
        "client_id": settings.googledrive_client_id,
        "redirect_uri": redirect,
        "response_type": "code",
        "scope": " ".join(settings.googledrive_scopes),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    url = f"{settings.googledrive_auth_url}?{urllib.parse.urlencode(params)}"

    typer.echo("Opening browser for Google authorization...")
    typer.echo(f"\nAuthorization URL:\n{url}\n")

    try:
        import webbrowser
        webbrowser.open_new_tab(url)
    except Exception as exc:
        typer.secho(f"Failed to open browser: {exc}", err=True, fg=typer.colors.YELLOW)
        typer.echo("Please open the URL above manually.")

    typer.echo("After authorizing, you'll be redirected to a URL like:")
    typer.echo(f"  {redirect}?code=AUTHORIZATION_CODE&state={state}")
    typer.echo("\nCopy the 'code' parameter and run:")
    typer.echo("  connect-googledrive auth callback --code YOUR_CODE")


@auth_app.command("callback")
def callback(
    code: str = typer.Option(..., "--code", help="Authorization code from the redirect URL"),
    redirect_uri: Optional[str] = typer.Option(None, help="Redirect URI used during authorization"),
) -> None:
    """Complete OAuth flow by exchanging authorization code for tokens."""
    settings = get_settings()
    redirect = redirect_uri or _default_redirect(settings)

    typer.echo("Exchanging authorization code for tokens...")

    payload = {
        "client_id": settings.googledrive_client_id,
        "client_secret": settings.googledrive_client_secret,
        "code": code,
        "redirect_uri": redirect,
        "grant_type": "authorization_code",
    }

    with httpx.Client(timeout=20) as client:
        response = client.post(
            settings.googledrive_token_url,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if response.status_code >= 400:
        typer.secho(f"Failed to exchange code: {response.text}", err=True, fg=typer.colors.RED)
        raise typer.Exit(code=1)

    data = response.json()
    access_token = data.get("access_token")
    refresh_token = data.get("refresh_token")
    expires_in = data.get("expires_in", 3600)
    scopes = data.get("scope", "")

    if not refresh_token:
        typer.secho("Warning: No refresh token received. You may need to re-authorize with prompt=consent.", fg=typer.colors.YELLOW)

    # Save tokens to database
    async def save_tokens() -> None:
        session_factory = get_session_factory(settings)
        async with session_factory() as session:
            repo = TokenRepository(session)
            await repo.upsert_credentials(
                account_id=settings.googledrive_default_account_id,
                access_token=access_token,
                refresh_token=refresh_token,
                expires_in=expires_in,
                scopes=scopes,
            )
            await session.commit()

    asyncio.run(save_tokens())

    typer.secho("Authentication successful!", fg=typer.colors.GREEN)
    typer.echo(f"Tokens saved for account: {settings.googledrive_default_account_id}")

    if refresh_token:
        typer.echo(f"\nRefresh token (save to .env as GOOGLEDRIVE_REFRESH_TOKEN):")
        typer.echo(f"  {refresh_token}")

    typer.echo("\nYou can now use the connector:")
    typer.echo("  connect-googledrive files list --scope my-drive")


@auth_app.command("status")
def status() -> None:
    """Check authentication status."""
    settings = get_settings()

    async def check_status() -> None:
        session_factory = get_session_factory(settings)
        async with session_factory() as session:
            repo = TokenRepository(session)
            record = await repo.get_credentials(settings.googledrive_default_account_id)

            if not record:
                typer.secho("Not authenticated.", fg=typer.colors.YELLOW)
                typer.echo("Run: connect-googledrive auth login")
                return

            typer.echo(f"Account: {record.account_id}")
            typer.echo(f"Has access token: {bool(record.access_token)}")
            typer.echo(f"Has refresh token: {bool(record.refresh_token)}")
            if record.expires_at:
                typer.echo(f"Token expires: {record.expires_at}")
            typer.echo(f"Scopes: {record.scopes or 'Not set'}")

            if record.refresh_token:
                typer.secho("Status: Authenticated", fg=typer.colors.GREEN)
            else:
                typer.secho("Status: Missing refresh token", fg=typer.colors.YELLOW)

    asyncio.run(check_status())
