# Security

Open Clip is local-first software. By default it stores data under
`~/.hasna/clip/` and binds the HTTP server to `127.0.0.1`.

## Supported Modes

- Local mode: CLI, SDK, and MCP use the local SQLite database and artifact
  directory directly.
- Self-hosted mode: `clip serve` exposes an HTTP API and share URLs from the
  same local store. Binding to a LAN address is an operator choice.

There is no SaaS mode in this package.

## Reporting

Report security issues privately to the project maintainers. Do not include
tokens, private screenshots, clipboard contents, or database files in public
issues.

## Operational Notes

- Treat share URLs as bearer links when the server is reachable by others.
- Use `HOST=127.0.0.1` or the default bind for local-only operation.
- Use a reverse proxy with TLS and authentication when exposing the server
  outside a trusted LAN.
- Keep `~/.hasna/clip/clip.db` and `~/.hasna/clip/artifacts/` out of source
  control and backups that are shared broadly.
