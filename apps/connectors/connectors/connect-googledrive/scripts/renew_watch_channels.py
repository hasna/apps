#!/usr/bin/env python3
"""Renew Google Drive watch channels nearing expiration."""

from __future__ import annotations

import asyncio
import json
from datetime import timedelta

import typer

from cli.commands.context import connector_context


async def main() -> None:
    async with connector_context() as (_, __, watch_service, _, __):
        renewed = await watch_service.renew_channels(threshold=timedelta(hours=12))
        typer.echo(json.dumps({"renewed": renewed}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
