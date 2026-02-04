from pathlib import Path

import pytest

from apps.api.clients.googledrive import DriveAPIError
from apps.api.core.config import Settings
from apps.api.core.database import get_session_factory, init_database
from apps.api.services.files import DriveFileService
from apps.api.services.sync_state import SyncStateService


class DummySession:
    async def commit(self) -> None:  # pragma: no cover - simple stub
        return None

    async def refresh(self, *_args, **_kwargs) -> None:  # pragma: no cover
        return None

    async def execute(self, *_args, **_kwargs):  # pragma: no cover
        class Result:
            scalar_one_or_none = staticmethod(lambda: None)

        return Result()

    def add(self, *_args, **_kwargs) -> None:  # pragma: no cover
        return None


class DummyClient:
    def __init__(self) -> None:
        self.saved_args: dict[str, object] = {}

    async def upload_file(self, **kwargs):
        self.saved_args = kwargs
        return {"id": "123", "name": kwargs.get("name", "file")}


class StubChangeClient(DummyClient):
    def __init__(self, changes: list[dict[str, object]], new_token: str) -> None:
        super().__init__()
        self.changes = changes
        self.new_token = new_token
        self.start_token = "start-token"

    async def get_start_page_token(self) -> str:
        return self.start_token

    async def list_changes(self, **_kwargs):
        return {"changes": self.changes, "newStartPageToken": self.new_token}


@pytest.mark.asyncio
async def test_upload_file_requires_media(tmp_path: Path, settings: Settings) -> None:
    client = DummyClient()
    service = DriveFileService(client=client, settings=settings, session=DummySession())

    with pytest.raises(DriveAPIError):
        await service.upload_file(name="test", mime_type="text/plain")

    file_path = tmp_path / "sample.txt"
    file_path.write_text("hello")
    await service.upload_file(name="sample.txt", mime_type="text/plain", local_path=file_path)
    assert client.saved_args["name"] == "sample.txt"


@pytest.mark.asyncio
async def test_sync_changes_initializes_checkpoint(tmp_path: Path, settings_payload) -> None:
    db_path = tmp_path / "sync.db"
    payload = {**settings_payload, "CONNECTOR_DATABASE_URL": f"sqlite+aiosqlite:///{db_path}"}
    settings = Settings.model_validate(payload)
    await init_database(settings)
    session_factory = get_session_factory(settings)

    async with session_factory() as session:
        client = StubChangeClient([], "new-token")
        service = DriveFileService(client=client, settings=settings, session=session)
        result = await service.sync_changes()
        assert result["initialised"] is True
        assert result["cursor"] == "start-token"
        checkpoint = await service.sync_state.get_checkpoint("files")
        assert checkpoint is not None
        assert checkpoint.cursor == "start-token"


@pytest.mark.asyncio
async def test_sync_changes_advances_checkpoint(tmp_path: Path, settings_payload) -> None:
    db_path = tmp_path / "sync2.db"
    payload = {**settings_payload, "CONNECTOR_DATABASE_URL": f"sqlite+aiosqlite:///{db_path}"}
    settings = Settings.model_validate(payload)
    await init_database(settings)
    session_factory = get_session_factory(settings)

    async with session_factory() as session:
        sync_state = SyncStateService(session, account_id=settings.googledrive_default_account_id)
        await sync_state.upsert_checkpoint("files", "cursor-1")

    async with session_factory() as session:
        client = StubChangeClient([{"fileId": "abc"}], "cursor-2")
        service = DriveFileService(client=client, settings=settings, session=session)
        result = await service.sync_changes(page_size=10)
        assert result["initialised"] is False
        assert result["cursor"] == "cursor-2"
        assert result["changes"][0]["fileId"] == "abc"

        checkpoint = await service.sync_state.get_checkpoint("files")
        assert checkpoint is not None
        assert checkpoint.cursor == "cursor-2"
