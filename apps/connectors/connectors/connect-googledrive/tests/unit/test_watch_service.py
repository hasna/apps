import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from apps.api.core.config import Settings
from apps.api.core.database import get_session_factory, init_database
from apps.api.services.watch import WatchService


class StubClient:
    def __init__(self) -> None:
        self.started_with: dict | None = None
        self.stopped: list[tuple[str, str | None]] = []

    async def get_start_page_token(self) -> str:
        return "token-1"

    async def start_changes_watch(self, *, page_token: str, body: dict) -> dict:
        self.started_with = {"page_token": page_token, "body": body}
        return {
            "resourceId": "resource-1",
            "resourceUri": "https://example.com",
            "expiration": str(int(datetime.now(timezone.utc).timestamp() * 1000)),
        }

    async def stop_channel(self, *, channel_id: str, resource_id: str | None = None) -> None:
        self.stopped.append((channel_id, resource_id))
        return None


@pytest.mark.asyncio
async def test_register_changes_watch(tmp_path, settings_payload):
    db_path = tmp_path / "watch.db"
    payload = {
        **settings_payload,
        "CONNECTOR_DATABASE_URL": f"sqlite+aiosqlite:///{db_path}",
        "CONNECTOR_WEBHOOK_URL": "https://example.com/webhook",
    }
    settings = Settings.model_validate(payload)
    await init_database(settings)
    session_factory = get_session_factory(settings)
    client = StubClient()

    async with session_factory() as session:
        service = WatchService(session=session, client=client, settings=settings)
        channel = await service.register_changes_watch(ttl_seconds=3600)
        assert channel.channel_id
        assert client.started_with["page_token"] == "token-1"


@pytest.mark.asyncio
async def test_upsert_channel(tmp_path, settings_payload):
    db_path = tmp_path / "watch2.db"
    payload = {
        **settings_payload,
        "CONNECTOR_DATABASE_URL": f"sqlite+aiosqlite:///{db_path}",
        "CONNECTOR_WEBHOOK_URL": "https://example.com/webhook",
    }
    settings = Settings.model_validate(payload)
    await init_database(settings)
    session_factory = get_session_factory(settings)
    client = StubClient()

    async with session_factory() as session:
        service = WatchService(session=session, client=client, settings=settings)
        record = await service.upsert_channel(
            {
                "id": "abc",
                "resourceId": "rid",
                "resourceUri": "https://example.com",
                "kind": "sync",
                "X-Goog-Channel-Expiration": datetime.now(timezone.utc).isoformat(),
            }
        )
        assert record.channel_id == "abc"
        validated = await service.ensure_valid_channel("abc", record.token)
        assert validated.channel_id == "abc"
        with pytest.raises(PermissionError):
            await service.ensure_valid_channel("abc", "wrong")


@pytest.mark.asyncio
async def test_renew_channels(tmp_path, settings_payload):
    db_path = tmp_path / "watch3.db"
    payload = {
        **settings_payload,
        "CONNECTOR_DATABASE_URL": f"sqlite+aiosqlite:///{db_path}",
        "CONNECTOR_WEBHOOK_URL": "https://example.com/webhook",
    }
    settings = Settings.model_validate(payload)
    await init_database(settings)
    session_factory = get_session_factory(settings)
    client = StubClient()

    async with session_factory() as session:
        service = WatchService(session=session, client=client, settings=settings)
        channel = await service.register_changes_watch(ttl_seconds=3600)
        # Force expiration in past
        channel.expiration = datetime.now(timezone.utc)
        await session.commit()
        renewed = await service.renew_channels(threshold=timedelta(hours=1), ttl_seconds=3600)
        assert renewed
        assert client.stopped
