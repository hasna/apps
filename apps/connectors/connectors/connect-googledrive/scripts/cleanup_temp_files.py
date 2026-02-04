#!/usr/bin/env python3
"""Delete temporary files older than CONNECTOR_DOWNLOAD_RETENTION_HOURS."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta
from pathlib import Path

from apps.api.core.config import get_settings


async def main() -> None:
    settings = get_settings()
    cutoff = datetime.now() - timedelta(hours=settings.connector_download_retention_hours)
    deleted = 0
    base_path = settings.connector_storage_path
    if not base_path.exists():
        return
    for path in base_path.rglob("*"):
        if path.is_file():
            mtime = datetime.fromtimestamp(path.stat().st_mtime)
            if mtime < cutoff:
                path.unlink(missing_ok=True)
                deleted += 1
    print({"deleted": deleted})


if __name__ == "__main__":
    asyncio.run(main())
