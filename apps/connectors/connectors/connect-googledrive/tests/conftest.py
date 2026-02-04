import pytest

from apps.api.core.config import Settings


@pytest.fixture
def settings_payload() -> dict[str, object]:
    return {
        "GOOGLEDRIVE_CLIENT_ID": "client",
        "GOOGLEDRIVE_CLIENT_SECRET": "secret",
        "GOOGLEDRIVE_REFRESH_TOKEN": "refresh",
        "GOOGLEDRIVE_TOKEN_URL": "https://oauth2.googleapis.com/token",
        "GOOGLEDRIVE_AUTH_URL": "https://accounts.google.com/o/oauth2/v2/auth",
        "GOOGLEDRIVE_REDIRECT_URI": "https://localhost/callback",
        "GOOGLEDRIVE_API_BASE": "https://www.googleapis.com/drive/v3",
        "GOOGLEDRIVE_SCOPES": "https://www.googleapis.com/auth/drive.readonly",
        "CONNECTOR_STORAGE_PATH": "storage/tmp",
        "CONNECTOR_DOWNLOAD_RETENTION_HOURS": 24,
        "CONNECTOR_LOG_LEVEL": "INFO",
        "CONNECTOR_METRICS_PORT": 9400,
        "CONNECTOR_DATABASE_URL": "sqlite+aiosqlite:///./test-googledrive.db",
        "CONNECTOR_DEFAULT_ACCOUNT_ID": "default",
        "CONNECTOR_WEBHOOK_URL": "https://example.com/webhook",
        "CONNECTOR_ENABLE_OTEL": False,
    }


@pytest.fixture
def settings(settings_payload: dict[str, object]) -> Settings:
    return Settings.model_validate(settings_payload)
