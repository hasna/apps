# Connect Google Drive Connector

## Overview
The `connect-googledrive` connector enables Beep Media systems to authenticate with Google Drive on behalf of a user or service account and to read, download, and create files and folders. The connector wraps the Google Drive REST API v3 and exposes workflows through a FastAPI service and a Typer-powered CLI.

## Third-Party References
- Google Drive API overview: https://developers.google.com/drive/api
- REST API reference: https://developers.google.com/drive/api/v3/reference
- OAuth 2.0 scopes: https://developers.google.com/drive/api/guides/api-specific-auth
- Usage limits: https://developers.google.com/drive/api/guides/handle-errors#resolve_a_403_error_quotaexceeded

## Data Ownership & Retention
- **Ingress:** Files, folders, permissions metadata, revisions, and sharing state fetched from Google Drive.
- **Egress:** Newly created folders/files initiated by downstream services with explicit audit logging.
- **Throughput:** Target initial sync jobs of up to 1,000 items per run with pagination/backoff handling. Large file downloads must stream to temporary storage under `storage/tmp/` and be pruned after processing (default retention 24 hours).
- **Retention:** Persist sync checkpoints and file metadata hashes for 90 days in connector storage to support idempotency and auditing. File contents should not be persisted beyond short-lived processing buffers.
- **Token Storage:** OAuth refresh/access tokens are encrypted at rest via SQLite (`CONNECTOR_DATABASE_URL`) and keyed by `CONNECTOR_DEFAULT_ACCOUNT_ID`. Use the provided prototype schema in `apps/api/database/prototypes/token_credentials.sql` when adjusting structure.
- **Observability:** Prometheus metrics (via `/metrics`) and optional Sentry tracing (`SENTRY_DSN`) give real-time insights into connector health.
- **Sync State:** Checkpoints live in `sync_checkpoints` and download activity in `download_audit`; both tables are defined in `apps/api/database/prototypes/` and populated via the `SyncStateService` helper.
- **Webhooks:** Active Drive change channels are recorded in `watch_channels` alongside channel tokens/expiration to manage Drive push notification lifecycle.

## User Stories & Acceptance Criteria
1. **List Drive Items**
   - *Given* a valid OAuth token with read scope, *when* the CLI runs `connector-googledrive files list`, *then* the connector returns paginated metadata for files and folders within the configured Drive.
   - Handles pagination transparently and surfaces rate-limit retries in logs.
2. **Download File Content**
   - *Given* a file ID accessible to the authenticated principal, *when* the CLI runs `connector-googledrive files download --id <FILE_ID> --path ./out`, *then* the connector streams the file to the supplied path and verifies checksum length.
   - Emits structured logs for start, completion, and error events; non-zero exit on failure.
3. **Create Folder Or File Upload**
   - *Given* a payload describing folder metadata or file upload source path, *when* the CLI runs `connector-googledrive folders create …` or `files upload …`, *then* the connector creates the resource and returns its Drive ID and webView link.
   - Ensures idempotency via optional external IDs and retries on 5xx/429 responses.
4. **Incremental Sync**
   - *Given* an initialized checkpoint, *when* the CLI runs `connector-googledrive files sync`, *then* the connector consumes Drive changes since the last cursor, updates the checkpoint, and prints added/removed items.
   - Initial runs seed the start page token, subsequent runs advance the cursor and support automation via MCP.
5. **Permission Management**
   - *Given* a Drive file ID, *when* the CLI runs `connector-googledrive permissions grant --type user --role reader --email <EMAIL>`, *then* the connector grants access and returns the created permission ID.
   - *When* the API receives `DELETE /api/v1/permissions/{file_id}/{permission_id}`, *then* the permission is revoked and the change is auditable.

## Agent Discovery
- Start automated discovery with `connect-googledrive capabilities --format md` (defaults to the backend defined by `CONNECT_GOOGLEDRIVE_BACKEND_URL`, `CONNECT_BACKEND_URL`, or `BACKEND_URL`).
- Specialized exporters enable machine-readable metadata:
  - `connect-googledrive capabilities --export openapi --format json`
  - `connect-googledrive capabilities --export routes --format json`
  - `connect-googledrive capabilities --export cli --format json`
