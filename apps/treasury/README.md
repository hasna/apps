# @hasna/treasury

Multi-entity cash/treasury cockpit — a CLI + MCP + serve triad over a Hasna
Service Contract v1 store. Consolidated bank/wallet balances, FX exposure,
per-entity & group runway, short-horizon cash forecast, and **advisory**
sweep / intercompany-funding recommendations.

> **Read/advisory only.** Treasury never moves money itself. Every sweep
> recommendation is flagged `requires_controls_authorization` — actual movement
> must be requested through **iapp-controls**, which issues the single-use
> authorization token. Every operation is entity-anchored and deny-by-default
> authorized against the caller principal.

## Bins

| Bin | Entry | Purpose |
|---|---|---|
| `treasury` | `dist/cli/index.js` | Commander + Ink CLI (`--json` non-interactive) |
| `treasury-mcp` | `dist/mcp/index.js` | MCP server — Streamable HTTP on `127.0.0.1:8890/mcp` (bearer auth), stdio fallback |
| `treasury-serve` | `dist/server/index.js` | Hono HTTP service on `:3486` with `/health` `/ready` `/version` + `/v1` |

## Storage (two runtime modes — PURE REMOTE)

- `local` — SQLite at `~/.hasna/treasury/treasury.db` is authoritative (default).
- `cloud` — reads AND writes go directly to the app-owned Postgres via the
  vendored storage-kit with `sslmode=verify-full`. No sync engine, no hybrid.
  A missing DSN or a DSN-present-but-`local` misconfig is a hard fail-closed error.

Mode/DSN resolve from `HASNA_TREASURY_STORAGE_MODE` / `HASNA_TREASURY_DATABASE_URL`
(presence only — the value is never read to choose a mode; it is scrubbed from
the environment after connect).

## Domain

- **entities** — cached entity anchors (`entity_id` UUIDv4 + optional `entity_slug`).
- **balances** — cached bank/wallet snapshots (integer minor units + provenance); consolidated across entities and currencies.
- **fx** — FX rates + per-currency exposure converted to a reporting base.
- **runway** — per-entity and group burn/runway from balances + a cost feed.
- **forecast** — short-horizon linear cash projection.
- **sweeps** — intercompany-funding recommendations (advisory only).

### Integrator (v0)

Treasury composes upstream services (`iapp-banking`/`iapp-wallets` balances, an
FX provider, a cost feed). v0 ships `src/adapters/*` read-adapter interfaces
backed by **fixtures**; v1 (gated behind `HASNA_TREASURY_LIVE_UPSTREAM=1`) swaps
in live MCP/CLI calls. Upstream data is cached with provenance, never treated as
source-of-truth.

## Auth

- Serve `/v1` and the MCP transport share the copy-verbatim scope/role/entity
  security stack. A bearer token maps to `{credential_id, scopes, entity_ids}`
  (timing-safe compare, expiry + revocation honored).
- Deny-by-default: knowing an `entity_id` grants nothing without matching
  scope + entity access. Auth is decoupled from storage mode — a non-loopback or
  cloud bind with no credentials fails closed at startup.
- MCP domain tools thread the **caller** principal into per-op authorization
  exactly like `/v1` (never a SYSTEM bypass).
- Append-only, hash-chained audit (`audit_log`) for money/lifecycle events;
  excluded from storage push/pull/sync.

## Quickstart

```bash
bun install
bun run verify                 # typecheck + test + build + conformance

# local dev
bun run dev:serve              # http://127.0.0.1:3486
bun run dev:mcp                # http://127.0.0.1:8890/mcp
treasury entities create --name "Hasna Inc (US)" --base_currency USD --json
treasury runway group --base USD --json
treasury doctor --json
```

## Self-host

`docker-compose.yml` ships serve + mcp + Postgres (mode `cloud`, DSN via a
file-mounted secret). See the compose file for the `bunx --package` bin
invocation and secret layout.

## License

Apache-2.0
