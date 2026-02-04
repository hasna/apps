#!/usr/bin/env python3
"""
Helper script to generate an OAuth authorization URL for Google Drive.

Usage:
    source .venv/bin/activate
    python scripts/bootstrap_oauth.py --state dev
"""

from __future__ import annotations

import argparse
import urllib.parse

from apps.api.core.config import get_settings


def build_auth_url(state: str) -> str:
    settings = get_settings()
    params = {
        "client_id": settings.googledrive_client_id,
        "redirect_uri": settings.googledrive_redirect_uri,
        "response_type": "code",
        "scope": " ".join(settings.googledrive_scopes),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{settings.googledrive_auth_url}?{urllib.parse.urlencode(params)}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Google Drive OAuth URL.")
    parser.add_argument("--state", default="dev", help="Opaque state parameter for redirect verification")
    args = parser.parse_args()
    url = build_auth_url(args.state)
    print(url)


if __name__ == "__main__":
    main()
