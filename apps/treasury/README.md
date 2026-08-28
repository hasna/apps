# @hasna/treasury

Multi-entity cash/treasury cockpit — a CLI + MCP + serve triad over a Hasna
Service Contract v1 store. Consolidated bank/wallet balances, FX exposure,
per-entity & group runway, short-horizon cash forecast, and **advisory**
sweep / intercompany-funding recommendations.

> **Read/advisory only.** Treasury never moves money itself. Every sweep
> recommendation is flagged `requires_controls_authorization` — actual movement
> must be requested through **controls**, which issues the single-use
> authorization token. Every operation is entity-anchored and deny-by-default
> authorized against the caller principal.

## Bins

| Bin | Entry | Purpose |
|---|---|---|
| `treasury` | `dist/cli/index.js` | Commander + Ink CLI (`--json` non-interactive) |
| `treasury-mcp` | `dist/mcp/index.js` | MCP server — Streamable HTTP on `127.0.0.1:8890/mcp` (bearer auth), stdio fallback |
| `treasury-serve` | `dist/server/index.js` | Hono HTTP service on `:3486` with `/health` `/ready` `/version` + `/v1` |

## Storage (server data backend, env-selected)

The server data backend is the only technical switch:

- **SQLite** at the effective treasury data home — `~/.local/share/hasna/treasury/treasury.db` once the XDG home is adopted (resolved via `@hasna/paths`), the legacy `~/.hasna/treasury/treasury.db` default until then — is authoritative by default.
- **PostgreSQL** — set `HASNA_TREASURY_DATABASE_URL` (or a
  `*_DATABASE_URL_FILE` mount, as docker-compose injects it) to select the
  PostgreSQL backend via the vendored storage-kit with `sslmode=verify-full`.
  A missing DSN is a hard fail-closed error — no silent fallback.

The removed legacy storage-mode variables (`HASNA_TREASURY_STORAGE_MODE` etc.)
are rejected at startup with migration guidance, never interpreted. The DSN is
scrubbed from the environment after connect.

## Domain

- **entities** — cached entity anchors (`entity_id` UUIDv4 + optional `entity_slug`).
- **balances** — cached bank/wallet snapshots (integer minor units + provenance); consolidated across entities and currencies.
- **fx** — FX rates + per-currency exposure converted to a reporting base.
- **runway** — per-entity and group burn/runway from balances + a cost feed.
- **forecast** — short-horizon linear cash projection.
- **sweeps** — intercompany-funding recommendations (advisory only).

### Integrator (v0)

Treasury composes upstream services (`banking`/`wallets` balances, an
FX provider, a cost feed). v0 ships `src/adapters/*` read-adapter interfaces
backed by **fixtures**; v1 (gated behind `HASNA_TREASURY_LIVE_UPSTREAM=1`) swaps
in live MCP/CLI calls. Upstream data is cached with provenance, never treated as
source-of-truth.

## Auth

- Serve `/v1` and the MCP transport share the copy-verbatim scope/role/entity
  security stack. A bearer token maps to `{credential_id, scopes, entity_ids}`
  (timing-safe compare, expiry + revocation honored).
- Deny-by-default: knowing an `entity_id` grants nothing without matching
  scope + entity access. Auth is decoupled from the storage backend — a
  non-loopback bind with no credentials fails closed at startup.
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

## Deploying with PostgreSQL

`docker-compose.yml` ships serve + mcp + Postgres (DSN via a file-mounted
secret, `sslmode=verify-full`). See the compose file for the `bunx --package`
bin invocation and secret layout.

## License

Apache-2.0
