# Security

Open Clip is local-first software. By default it stores data under
`~/.hasna/clip/` and binds the HTTP server to `127.0.0.1`.

## Supported Modes

- Local mode: CLI, SDK, and MCP use the local SQLite database and artifact
  directory directly.
- Self-hosted mode: `clip serve` exposes an HTTP API and share URLs from the
  same local store. Binding to a LAN or public address is an operator choice.

There is no SaaS mode or hosted Open Clip endpoint.

## HTTP Access Controls

Set `CLIP_AUTH_TOKEN` or pass `clip serve --auth-token` when clients other than
the local operator can reach the server. When configured, the token is required
as `Authorization: Bearer <token>` for every `POST` and `DELETE` route.

The server token does not protect `GET` routes. Unprotected share URLs are
bearer links: anyone who can reach and discover a URL can read it.

Text and uploaded-file shares created through `POST /api/shares` may instead
set one per-share `accessToken` or `password`. Tokens use salted SHA-256
verification material and passwords use salted scrypt verification material;
raw credentials are not stored in public share metadata or responses.

Supply per-share credentials in `X-Clip-Access-Token`,
`Authorization: Bearer <token>`, or `X-Clip-Password` headers. Query
credentials are supported for explicit browser links but may appear in browser
history and external proxy/access logs. Prefer headers.

Preview-page query credentials are not forwarded to an embedded raw-image
request. A protected raw request must receive its own header or query
credential.

Use a TLS reverse proxy before sending server or share credentials over an
untrusted network.

## Public Data Boundaries

Public HTTP and MCP records omit local artifact paths. Path-like and
credential-bearing metadata is recursively removed or redacted, and unexpected
HTTP exceptions return a generic error while diagnostics remain server-side.

Raw artifacts are served inline only for an explicit safe MIME allowlist.
Other content, including uploaded HTML and SVG, is forced to an
`application/octet-stream` attachment with `X-Content-Type-Options: nosniff`.

The MCP HTTP transport binds only to `127.0.0.1` and has no authentication
option. Do not add a public proxy in front of it without a separate access
control layer.

## Local Data

- The default Clip home and artifact directories are created with private
  permissions when the platform supports POSIX modes.
- Treat `clip.db`, artifacts, clipboard history, and config as sensitive local
  data.
- Keep the Clip home out of source control and broadly shared backups.
- `clip uninstall --yes` removes the configured database, artifacts, and config
  only inside the configured Clip home and refuses broad or out-of-home purge
  targets.

## Reporting

Report security issues privately to the project maintainers. Do not include
tokens, passwords, private screenshots, clipboard contents, database files, or
artifact contents in public issues.
