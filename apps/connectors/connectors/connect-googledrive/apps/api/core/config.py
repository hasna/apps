from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the connector."""

    googledrive_client_id: str = Field(alias="GOOGLEDRIVE_CLIENT_ID")
    googledrive_client_secret: str = Field(alias="GOOGLEDRIVE_CLIENT_SECRET")
    googledrive_refresh_token: str | None = Field(
        default=None, alias="GOOGLEDRIVE_REFRESH_TOKEN"
    )
    googledrive_service_account_key_path: str | None = Field(
        default=None, alias="GOOGLEDRIVE_SERVICE_ACCOUNT_KEY_PATH"
    )
    googledrive_service_account_subject: str | None = Field(
        default=None, alias="GOOGLEDRIVE_SERVICE_ACCOUNT_SUBJECT"
    )
    googledrive_token_url: str = Field(alias="GOOGLEDRIVE_TOKEN_URL")
    googledrive_auth_url: str = Field(alias="GOOGLEDRIVE_AUTH_URL")
    googledrive_redirect_uri: str = Field(alias="GOOGLEDRIVE_REDIRECT_URI")
    googledrive_api_base: str = Field(alias="GOOGLEDRIVE_API_BASE")
    googledrive_scopes: List[str] = Field(
        alias="GOOGLEDRIVE_SCOPES",
        default_factory=lambda: [
            "https://www.googleapis.com/auth/drive.readonly",
            "https://www.googleapis.com/auth/drive.file",
        ],
    )
    googledrive_default_account_id: str = Field(
        default="default", alias="CONNECTOR_DEFAULT_ACCOUNT_ID"
    )

    connector_storage_path: Path = Field(
        default=Path("storage/tmp"), alias="CONNECTOR_STORAGE_PATH"
    )
    connector_download_retention_hours: int = Field(
        default=24, alias="CONNECTOR_DOWNLOAD_RETENTION_HOURS"
    )
    connector_log_level: str = Field(default="INFO", alias="CONNECTOR_LOG_LEVEL")
    connector_metrics_port: int = Field(default=9400, alias="CONNECTOR_METRICS_PORT")
    connector_database_url: str = Field(
        default="sqlite+aiosqlite:///./storage/connectors/googledrive.db",
        alias="CONNECTOR_DATABASE_URL",
    )
    connector_webhook_url: str | None = Field(default=None, alias="CONNECTOR_WEBHOOK_URL")
    sentry_dsn: str | None = Field(default=None, alias="SENTRY_DSN")
    connector_enable_otel: bool = Field(default=False, alias="CONNECTOR_ENABLE_OTEL")

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
