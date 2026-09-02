# HTTP API and SDK

The supported attachment API is the service's authenticated /v1 surface.
The retired local /api server and AttachmentsClient are not public package exports.
An approved deployment terminates HTTPS in front of attachments-serve.

Every client requires an explicit HTTPS base URL and API key. Missing, blank or
conflicting configuration fails before dispatch. Authenticated requests reject
all redirects; writes are not automatically retried or replayed.

## Service routes

GET /health, /ready, /version and /openapi.json are public service metadata.
The following attachment routes require the service API key:

- GET and POST /v1/attachments: list metadata or upload.
- GET and DELETE /v1/attachments/:id: metadata or deletion.
- GET /v1/attachments/:id/download: authenticated binary download.
- GET and POST /v1/attachments/:id/link: obtain or regenerate a link.
- POST /v1/attachments/presign-upload: request a direct upload URL.
- POST /v1/attachments/:id/presign-upload/complete: confirm uploaded object.
- GET /v1/slugs/:slug: friendly-link availability.
- POST /v1/feedback: submit feedback.

Public share links under /a have their own token, expiry, password and email
access controls; they are not unauthenticated client CRUD endpoints.

## Public clients

The package root exports resolveStore, ApiStore and resolveAttachmentsV1.
They adapt command/MCP workflows to the authenticated service; file input and
explicit download output are not a local application-data backend.

@hasna/attachments/sdk and the standalone @hasna/attachments-sdk expose the
generated AttachmentsApiClient. Construct it with baseUrl and apiKey.
The generated JSON client has twelve operations from src/serve/openapi.ts;
it does not claim a generated binary-download or multipart-upload interface.
Use the root Store adapter for those workflows. Generated sources are kept
byte-identical by scripts/generate-sdk.ts.

Same-authority API key rotation is revalidated before each dispatch. Authority
changes require a new client. Caller authentication-header overrides are rejected.
Errors report status without echoing arbitrary response bodies.

See [configuration](configuration.md) and the service OpenAPI document for fields.
