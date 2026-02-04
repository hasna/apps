from __future__ import annotations

import time
from typing import Optional

from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

API_REQUEST_COUNT = Counter(
    "connector_api_requests_total",
    "Total API requests handled by the connector",
    labelnames=("method", "path", "status"),
)
API_REQUEST_LATENCY = Histogram(
    "connector_api_request_latency_seconds",
    "Latency of API requests",
    labelnames=("method", "path", "status"),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5),
)

DRIVE_REQUEST_COUNT = Counter(
    "connector_drive_requests_total",
    "Total Google Drive API requests issued",
    labelnames=("method", "endpoint", "status"),
)
DRIVE_REQUEST_LATENCY = Histogram(
    "connector_drive_request_latency_seconds",
    "Latency of Google Drive API requests",
    labelnames=("method", "endpoint"),
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10),
)
DRIVE_REQUEST_ERRORS = Counter(
    "connector_drive_request_errors_total",
    "Count of Google Drive API request failures",
    labelnames=("method", "endpoint", "error"),
)


def metrics_endpoint() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


def _normalise_path(path: str) -> str:
    if path.startswith("/api/v1/files/") and path.count("/") > 3:
        return "/api/v1/files/:id"
    return path


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> StarletteResponse:
        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            duration = time.perf_counter() - start
            path = _normalise_path(request.url.path)
            labels = {
                "method": request.method,
                "path": path,
                "status": str(status_code),
            }
            API_REQUEST_COUNT.labels(**labels).inc()
            API_REQUEST_LATENCY.labels(**labels).observe(duration)


def observe_drive_request(
    method: str,
    endpoint: str,
    status_code: int,
    duration: float,
    error_type: Optional[str] = None,
) -> None:
    safe_endpoint = endpoint.split("?")[0]
    DRIVE_REQUEST_COUNT.labels(method=method, endpoint=safe_endpoint, status=str(status_code)).inc()
    DRIVE_REQUEST_LATENCY.labels(method=method, endpoint=safe_endpoint).observe(duration)
    if error_type:
        DRIVE_REQUEST_ERRORS.labels(method=method, endpoint=safe_endpoint, error=error_type).inc()
