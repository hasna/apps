from collections.abc import AsyncGenerator

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.clients.googledrive import GoogleDriveClient, OAuthTokenProvider
from apps.api.core.config import Settings, get_settings
from apps.api.core.database import get_session
from apps.api.services.drives import DriveDirectoryService
from apps.api.services.files import DriveFileService
from apps.api.services.permissions import PermissionService
from apps.api.services.token_store import TokenRepository
from apps.api.services.watch import WatchService
from apps.api.services.downloads import DownloadHistoryService


async def get_settings_dependency() -> Settings:
    return get_settings()


async def get_session_dependency(
    settings: Settings = Depends(get_settings_dependency),
) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_session(settings):
        yield session


async def get_drive_client(
    settings: Settings = Depends(get_settings_dependency),
    session: AsyncSession = Depends(get_session_dependency),
) -> AsyncGenerator[GoogleDriveClient, None]:
    repository = TokenRepository(session)
    token_provider = OAuthTokenProvider(settings, repository=repository)
    client = GoogleDriveClient(
        settings=settings,
        token_provider=token_provider,
        account_id=settings.googledrive_default_account_id,
    )
    try:
        yield client
    finally:
        await client.aclose()


async def get_drive_file_service(
    client: GoogleDriveClient = Depends(get_drive_client),
    settings: Settings = Depends(get_settings_dependency),
    session: AsyncSession = Depends(get_session_dependency),
) -> DriveFileService:
    return DriveFileService(client=client, settings=settings, session=session)


async def get_watch_service(
    client: GoogleDriveClient = Depends(get_drive_client),
    settings: Settings = Depends(get_settings_dependency),
    session: AsyncSession = Depends(get_session_dependency),
) -> WatchService:
    return WatchService(session=session, client=client, settings=settings)


async def get_permission_service(
    client: GoogleDriveClient = Depends(get_drive_client),
    settings: Settings = Depends(get_settings_dependency),
    session: AsyncSession = Depends(get_session_dependency),
) -> PermissionService:
    return PermissionService(client=client, settings=settings, session=session)


async def get_drive_directory_service(
    client: GoogleDriveClient = Depends(get_drive_client),
    session: AsyncSession = Depends(get_session_dependency),
) -> DriveDirectoryService:
    return DriveDirectoryService(session=session, client=client)


async def get_download_history_service(
    settings: Settings = Depends(get_settings_dependency),
    session: AsyncSession = Depends(get_session_dependency),
) -> DownloadHistoryService:
    return DownloadHistoryService(session=session, account_id=settings.googledrive_default_account_id)
