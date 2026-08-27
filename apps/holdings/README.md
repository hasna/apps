# @hasna/holdings — IP portfolio system-of-record

CLI + MCP + serve triad for an entity-anchored intellectual-property portfolio:
**trademarks, patents, copyrights, brand assets, and domains**, with per-jurisdiction
**registrations**, renewal/deadline **renewals**, Nice **classes**, and filing
**documents** (referenced via external signature / filing services). Folds in the
trademarks/logos stubs.

> npm package `@hasna/holdings`; bins are **`holdings`**, `holdings-mcp`, `holdings-serve`.
> All name-derived tokens use the bare token `holdings` (env prefix `HASNA_HOLDINGS_`,
> data home resolved through `@hasna/paths` — legacy `~/.hasna/holdings` until the
> XDG data home is adopted; exact-app overrides `HASNA_HOLDINGS_HOME` / `HOLDINGS_HOME`
> win unconditionally).

## Domain

- **assets** — `kind` (trademark|patent|copyright|brand_asset|domain), `name`,
  owning `entity_id`, `status`.
- **registrations** — per-jurisdiction: office, app/reg number, filing/registration
  dates, status.
- **renewals** — deadline tracking: due date, fee, status, reminder window; plus an
  `upcoming` deadline view.
- **classes** — Nice classification (1–45) for trademarks.
- **documents** — filing document references (title, type, external `doc_ref`).

Everything is anchored to an `entity_id` (UUIDv4) and authorized against it — an id
alone never grants access (deny-by-default).

## Bins

| Bin | Purpose |
|---|---|
| `holdings` | CLI/TUI (commander + Ink), `--json` for machine output |
| `holdings-mcp` | MCP server (shared Streamable HTTP on **:8893** + bearer auth; stdio fallback) |
| `holdings-serve` | Hono HTTP service (**:3489**), `/health` `/ready` `/version` + `/v1` |

## Storage

- **sqlite** (default): SQLite at `<data home>/holdings.db` is authoritative. The data
  home is resolved through `@hasna/paths` (XDG/macOS home layout); the legacy
  `~/.hasna/holdings` default stays effective until the store is physically migrated to
  the XDG data home or the operator sets `HASNA_DATA_HOME` — an existing local store is
  never invisible on upgrade. `HASNA_HOLDINGS_HOME` / `HOLDINGS_HOME` override the app
  home unconditionally; `HASNA_HOLDINGS_DB_PATH` / `HOLDINGS_DB_PATH` override the
  database path.
- **postgres**: Postgres via the vendored `@hasna/contracts` storage-kit
  (`sslmode=verify-full`), selected by `HASNA_HOLDINGS_DATABASE_URL` presence.

## Interface parity

CLI, MCP tools, and `/v1` routes are generated from one **op registry**
(`src/services/registry.ts`) and all dispatch through the same service layer, so the
three surfaces expose identical operations and error shapes.

## Develop

```
bun install
bun run dev:serve     # Hono on :3489
bun run dev:mcp       # MCP HTTP on :8893
bun run dev:cli -- asset list --json
bun run verify        # typecheck + test + build + conformance
```

## Security

- Copy-adapted scope/role + entity-scoping auth (timing-safe bearer compare,
  expiry, revocation), shared by serve **and** MCP HTTP; deny-by-default.
- Append-only, hash-chained audit ledger (`audit_events`) — insert-only, excluded
  from storage push/pull/sync.
- Redacted `holdings_storage_status` (never emits a DSN); gated `holdings_storage_{push,pull,sync}`.
- Deny-by-default CORS; rate limiter; fail-closed on any non-loopback bind without
  credentials.

License: Apache-2.0.
