from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
import respx
from httpx import Response

from apps.api.clients.googledrive import OAuthTokenProvider
@pytest.mark.asyncio
async def test_token_provider_fetches_token(settings) -> None:
    with respx.mock(assert_all_called=True) as mock:
        mock.post("https://oauth2.googleapis.com/token").respond(
            200,
            json={"access_token": "abc123", "expires_in": 3600},
        )
        provider = OAuthTokenProvider(settings)
        token = await provider.get_token()
        assert token == "abc123"


@pytest.mark.asyncio
async def test_token_provider_caches_token(settings) -> None:
    with respx.mock(assert_all_called=True) as mock:
        mock.post("https://oauth2.googleapis.com/token").respond(
            200,
            json={"access_token": "cached", "expires_in": 3600},
        )
        provider = OAuthTokenProvider(settings)
        first = await provider.get_token()
        second = await provider.get_token()
        assert first == second == "cached"


@pytest.mark.asyncio
async def test_service_account_token(monkeypatch, settings_payload) -> None:
    payload = dict(settings_payload)
    payload["GOOGLEDRIVE_SERVICE_ACCOUNT_KEY_PATH"] = "/tmp/fake-key.json"
    payload["GOOGLEDRIVE_SERVICE_ACCOUNT_SUBJECT"] = "user@example.com"
    settings = Settings.model_validate(payload)

    dummy_credentials = MagicMock()
    dummy_credentials.token = "service-token"
    dummy_credentials.expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    dummy_credentials.with_subject.return_value = dummy_credentials

    def fake_from_service_account_file(path, scopes):  # type: ignore[override]
        assert path == "/tmp/fake-key.json"
        assert scopes == settings.googledrive_scopes
        return dummy_credentials

    def fake_refresh(request):  # type: ignore[override]
        dummy_credentials.token = "refreshed-token"

    dummy_credentials.refresh.side_effect = fake_refresh

    monkeypatch.setattr(
        "apps.api.clients.googledrive.service_account.Credentials.from_service_account_file",
        fake_from_service_account_file,
    )
    monkeypatch.setattr(
        "apps.api.clients.googledrive.Request",
        lambda: None,
    )

    provider = OAuthTokenProvider(settings)
    token = await provider.get_token()
    assert token == "refreshed-token"
