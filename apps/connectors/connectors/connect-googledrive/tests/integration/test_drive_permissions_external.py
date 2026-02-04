import os

import pytest

from apps.api.clients.googledrive import GoogleDriveClient, OAuthTokenProvider
from apps.api.core.config import get_settings

pytestmark = pytest.mark.external


@pytest.mark.asyncio
async def test_list_permissions_external(monkeypatch):
    if not os.getenv("INCLUDE_EXTERNAL_TESTS"):
        pytest.skip("External tests disabled")

    file_id = os.getenv("GOOGLEDRIVE_TEST_FILE_ID")
    if not file_id:
        pytest.skip("GOOGLEDRIVE_TEST_FILE_ID not set")

    settings = get_settings()
    token_provider = OAuthTokenProvider(settings)
    client = GoogleDriveClient(settings=settings, token_provider=token_provider)
    try:
        payload = await client.list_permissions(file_id)
        assert "permissions" in payload
    finally:
        await client.aclose()
