from fastapi import FastAPI, Request

from apps.api.core.app import create_app

app: FastAPI = create_app()


@app.get("/healthz", tags=["health"])
async def healthcheck(request: Request) -> dict[str, object]:
    base_url = str(request.base_url).rstrip("/")
    return {
        "status": "ok",
        "_links": {
            "self": {"href": str(request.url)},
            "capabilities": {"href": f"{base_url}/.well-known/ai-capabilities.json"},
        },
    }
