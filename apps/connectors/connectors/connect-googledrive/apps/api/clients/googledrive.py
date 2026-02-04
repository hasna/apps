from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Dict, Iterable, Optional

import httpx
from google.auth.transport.requests import Request
from google.oauth2 import service_account
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

from apps.api.core.config import Settings
from apps.api.core.logging import get_logger
from apps.api.core.metrics import observe_drive_request
from apps.api.services.token_store import TokenRepository


class DriveAPIError(Exception):
    """Raised when the Google Drive API returns a non-retriable error response."""

    def __init__(self, message: str, status_code: int, payload: Any | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


class DriveRetriableError(DriveAPIError):
    """Raised when the request should be retried automatically."""


@dataclass
class AccessToken:
    token: str
    expires_at: datetime | None = None

    def is_valid(self) -> bool:
        if self.expires_at is None:
            return True
        expires_at = self.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) < expires_at - timedelta(seconds=60)


class OAuthTokenProvider:
    """Retrieve, cache, and store Google Drive OAuth tokens."""

    def __init__(
        self,
        settings: Settings,
        *,
        repository: TokenRepository | None = None,
        default_account_id: str | None = None,
    ) -> None:
        self._settings = settings
        self._repository = repository
        self._default_account_id = default_account_id or settings.googledrive_default_account_id
        self._tokens: dict[str, AccessToken] = {}
        self._lock = asyncio.Lock()
        self._logger = get_logger(__name__)
        self._service_account_credentials: service_account.Credentials | None = None

    async def get_token(self, account_id: str | None = None) -> str:
        acct = account_id or self._default_account_id
        async with self._lock:
            cached = self._tokens.get(acct)
            if cached and cached.is_valid():
                return cached.token

            if self._settings.googledrive_service_account_key_path:
                token = await self._obtain_service_account_token()
                self._tokens[acct] = token
                if self._repository and token.expires_at:
                    expires_in = int((token.expires_at - datetime.now(timezone.utc)).total_seconds())
                    await self._repository.upsert_credentials(
                        account_id=acct,
                        access_token=token.token,
                        refresh_token=None,
                        expires_in=max(expires_in, 0),
                        scopes=" ".join(self._settings.googledrive_scopes),
                        is_service_account=True,
                    )
                return token.token

            refresh_token: str | None = None
            scopes: str | None = None
            if self._repository:
                record = await self._repository.get_credentials(acct)
                if record and record.access_token and record.expires_at:
                    access_token = AccessToken(token=record.access_token, expires_at=record.expires_at)
                    if access_token.is_valid():
                        self._tokens[acct] = access_token
                        return access_token.token
                if record and record.refresh_token:
                    refresh_token = record.refresh_token
                    scopes = record.scopes

            if not refresh_token:
                refresh_token = self._settings.googledrive_refresh_token

            if not refresh_token:
                raise DriveAPIError(
                    "No refresh token configured for Google Drive connector",
                    status_code=401,
                )

            payload: Dict[str, str] = {
                "client_id": self._settings.googledrive_client_id,
                "client_secret": self._settings.googledrive_client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            }
            if scopes:
                payload["scope"] = scopes

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self._settings.googledrive_token_url,
                    data=payload,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    timeout=20,
                )

            if response.status_code >= 400:
                error_payload = response.json()
                error_desc = error_payload.get("error_description", error_payload.get("error", "Unknown error"))
                raise DriveAPIError(
                    f"Failed to refresh Google Drive access token: {error_desc}",
                    status_code=response.status_code,
                    payload=error_payload,
                )

            data = response.json()
            expires_in = int(data.get("expires_in", 3600))
            access_token = data["access_token"]
            refresh_from_response = data.get("refresh_token") or refresh_token
            scopes_from_response = data.get("scope") or scopes

            token = AccessToken(
                token=access_token,
                expires_at=datetime.now(timezone.utc) + timedelta(seconds=expires_in),
            )
            self._tokens[acct] = token

            if self._repository:
                await self._repository.upsert_credentials(
                    account_id=acct,
                    access_token=access_token,
                    refresh_token=refresh_from_response,
                    expires_in=expires_in,
                    scopes=scopes_from_response,
                )

            if expires_in <= 600:
                self._logger.warning(
                    "access_token_near_expiry",
                    account_id=acct,
                    expires_in=expires_in,
                )

            return token.token

    def invalidate(self, account_id: str | None = None) -> None:
        acct = account_id or self._default_account_id
        if acct in self._tokens:
            del self._tokens[acct]

    async def _obtain_service_account_token(self) -> AccessToken:
        creds = await asyncio.to_thread(self._refresh_service_account_credentials)
        expiry = creds.expiry
        if expiry and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        return AccessToken(token=creds.token, expires_at=expiry)

    def _refresh_service_account_credentials(self) -> service_account.Credentials:
        if not self._settings.googledrive_service_account_key_path:
            raise DriveAPIError("Service account key path not configured", status_code=500)

        if self._service_account_credentials is None:
            credentials = service_account.Credentials.from_service_account_file(
                self._settings.googledrive_service_account_key_path,
                scopes=self._settings.googledrive_scopes,
            )
            if self._settings.googledrive_service_account_subject:
                credentials = credentials.with_subject(self._settings.googledrive_service_account_subject)
            self._service_account_credentials = credentials

        request = Request()
        self._service_account_credentials.refresh(request)
        return self._service_account_credentials