- Well-known surfaces:
  - `GET /.well-known/ai-capabilities.json` &rarr; connector description, auth metadata, rate limits, problem catalog, and CLI hints.
  - `GET /.well-known/problem-types.json` &rarr; stable RFC 7807 `type` URIs and descriptions.
  - `GET /api/v1/_meta/routes` &rarr; compact index of API routes with schema references and sample invocations.
- Hypermedia affordances:
  - All 4xx/5xx responses return `application/problem+json` bodies with deterministic `Link` headers (retry + help + service-desc) and `X-Request-ID` correlation tokens.
  - `GET /healthz` and discovery payloads embed `_links` pointing to the well-known metadata for predictable navigation.

## Error Handling & Observability
- Wrap HTTP errors into domain exceptions with context (status code, method, correlation ID).
- Implement exponential backoff with jitter for HTTP 429/5xx responses and emit metrics (`drive_request_count`, `drive_request_latency_ms`, `drive_errors_total`).
- Structured JSON logs with sensitive field redaction (tokens, file names flagged as PII).
- Provide OpenTelemetry hooks for tracing outgoing requests.
- Prometheus metrics exposed at `/metrics` cover API latency plus Google Drive client counters; integrate into the shared Grafana dashboards.
- Optional Sentry integration is activated by setting `SENTRY_DSN`, capturing unhandled exceptions and tracing 10% of requests by default.
- When `CONNECTOR_ENABLE_OTEL=true`, the FastAPI app is auto-instrumented via OpenTelemetry; configure OTLP exporters in deployment environments.

## Security & Compliance
- OAuth tokens stored encrypted at rest using the shared connector secrets manager integration. Refresh tokens rotated proactively when within seven days of expiry.
- Enforce least-privilege scopes (`https://www.googleapis.com/auth/drive.readonly` for read/download, `https://www.googleapis.com/auth/drive.file` for create/modify).
- Maintain audit logs of all create operations and download access for SOC2 evidence.
- Ensure connectors run within VPC perimeter; outbound traffic restricted to Google APIs.
- Document incident response steps for credential leaks and quota exhaustion.
- Monitor log event `access_token_near_expiry` as a rotation guardrail; wire this into alerting so expiring tokens trigger notifications at the 10 minute threshold.
- Service account workflows are supported: set `GOOGLEDRIVE_SERVICE_ACCOUNT_KEY_PATH` and optional `GOOGLEDRIVE_SERVICE_ACCOUNT_SUBJECT` to mint domain-wide delegated tokens without storing refresh tokens.

## Local Development
1. Create OAuth credentials in Google Cloud Console with redirect URI `https://localhost:8443/oauth/callback`.
2. Populate `.env.local` with client ID/secret and set `GOOGLEDRIVE_API_BASE=https://www.googleapis.com/drive/v3`.
3. Run FastAPI dev server via `make connector-connect-googledrive`.
4. Use the CLI for manual runs: `make connector-connect-googledrive-cli ARGS="files list --page-size 10"`.
5. Initialize the connector database once via `python -c "from apps.api.core.database import init_database; import asyncio; asyncio.run(init_database())"` if the SQLite file does not yet exist.
6. Generate consent screen URLs locally with `python scripts/bootstrap_oauth.py --state local` and exchange the authorization code for a refresh token, then store it via `make connector-connect-googledrive-cli ARGS="files list"` to trigger persistence.
7. For service account flows, drop the JSON key at the path referenced by `GOOGLEDRIVE_SERVICE_ACCOUNT_KEY_PATH`; optionally set `GOOGLEDRIVE_SERVICE_ACCOUNT_SUBJECT` to impersonate a workspace user when domain-wide delegation is enabled.
8. Prune download audit rows as needed with `make connector-connect-googledrive-cli ARGS="maintenance prune-downloads --hours 168"` (defaults to 24 hours).
9. Advance incremental checkpoints with `make connector-connect-googledrive-cli ARGS="files sync --page-size 200"` during manual testing.
10. Register Drive push watches with `make connector-connect-googledrive-cli ARGS="watch register --ttl-seconds 86400"` once `CONNECTOR_WEBHOOK_URL` is reachable.
11. Periodically renew watch channels locally with `make connector-connect-googledrive-cli ARGS="watch renew --hours 1"` if running long-lived tests.
12. Manage sharing with `make connector-connect-googledrive-cli ARGS="permissions list <FILE_ID>"` and related `grant`, `update`, `revoke` commands.
13. Scaffold new Caddy entries with `~/Workspace/shared/prompts/shared/port/script-assign-ports <slug> --project-root .` (auto-assigns ports, writes the Caddy config, updates the Makefile, and refreshes `PORT.md`).

