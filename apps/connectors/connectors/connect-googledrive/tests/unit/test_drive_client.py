import pytest
import respx
from httpx import Response

from apps.api.clients.googledrive import GoogleDriveClient, OAuthTokenProvider
from apps.api.core.config import Settings


class DummyTokenProvider(OAuthTokenProvider):
    async def get_token(self, account_id=None):  # type: ignore[override]
        return "token"

    def invalidate(self, account_id=None):  # type: ignore[override]
        return None


@pytest.mark.asyncio
async def test_list_files_success(settings):
    provider = DummyTokenProvider(settings)
    client = GoogleDriveClient(settings=settings, token_provider=provider)
    with respx.mock(assert_all_called=True) as mock:
        mock.get("https://www.googleapis.com/drive/v3/files").respond(200, json={"files": []})
        data = await client.list_files()
        assert data == {"files": []}
    await client.aclose()


@pytest.mark.asyncio
async def test_list_files_retries_on_unauthorized(settings):
    provider = DummyTokenProvider(settings)
    client = GoogleDriveClient(settings=settings, token_provider=provider)
    with respx.mock(assert_all_called=True) as mock:
        route = mock.get("https://www.googleapis.com/drive/v3/files")
        route.side_effect = [
            Response(401, text="unauthorized"),
            Response(200, json={"files": ["retry"]}),
        ]
        data = await client.list_files()
        assert data == {"files": ["retry"]}
    await client.aclose()


@pytest.mark.asyncio
async def test_get_start_page_token(settings):
    provider = DummyTokenProvider(settings)
    client = GoogleDriveClient(settings=settings, token_provider=provider)
    with respx.mock(assert_all_called=True) as mock:
        mock.get("https://www.googleapis.com/drive/v3/changes/startPageToken").respond(
            200,
            json={"startPageToken": "123"},
        )
        token = await client.get_start_page_token()
        assert token == "123"
    await client.aclose()


@pytest.mark.asyncio
async def test_list_changes(settings):
    provider = DummyTokenProvider(settings)
    client = GoogleDriveClient(settings=settings, token_provider=provider)
    with respx.mock(assert_all_called=True) as mock:
        mock.get("https://www.googleapis.com/drive/v3/changes").respond(
            200,
            json={"changes": [{"fileId": "abc"}], "newStartPageToken": "456"},
        )
        payload = await client.list_changes(page_token="123")
        assert payload["changes"][0]["fileId"] == "abc"
    await client.aclose()


@pytest.mark.asyncio
async def test_permission_calls(settings):
    provider = DummyTokenProvider(settings)
    client = GoogleDriveClient(settings=settings, token_provider=provider)
    with respx.mock(assert_all_called=True) as mock:
        mock.get("https://www.googleapis.com/drive/v3/files/file123/permissions").respond(
            200,
            json={"permissions": []},
        )
        mock.post("https://www.googleapis.com/drive/v3/files/file123/permissions").respond(
            200,
            json={"id": "perm"},
        )
        mock.patch("https://www.googleapis.com/drive/v3/files/file123/permissions/perm").respond(
            200,
            json={"id": "perm", "role": "reader"},
        )
        mock.delete("https://www.googleapis.com/drive/v3/files/file123/permissions/perm").respond(204)

        perms = await client.list_permissions("file123")
        assert perms["permissions"] == []
        await client.create_permission("file123", {"role": "reader", "type": "anyone"})
        await client.update_permission("file123", "perm", {"role": "reader"})
        await client.delete_permission("file123", "perm")
    await client.aclose()
