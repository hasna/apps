import pytest

from apps.api.core.config import Settings
from apps.api.core.database import get_session_factory, init_database
from apps.api.services.token_store import TokenRepository


@pytest.mark.asyncio
async def test_upsert_and_retrieve_token(settings_payload, tmp_path):
    db_path = tmp_path / "tokens.db"
    payload = {**settings_payload, "CONNECTOR_DATABASE_URL": f"sqlite+aiosqlite:///{db_path}"}
    settings = Settings.model_validate(payload)
    await init_database(settings)
    session_factory = get_session_factory(settings)

    async with session_factory() as session:
        repo = TokenRepository(session)
        record = await repo.upsert_credentials(
            account_id="alice",
            access_token="token",
            refresh_token="refresh",
            expires_in=3600,
            scopes="scope",
        )
        assert record.account_id == "alice"
        assert record.refresh_token == "refresh"

    async with session_factory() as session:
        repo = TokenRepository(session)
        fetched = await repo.get_credentials("alice")
        assert fetched is not None
        assert fetched.access_token == "token"
        assert fetched.refresh_token == "refresh"
