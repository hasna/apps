# @hasna/attachments

Authenticated HTTPS attachment clients and a PostgreSQL-backed service.

## Client usage

Provide HASNA_ATTACHMENTS_API_URL and HASNA_ATTACHMENTS_API_KEY through your
approved environment/secret manager, then run attachments list or attachments upload.
The URL must use HTTPS. Both values are required; there is no local database fallback.

The package root and @hasna/attachments/sdk export resolveStore and ApiStore.
The separate sdk directory exports the generated AttachmentsApiClient with required
baseUrl and apiKey options. All authenticated requests refuse redirects.

attachments-mcp exposes attachment operations over MCP. Client S3 configuration,
LocalStore and the old unauthenticated /api SDK are retired. S3 credentials and
PostgreSQL DSNs belong only on the service.

## Service

attachments-serve uses validated server-side PostgreSQL configuration.
See [configuration](docs/configuration.md) for environment requirements,
and [migration status](docs/canonical-migration.md) before attempting a release.

Local configuration follows @hasna/paths. Existing legacy files are preserved
untouched; there is no automatic import or migration.
