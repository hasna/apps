# MCP reference

attachments-mcp bridges MCP tools to the authenticated HTTPS attachment service.
Its credential and authority resolve through the shared @hasna/contracts chain
(1.0.2) fresh on EVERY tool call — the same ladder the CLI uses:
`HASNA_ATTACHMENTS_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
`HASNA_ATTACHMENTS_API_KEY_REF`, the macOS Keychain item
`hasna.credentials.attachments.api-key`, `~/.hasna/attachments/config/credentials`,
then `HASNA_ATTACHMENTS_API_URL` / `HASNA_ATTACHMENTS_API_KEY` (legacy
unprefixed aliases accepted below the canonical names for one release), with
the fleet gateway `https://api.hasna.com/attachments` as the default once a
credential resolves. Per-call resolution is what lets a running MCP server pick
up a key rotation without a restart. Missing, blank or conflicting
configuration never selects a local dataset — a tool call with no resolvable
credential fails closed per call.

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
