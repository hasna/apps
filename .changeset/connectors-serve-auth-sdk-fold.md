---
"@hasna/connectors": minor
---

Security: `connectors-serve` now requires a bearer token and binds loopback
(fleet alignment 2026-09-11, T1 §3.5 connectors).

- **Every `/api/*` route and the `/mcp` mount require
  `Authorization: Bearer <token>`** (or `X-Connectors-Token`). Until now the
  server answered `GET /api/export` — every configured vendor credential — to
  anyone who could reach the port, with no authentication, on every interface.
  `/health` and the two OAuth browser routes (`/oauth/:name/start`,
  `/oauth/:name/callback`) stay public; CORS preflights pass.
- The token is `HASNA_CONNECTORS_SERVE_TOKEN` when set, otherwise the
  owner-only file `<connectors home>/serve-token` (mode 0600, default
  `~/.hasna/connectors/serve-token`) the server generates on first start. It is
  never printed; startup names only its source. There is no anonymous mode.
- The server binds `127.0.0.1` by default (`startServer(port, { hostname })`
  to override deliberately).
- The CLI and MCP OAuth flows probe `/health` (public) instead of
  `/api/connectors` to detect a running server.
- **`@hasna/connectors/sdk`**: the split `@hasna/connectors-sdk` package
  (`apps/connectors/sdk`) is folded into this package as the `./sdk` export
  subpath — one package per app, never a separate `-sdk` (package-surfaces
  rule). `LocalConnectorsClient` / `ConnectorsClient` gained a `token` option
  and read the same two token sources automatically
  (`resolveLocalServeToken`), so same-user clients need no configuration; the
  built `dist/sdk/index.js` imports node builtins only. `HostedConnectorsClient`
  is unchanged. `@hasna/connectors-sdk` on npm is superseded (deprecation is an
  owner decision, not performed here).