## Operational Runbook
- Monitor metrics dashboard for sustained 429s (quota exhaustion) and escalate to Google Cloud support if limits reached.
- Refresh stored tokens nightly; raise PagerDuty alert when refresh fails twice consecutively.
- Rotate service account keys every 90 days; update secrets manager entries and redeploy.
- For local HTTPS testing, map `https://googledrive.connect` to the FastAPI service via Caddy.
- Schedule `maintenance prune-downloads` to run daily (default 24-hour retention) so `download_audit` does not grow unbounded.
- MCP server methods include `drive.list_files`, `drive.create_folder`, `drive.get_checkpoint`, `drive.update_checkpoint`, `permissions.list`, `permissions.grant`, `permissions.update`, `permissions.revoke`, `maintenance.prune_downloads`, `watch.list_channels`, `watch.register_channel`, and `watch.delete_channel`; automation can pair these with CLI `watch renew` for channel rotation.
- API surfaces incremental sync at `GET /api/v1/files/changes`; CLI `connector-googledrive files sync` and MCP `drive.update_checkpoint` compose this workflow, while `/api/v1/watch/channels` and `/api/v1/webhooks/googledrive` manage Drive push registrations.
- Renew push notifications before expiration via `connector-googledrive watch renew --hours 12`; configure scheduled jobs (cron, Celery, etc.) to keep channels active.
- The helper script `scripts/renew_watch_channels.py` can be wired into cron/systemd to automatically renew channels every 12 hours.
- Use `scripts/cleanup_temp_files.py` to prune stale artifacts in `storage/tmp/` when not relying on the FastAPI maintenance endpoint.
- Manage sharing via REST endpoints under `/api/v1/permissions/{file_id}` and CLI commands `connector-googledrive permissions list|grant|update|revoke`.

## Testing Strategy
- Unit tests mock the Google APIs using `respx` to exercise token refresh and service error handling.
- Integration tests (future) will run against the Google Drive sandbox when `INCLUDE_EXTERNAL_TESTS=1`.
- Contract tests will validate response schemas before deploying changes to production.
- CI pipeline runs `make connector-connect-googledrive-test` and `make connector-connect-googledrive-lint`.
- Database-backed unit tests use ephemeral SQLite files; see `tests/unit/test_token_repository.py` for examples of using `init_database` and `get_session_factory` helpers.
- The pytest configuration in `pytest.ini` enables asyncio-aware tests and introduces an `external` marker for provider sandbox suites.
- Use `make connector-connect-googledrive-ci` to execute linting and unit tests together.
- Ensure deployment ingress exposes `/api/v1/webhooks/googledrive`; schedule watch renewal jobs before channel expiration (Google Drive requires renewal within 7 days).
- Automate temporary file cleanup with `scripts/cleanup_temp_files.py` or the `maintenance prune-downloads` command on a cron interval.
- Real sandbox integration tests live under `tests/integration/` and require `INCLUDE_EXTERNAL_TESTS=1` plus `GOOGLEDRIVE_TEST_FILE_ID`; they exercise live permissions listing.

## CI / Automation
- Run `make connector-connect-googledrive-lint` followed by `make connector-connect-googledrive-test` in CI jobs.
- Gate sandbox-dependent tests behind `INCLUDE_EXTERNAL_TESTS=1` to avoid quota usage on every run.
- Expose the `/metrics` endpoint and Sentry DSN as deployment environment variables before promoting builds.
- Ensure ingress exposes `/api/v1/webhooks/googledrive`; schedule `connector-googledrive watch renew` automation before channel expiration and alert on repeated webhook failures.
- Schedule `scripts/cleanup_temp_files.py` (or `connector-googledrive maintenance cleanup-temp`) via cron to respect the configured retention window.

## Future Enhancements
- Build integration tests against Google Drive sandbox using service account credentials.
- Support Google Shared Drive impersonation via service accounts.
- Expand MCP server to expose metrics and CLI-equivalent operations.
- Incremental change consumption uses `drive.sync_changes` (CLI `files sync`, API `/api/v1/files/changes`, MCP `drive.get_checkpoint` + `drive.update_checkpoint`) to support streaming ingestion pipelines.
