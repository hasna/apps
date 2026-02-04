from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator, Tuple

from apps.api.clients.googledrive import GoogleDriveClient, OAuthTokenProvider
from apps.api.core.config import get_settings
from apps.api.core.database import get_session_factory
from apps.api.services.downloads import DownloadHistoryService
from apps.api.services.drives import DriveDirectoryService
from apps.api.services.files import DriveFileService
from apps.api.services.token_store import TokenRepository
from apps.api.services.watch import WatchService


@asynccontextmanager
async def connector_context() -> AsyncIterator[Tuple[DriveFileService, GoogleDriveClient, WatchService, DriveDirectoryService, DownloadHistoryService]]:
    settings = get_settings()
    session_factory = get_session_factory(settings)
    async with session_factory() as session:
        repository = TokenRepository(session)
        token_provider = OAuthTokenProvider(
            settings,
            repository=repository,
            default_account_id=settings.googledrive_default_account_id,
        )
        client = GoogleDriveClient(
            settings=settings,
            token_provider=token_provider,
            account_id=settings.googledrive_default_account_id,
        )
        file_service = DriveFileService(client=client, settings=settings, session=session)
        watch_service = WatchService(session=session, client=client, settings=settings)
        directory_service = DriveDirectoryService(session=session, client=client)
        download_history_service = DownloadHistoryService(
            session=session, account_id=settings.googledrive_default_account_id
        )
        try:
            yield file_service, client, watch_service, directory_service, download_history_service
        finally:
            await client.aclose()
