# @hasna/consolidations

Group financial consolidation as a CLI + MCP + serve triad over a Hasna Service
Contract v1 store (local SQLite / cloud Postgres).

Ingest per-entity GL / trial-balance data, normalize local charts-of-accounts
onto a group COA, translate multi-currency balances at period FX rates, net
intercompany eliminations, and produce consolidated **P&L / Balance Sheet /
Cash Flow** on demand — deterministic and auditable.

> **Integrator v0 (§1a):** the upstream GL is read through a `src/adapters/`
> read-adapter interface backed by **fixtures/mocks** in this build. A live
> upstream GL (`@hasna/entities`) adapter is planned but NOT implemented yet —
> no environment flag enables it, and the README and package description say
> nothing that implies live pulling. The app owns its normalized/derived tables
> (COA maps, FX rates, runs, statements, eliminations); upstream GL is never
> persisted as source-of-truth.

## Domain

| Resource | What it is |
|---|---|
| `entities` | Cached references to group legal entities (system-of-record is `@hasna/entities`). |
| `gl_imports` | Per-entity, per-period trial-balance / GL imports (via the accounting adapter). |
| `coa_mappings` | Map each entity's local account code onto the group chart-of-accounts. |
| `fx_rates` | Period FX rates (closing for BS, average for P&L). |
| `eliminations` | Intercompany elimination entries; matched balances net to zero at group. |
| `runs` | A consolidation run for a period over a set of entities. |
| `statements` | Consolidated P&L / BS / CF produced by a run. |

Every record is anchored to an `entity_id` (unguessable UUIDv4) and authorized
against the caller's scopes + entity set — deny by default (§1c).

## The triad

- `consolidations` — CLI/TUI (commander + Ink), `--json` for machine output.
- `consolidations-mcp` — MCP server (shared Streamable HTTP + per-caller bearer auth; stdio fallback).
- `consolidations-serve` — Hono HTTP service with `/health` `/ready` `/version` and `/v1`.

CLI, MCP tools, and `/v1` all route through the **same op registry**
(`src/services/registry.ts`) and execution path (`src/services/execute.ts`), so
interface parity holds by construction.

## Quick start (local)

```bash
bun install
bun run dev:cli -- demo seed              # seed the demo US+RO group
bun run dev:cli -- --json runs create --period 2026-Q1 --reporting-currency USD \
  --entity-ids 3f9a1c2e-1d4b-4a6f-8e21-9b7c5d3e0a11,a2b7c9d1-5e3f-4c8a-9d02-1f6e4b8c7a33
bun run dev:cli -- --json runs compute <run-id>
bun run dev:cli -- --json statements list --run-id <run-id>
```

## Server data backend

Exactly one technical switch: **`sqlite` (default) | `postgresql`**. SQLite at
`~/.local/share/hasna/consolidations/consolidations.db` is authoritative unless a
`HASNA_CONSOLIDATIONS_DATABASE_URL` (or `*_DATABASE_URL_FILE` mount) is set, which
selects PostgreSQL (via the vendored `@hasna/contracts` storage kit,
`sslmode=verify-full`). Legacy `HASNA_CONSOLIDATIONS_STORAGE_MODE` variables are
rejected with migration guidance.

The local store's home is resolved through `@hasna/paths` (XDG / macOS layout,
honoring `HASNA_*_HOME` overrides). The legacy `~/.hasna/consolidations` default
stays the effective home until the XDG data home is adopted — the operator sets
`HASNA_DATA_HOME`, or the store is physically migrated there (`consolidations.db`
exists at the resolver home) — so an existing local store never becomes
invisible on upgrade. `HASNA_CONSOLIDATIONS_HOME` / `CONSOLIDATIONS_HOME` are an
exact-app override that wins unconditionally.

## Verify

```bash
bun run verify   # typecheck && test && build && conformance
```

## Ports

Serve `3488`, MCP HTTP `8892`.

License: Apache-2.0.
