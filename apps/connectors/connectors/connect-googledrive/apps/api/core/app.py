from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
import httpx
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from apps.api.core.config import get_settings
from apps.api.core.database import get_session_factory, init_database
from apps.api.core.logging import setup_logging
from apps.api.core.metrics import MetricsMiddleware, metrics_endpoint
from apps.api.core.problem import (
    http_exception_handler,
    problem_catalog,
    unhandled_exception_handler,
    validation_exception_handler,
)
from apps.api.v1.routers import router as v1_router
from apps.api.services.token_store import TokenRepository


def create_app() -> FastAPI:
    settings = get_settings()
    setup_logging(settings)

    app = FastAPI(
        title="Connect Google Drive",
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_middleware(MetricsMiddleware)

    @app.on_event("startup")
    async def startup_event() -> None:
        await init_database(settings)

    if settings.connector_enable_otel:
        FastAPIInstrumentor.instrument_app(app)

    app.include_router(v1_router, prefix="/api/v1")

    @app.get("/.well-known/ai-capabilities.json", include_in_schema=False, name="ai_capabilities")
    async def ai_capabilities(request: Request) -> dict[str, object]:
        base_url = str(request.base_url).rstrip("/")
        openapi_url = f"{base_url}{app.openapi_url}"
        routes_url = f"{base_url}/api/v1/_meta/routes"
        problem_types_url = f"{base_url}/.well-known/problem-types.json"
        issued_at = datetime.now(tz=timezone.utc).isoformat()
        return {
            "name": app.title,
            "version": app.version,
            "description": "Discovery metadata for the Connect Google Drive integration.",
            "issued_at": issued_at,
            "schema_version": "2025-10-21",
            "openapi_url": openapi_url,
            "routes_url": routes_url,
            "problem_details_url": problem_types_url,
            "authentication": {
                "type": "oauth2",
                "scheme": "Bearer",
                "audience": settings.googledrive_client_id,
                "scopes": settings.googledrive_scopes,
                "token_url": settings.googledrive_token_url,
                "authorization_url": settings.googledrive_auth_url,
            },
            "rate_limits": {
                "per_minute": None,
                "notes": "Connector inherits Google Drive API quotas; configure upstream to enforce burst limits.",
            },
            "cli": {
                "discovery_command": "connect-googledrive capabilities",
                "usage": [
                    "connect-googledrive capabilities --format md",
                    "connect-googledrive capabilities --export routes --format json",
                ],
            },
            "problem_types": problem_catalog(),
            "_links": {
                "self": {"href": f"{base_url}/.well-known/ai-capabilities.json"},
                "openapi": {"href": openapi_url},
                "routes": {"href": routes_url},
                "problem-types": {"href": problem_types_url},
            },
        }

    @app.get("/.well-known/problem-types.json", include_in_schema=False, name="problem_types")
    async def problem_types() -> list[dict[str, object]]:
        return problem_catalog()

    @app.get("/metrics", include_in_schema=False)
    async def metrics() -> Response:
        return metrics_endpoint()

    @app.get("/oauth/callback", response_class=HTMLResponse, include_in_schema=False)
    async def oauth_callback(request: Request) -> HTMLResponse:
        settings = get_settings()
        params = dict(request.query_params)
        code = params.get("code")
        if not code:
            return HTMLResponse(
                """
                <html><body>
                <h3>Missing authorization code</h3>
                <p>No <code>code</code> parameter found on this request.</p>
                </body></html>
                """,
                status_code=400,
            )

        redirect_uri = f"{request.url.scheme}://{request.headers.get('host')}{request.url.path}"
        payload = {
            "client_id": settings.googledrive_client_id,
            "client_secret": settings.googledrive_client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                settings.googledrive_token_url,
                data=payload,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if resp.status_code >= 400:
            return HTMLResponse(
                f"<html><body><h3>Token exchange failed</h3><pre>{resp.text}</pre></body></html>",
                status_code=resp.status_code,
            )

        data = resp.json()
        access_token = data.get("access_token")
        refresh_token = data.get("refresh_token")
        expires_in = int(data.get("expires_in", 3600))
        scopes = data.get("scope")

        session_factory = get_session_factory(settings)
        async with session_factory() as session:
            repo = TokenRepository(session)
            await repo.upsert_credentials(
                account_id=settings.googledrive_default_account_id,
                access_token=access_token,
                refresh_token=refresh_token,
                expires_in=expires_in,
                scopes=scopes,
            )

        return HTMLResponse(
            """
            <html><body>
            <h3>Authorization complete</h3>
            <p>You can close this tab and return to the app.</p>
            </body></html>
            """,
            status_code=200,
        )
    return app
