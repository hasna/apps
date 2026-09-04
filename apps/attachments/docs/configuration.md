# Configuration and deployment

## Clients

Set both HASNA_ATTACHMENTS_API_URL (an explicit HTTPS service origin or path prefix)
and HASNA_ATTACHMENTS_API_KEY. ATTACHMENTS_API_URL/API_KEY aliases are accepted only
when they do not conflict with canonical values. Blank values are errors.
URLs must not contain userinfo, query strings or fragments. Keys must not contain
whitespace or control characters. Credentials are never included in diagnostics.

The CLI, MCP and root SDK use /v1. No network, auth or configuration failure selects
local storage. Requests reject redirects and are not retried with their bodies.
MODE/STORAGE_MODE, client database URLs, DB_PATH and --client-mode are retired.

Configuration preferences use @hasna/paths config resolution (HASNA_CONFIG_HOME,
XDG defaults on Linux, Application Support on macOS). Importing a client does not
create directories or migrate data. Existing ~/.hasna, ~/.attachments and
~/.open-attachments content is preserved in place and is not authoritative.

Client config set accepts only expiry and link-type preferences. API credentials
are injected by the caller, not written to config files. S3 configuration is server-only.

Todos and Sessions workflows need HASNA_TODOS_API_URL/API_KEY and
HASNA_SESSIONS_API_URL/API_KEY respectively (matching non-HASNA aliases allowed).
Explicit command URLs must remain inside the configured service URL.

## Service

Run attachments-serve with HASNA_ATTACHMENTS_DATABASE_URL (or a matching
ATTACHMENTS_DATABASE_URL alias), a valid postgres:// or postgresql:// URL naming
a host and database. An absent, blank, conflicting or non-PostgreSQL URL is fatal.
No storage mode selector is needed or accepted.

Configure HASNA_ATTACHMENTS_API_SIGNING_KEY (or HASNA_API_SIGNING_KEY), object
storage and public share URL on the service. Terminate HTTPS before the HTTP
listener using your deployment's approved TLS boundary.
Use attachments-serve --help for explicit migration/startup options.
The old local attachments serve command is retired.

Live PostgreSQL verification is NOT established by skipped unit tests.
The contract's pgTestGate requires a separately authorized disposable database;
no production credentials or data should be used for that test.

See canonical-migration.md for the current release gate.