class GoogleDriveClient:
    """HTTP client wrapper for Google Drive REST API."""

    def __init__(
        self,
        settings: Settings,
        token_provider: OAuthTokenProvider,
        *,
        account_id: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._settings = settings
        self._token_provider = token_provider
        self._account_id = account_id or settings.googledrive_default_account_id
        self._client = httpx.AsyncClient(
            base_url=settings.googledrive_api_base,
            timeout=timeout,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _request(
        self,
        method: str,
        url: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
        data: Any | None = None,
        files: Any | None = None,
        headers: Optional[Dict[str, str]] = None,
        stream: bool = False,
    ) -> httpx.Response:
        token = await self._token_provider.get_token(self._account_id)
        req_headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        if headers:
            req_headers.update(headers)

        retry = AsyncRetrying(
            wait=wait_exponential_jitter(initial=1, max=30),
            stop=stop_after_attempt(5),
            retry=retry_if_exception_type((httpx.TransportError, DriveRetriableError)),
        )

        start = time.perf_counter()
        status_code: int = 500
        error_type: str | None = None
        endpoint_label = self._resolve_endpoint_label(url)

        try:
            async for attempt in retry:
                with attempt:
                    response = await self._client.request(
                        method,
                        url,
                        params=params,
                        json=json,
                        data=data,
                        files=files,
                        headers=req_headers,
                        timeout=None if stream else self._client.timeout,
                    )
                    status_code = response.status_code
                    if response.status_code == 401:
                        self._token_provider.invalidate(self._account_id)
                        error_type = "unauthorized"
                        raise DriveRetriableError(
                            "Unauthorized request",
                            status_code=401,
                            payload=response.text,
                        )
                    if response.status_code == 429 or response.status_code >= 500:
                        error_type = "retryable"
                        raise DriveRetriableError(
                            "Drive API throttled or server error",
                            status_code=response.status_code,
                            payload=response.text,
                        )
                    if response.status_code >= 400:
                        error_type = "client_error"
                        raise DriveAPIError(
                            "Drive API returned error",
                            status_code=response.status_code,
                            payload=response.json(),
                        )
                    return response
        except DriveAPIError as exc:
            status_code = exc.status_code
            error_type = error_type or exc.__class__.__name__
            raise
        finally:
            duration = time.perf_counter() - start
            observe_drive_request(method, endpoint_label, status_code, duration, error_type)

        raise DriveAPIError("Failed to complete request after retries", status_code=status_code)

    def _resolve_endpoint_label(self, url: str) -> str:
        if url.startswith("http"):
            parsed = httpx.URL(url)
            return parsed.path
        base = httpx.URL(str(self._client.base_url))
        joined = base.join(url)
        return joined.path

    async def list_files(
        self,
        *,
        page_size: int = 100,
        page_token: str | None = None,
        q: str | None = None,
        fields: Iterable[str] | None = None,
        include_folders: bool = True,
        corpora: str | None = None,
        drive_id: str | None = None,
        include_items_from_all_drives: bool = True,
    ) -> dict[str, Any]:
        params: Dict[str, Any] = {
            "pageSize": min(max(page_size, 1), 1000),
        }
        if page_token:
            params["pageToken"] = page_token
        if q:
            params["q"] = q
        if not include_folders:
            params["q"] = "mimeType!='application/vnd.google-apps.folder'" + (f" and {q}" if q else "")

        default_fields = [
            "files(id,name,mimeType,modifiedTime,ownedByMe,parents,size,webViewLink,iconLink)",
            "nextPageToken",
        ]
        params["fields"] = f"files({','.join(fields)})" if fields else ",".join(default_fields)

        effective_corpora = corpora
        if drive_id and not effective_corpora:
            effective_corpora = "drive"

        if effective_corpora:
            params["corpora"] = effective_corpora

        if drive_id:
            params["driveId"] = drive_id

        if effective_corpora in {"allDrives", "drive"} or drive_id or include_items_from_all_drives:
            params["supportsAllDrives"] = True
            params["includeItemsFromAllDrives"] = True
        else:
            params["supportsAllDrives"] = False
            params["includeItemsFromAllDrives"] = False

        response = await self._request("GET", "/files", params=params)
        return response.json()

    async def iter_files(self, **kwargs: Any) -> AsyncIterator[dict[str, Any]]:
        page_token: str | None = None
        while True:
            page = await self.list_files(page_token=page_token, **kwargs)
            for item in page.get("files", []):
                yield item
            page_token = page.get("nextPageToken")
            if not page_token:
                break

    async def download_file(self, file_id: str) -> httpx.Response:
        params = {"alt": "media", "supportsAllDrives": True}
        response = await self._request(
            "GET",
            f"/files/{file_id}",
            params=params,
            headers={"Accept": "application/octet-stream"},
            stream=True,
        )
        return response

    async def create_folder(self, name: str, *, parents: list[str] | None = None) -> dict[str, Any]:
        body: Dict[str, Any] = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
        }
        if parents:
            body["parents"] = parents
        response = await self._request("POST", "/files", json=body)
        return response.json()

    async def upload_file(
        self,
        name: str,
        *,
        media: bytes,
        mime_type: str,
        parents: list[str] | None = None,
    ) -> dict[str, Any]:
        metadata: Dict[str, Any] = {"name": name}
        if parents:
            metadata["parents"] = parents

        upload_url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
        files_payload = {
            "metadata": ("metadata", json.dumps(metadata), "application/json"),
            "file": (name, media, mime_type),
        }
        response = await self._request("POST", upload_url, files=files_payload)
        return response.json()

    async def get_file_metadata(
        self,
        file_id: str,
        *,
        fields: Iterable[str] | None = None,
    ) -> dict[str, Any]:
        params: Dict[str, Any] = {"supportsAllDrives": True}
        if fields:
            params["fields"] = ",".join(fields)
        response = await self._request("GET", f"/files/{file_id}", params=params)
        return response.json()

    async def get_start_page_token(self) -> str:
        response = await self._request("GET", "/changes/startPageToken")
        data = response.json()
        return data["startPageToken"]

    async def list_changes(
        self,
        *,
        page_token: str,
        page_size: int = 100,
        fields: Iterable[str] | None = None,
    ) -> dict[str, Any]:
        params: Dict[str, Any] = {
            "pageToken": page_token,
            "pageSize": min(max(page_size, 1), 1000),
            "includeItemsFromAllDrives": True,
            "supportsAllDrives": True,
            "spaces": "drive",
        }
        if fields:
            params["fields"] = ",".join(fields)
        response = await self._request("GET", "/changes", params=params)
        return response.json()

    async def iter_changes(
        self,
        *,
        page_token: str,
        page_size: int = 100,
        fields: Iterable[str] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        token = page_token
        while True:
            payload = await self.list_changes(page_token=token, page_size=page_size, fields=fields)
            for change in payload.get("changes", []):
                yield change
            token = payload.get("nextPageToken")
            if not token:
                break

    async def start_changes_watch(self, *, page_token: str, body: Dict[str, Any]) -> dict[str, Any]:
        response = await self._request("POST", "/changes/watch", params={"pageToken": page_token}, json=body)
        return response.json()

    async def stop_channel(self, *, channel_id: str, resource_id: str | None = None) -> None:
        payload: Dict[str, Any] = {"id": channel_id}
        if resource_id:
            payload["resourceId"] = resource_id
        await self._request("POST", "https://www.googleapis.com/drive/v3/channels/stop", json=payload)

    async def list_permissions(self, file_id: str) -> dict[str, Any]:
        params = {"supportsAllDrives": True}
        response = await self._request("GET", f"/files/{file_id}/permissions", params=params)
        return response.json()

    async def create_permission(
        self,
        file_id: str,
        body: Dict[str, Any],
        *,
        send_notification_email: bool = False,
    ) -> dict[str, Any]:
        params = {
            "supportsAllDrives": True,
            "sendNotificationEmail": str(send_notification_email).lower(),
        }
        response = await self._request(
            "POST",
            f"/files/{file_id}/permissions",
            params=params,
            json=body,
        )
        return response.json()

    async def delete_permission(self, file_id: str, permission_id: str) -> None:
        params = {"supportsAllDrives": True}
        await self._request("DELETE", f"/files/{file_id}/permissions/{permission_id}", params=params)

    async def update_permission(
        self,
        file_id: str,
        permission_id: str,
        body: Dict[str, Any],
    ) -> dict[str, Any]:
        params = {"supportsAllDrives": True}
        response = await self._request(
            "PATCH",
            f"/files/{file_id}/permissions/{permission_id}",
            params=params,
            json=body,
        )
        return response.json()

    async def list_drives(
        self,
        *,
        page_size: int = 100,
        page_token: str | None = None,
    ) -> dict[str, Any]:
        params: Dict[str, Any] = {
            "pageSize": min(max(page_size, 1), 100),
        }
        if page_token:
            params["pageToken"] = page_token
        response = await self._request("GET", "/drives", params=params)
        return response.json()

    async def iter_drives(self, **kwargs: Any) -> AsyncIterator[dict[str, Any]]:
        page_token: str | None = None
        while True:
            page = await self.list_drives(page_token=page_token, **kwargs)
            for drive in page.get("drives", []):
                yield drive
            page_token = page.get("nextPageToken")
            if not page_token:
                break
