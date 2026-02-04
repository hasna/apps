from __future__ import annotations

import logging
import uuid
from typing import Any, Mapping

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

LOGGER = logging.getLogger(__name__)

PROBLEM_BASE = "https://problems.beepmedia.com/connect-googledrive"
DEFAULT_PROBLEM = f"{PROBLEM_BASE}/unexpected-error"
DEFAULT_SUPPORT_URL = "https://docs.beepmedia.com/connectors/googledrive/troubleshooting"

_STATUS_TITLES: dict[int, str] = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    422: "Unprocessable Content",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
}

_PROBLEM_DESCRIPTIONS: dict[int | str, str] = {
    400: "The request could not be understood or is missing required parameters.",
    401: "Authentication credentials are missing or invalid.",
    403: "The authenticated principal does not have access to the requested resource.",
    404: "The requested resource does not exist or is not visible to the caller.",
    409: "The requested action conflicts with the resource's current state.",
    "validation-error": "One or more fields failed validation; inspect invalidParams for details.",
    422: "The request body is syntactically valid but semantically incorrect.",
    429: "Too many requests were received in a given window.",
    500: "The connector encountered an unexpected error.",
    502: "The upstream Google Drive API returned an invalid or unexpected response.",
    503: "The service is temporarily unavailable; retry after a short wait.",
}


def _link_header(openapi_url: str, support_url: str | None, retry_url: str | None) -> str:
    links: list[str] = [f"<{openapi_url}>; rel=\"service-desc\""]
    if retry_url:
        links.append(f"<{retry_url}>; rel=\"retry\"")
    if support_url:
        links.append(f"<{support_url}>; rel=\"help\"")
    return ", ".join(links)


def build_problem_response(
    *,
    request: Request,
    status_code: int,
    type_override: str | None = None,
    title_override: str | None = None,
    detail: str | Mapping[str, Any] | None = None,
    extra: Mapping[str, Any] | None = None,
    support_url: str | None = None,
    retry_url: str | None = None,
) -> JSONResponse:
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    type_uri = type_override or f"{PROBLEM_BASE}/{status_code}"
    title = title_override or _STATUS_TITLES.get(status_code, "Unexpected Error")
    payload: dict[str, Any] = {
        "type": type_uri,
        "title": title,
        "status": status_code,
        "instance": str(request.url),
        "requestId": request_id,
    }
    if detail is not None:
        if isinstance(detail, (str, int, float)):
            payload["detail"] = detail
        elif isinstance(detail, list):
            payload["detail"] = detail
        elif isinstance(detail, Mapping):
            payload["detail"] = dict(detail)
        else:
            payload["detail"] = str(detail)
    if extra:
        payload.update(dict(extra))

    headers = {
        "Content-Type": "application/problem+json",
        "X-Request-ID": request_id,
    }
    openapi_path = getattr(request.app, "openapi_url", "/openapi.json") or "/openapi.json"
    openapi_url = f"{request.base_url.scheme}://{request.base_url.netloc}{openapi_path}"
    headers["Link"] = _link_header(openapi_url, support_url, retry_url or str(request.url))
    return JSONResponse(status_code=status_code, content=payload, headers=headers)


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail if exc.detail else None
    if isinstance(detail, Mapping):
        detail = dict(detail)
    return build_problem_response(
        request=request,
        status_code=exc.status_code,
        detail=detail,
        support_url=DEFAULT_SUPPORT_URL,
        retry_url=str(request.url),
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    detail = exc.errors()
    return build_problem_response(
        request=request,
        status_code=422,
        detail=detail,
        type_override=f"{PROBLEM_BASE}/validation-error",
        title_override="Validation Failed",
        extra={"invalidParams": detail} if detail else None,
        support_url=DEFAULT_SUPPORT_URL,
        retry_url=str(request.url),
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    LOGGER.exception("Unhandled server error", exc_info=exc)
    return build_problem_response(
        request=request,
        status_code=500,
        detail="An unexpected error occurred.",
        type_override=DEFAULT_PROBLEM,
        title_override="Unexpected Error",
        support_url="https://docs.beepmedia.com/connectors/googledrive/troubleshooting",
    )


def problem_catalog() -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    for code, title in _STATUS_TITLES.items():
        type_uri = f"{PROBLEM_BASE}/{code}"
        catalog.append(
            {
                "type": type_uri,
                "title": title,
                "status": code,
                "description": _PROBLEM_DESCRIPTIONS.get(code, ""),
            }
        )
    catalog.append(
        {
            "type": f"{PROBLEM_BASE}/validation-error",
            "title": "Validation Failed",
            "status": 422,
            "description": _PROBLEM_DESCRIPTIONS.get("validation-error", ""),
        }
    )
    catalog.append(
        {
            "type": DEFAULT_PROBLEM,
            "title": "Unexpected Error",
            "status": 500,
            "description": _PROBLEM_DESCRIPTIONS.get(500, ""),
        }
    )
    return catalog
