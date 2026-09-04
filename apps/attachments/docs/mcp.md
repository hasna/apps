# MCP reference

attachments-mcp bridges MCP tools to the authenticated HTTPS attachment service.
Inject the same explicit URL/key pair used by the CLI. Missing, blank or conflicting
configuration never selects a local dataset.

The existing MCP host transport supports --stdio (or MCP_STDIO=1), and Streamable
HTTP on loopback port 8850 by default (--port or MCP_HTTP_PORT overrides the port).
This local host transport is distinct from the upstream HTTPS attachment API.
Use --help for transport options and attachments mcp for client installation.

Tool profiles use ATTACHMENTS_PROFILE. Tool discovery exposes the schemas for
upload/download/list/delete, links, presigned uploads, reports and supported
Todos/Sessions workflows. All attachment mutations go through the remote Store.
Todos and Sessions tools additionally need their own explicit authenticated HTTPS
configuration; no localhost defaults or unrelated authority overrides are accepted.

configure_s3 is retained only as an explicit retired-operation error; it never
persists credentials. Agent registry tools describe process-local coordination,
not a local attachment store. Preferences and attribution are non-authoritative.

The service, not the MCP process, owns PostgreSQL and S3 credentials. Public share
links keep their existing access controls. API redirects are rejected with no
credential forwarding or request-body replay.
