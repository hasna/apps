from datetime import datetime, timedelta, timezone

import pytest

from apps.api.core.config import Settings
from apps.api.core.database import get_session_factory, init_database
from apps.api.services.sync_state import SyncStateService


@pytest.mark.asyncio
async def test_sync_checkpoint_round_trip(settings_payload, tmp_path):
    db_path = tmp_path / "state.db"
    payload = {**settings_payload, "CONNECTOR_DATABASE_URL": f"sqlite+aiosqlite:///{db_path}"}
    settings = Settings.model_validate(payload)
    await init_database(settings)
    session_factory = get_session_factory(settings)

    async with session_factory() as session:
        service = SyncStateService(session, account_id="acct")
        checkpoint = await service.upsert_checkpoint("files", "cursor-1")
        assert checkpoint.cursor == "cursor-1"
        fetched = await service.get_checkpoint("files")
        assert fetched is not None
        assert fetched.cursor == "cursor-1"

        audit = await service.record_download_start(
            file_id="file123",
            file_name="doc.txt",
            mime_type="text/plain",
            checksum="abc",
        )
        await service.record_download_complete(audit.id, bytes_downloaded=1024)
        deleted = await service.prune_downloads(datetime.now(timezone.utc) - timedelta(seconds=1))
        assert deleted == 1
