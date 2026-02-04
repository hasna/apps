from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from apps.api.v1.schemas.meta import RouteDescriptor, RouteExample

router = APIRouter()

_REQUEST_MEDIA_ORDER = (
    "application/json",
    "multipart/form-data",
    "application/x-www-form-urlencoded",
)


def _extract_schema_ref(schema: dict[str, Any] | None) -> str | None:
    if not schema:
        return None
    if "$ref" in schema:
        return schema["$ref"]
    if "items" in schema and isinstance(schema["items"], dict):
        ref = schema["items"].get("$ref")
        if ref:
            return ref
    return None


@router.get("/routes", response_model=list[RouteDescriptor], name="list_routes")
async def list_routes(request: Request) -> list[RouteDescriptor]:
    app = request.app
    openapi_schema = app.openapi()
    base_url = str(request.base_url).rstrip("/")
    descriptors: list[RouteDescriptor] = []

    for path, operations in openapi_schema.get("paths", {}).items():
        if not isinstance(operations, dict):
            continue
        if not path.startswith("/api/"):
            continue
        for method, definition in operations.items():
            if not isinstance(definition, dict):
                continue
            method_upper = method.upper()
            if method_upper not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                continue

            request_schema_ref: str | None = None
            request_body = definition.get("requestBody")
            if isinstance(request_body, dict):
                content = request_body.get("content", {})
                for media_type in _REQUEST_MEDIA_ORDER:
                    schema = content.get(media_type, {}).get("schema")
                    request_schema_ref = _extract_schema_ref(schema)
                    if request_schema_ref:
                        break

            response_schema_ref: str | None = None
            responses = definition.get("responses", {})
            for status_code in ("200", "201", "202", "204", "default"):
                response = responses.get(status_code)
                if not isinstance(response, dict):
                    continue
                content = response.get("content", {})
                schema = content.get("application/json", {}).get("schema")
                response_schema_ref = _extract_schema_ref(schema)
                if response_schema_ref:
                    break

            url = f"{base_url}{path}"
            has_body = request_schema_ref is not None
            if has_body:
                curl_example = (
                    f"curl -X {method_upper} '{url}' "
                    "-H 'Content-Type: application/json' "
                    "-H 'Accept: application/json' "
                    "-d @payload.json"
                )
                httpie_example = f"http {method_upper} {url} @payload.json"
            else:
                curl_example = f"curl -X {method_upper} '{url}' -H 'Accept: application/json'"
                httpie_example = f"http {method_upper} {url}"

            descriptors.append(
                RouteDescriptor(
                    method=method_upper,
                    path=path,
                    operation_id=definition.get("operationId"),
                    summary=definition.get("summary"),
                    tags=definition.get("tags", []),
                    request_schema_ref=request_schema_ref,
                    response_schema_ref=response_schema_ref,
                    examples=RouteExample(curl=curl_example, httpie=httpie_example),
                )
            )

    descriptors.sort(key=lambda descriptor: (descriptor.path, descriptor.method))
    return descriptors
