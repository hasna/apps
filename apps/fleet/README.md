# @hasna/fleet

Read-only **AgentOps control tower**. A view/aggregation layer that fuses the
`@hasna` observability sources — **monitor + logs + sessions + economy + evals** —
into per-agent / per-company **SLOs**, **error budgets**, **trace drill-down**, and
**token/cost burn**, exposed identically over a **CLI + MCP + serve** triad.

fleet is **read-only w.r.t. upstream stores**. Its own writable store holds only
fleet's config: SLO definitions, error-budget policies, saved views/dashboards,
alert thresholds, and annotations. The fused observability surface is `GET`-only.

## Triad

| Bin | Entry | Purpose |
|---|---|---|
| `fleet` | `dist/cli/index.js` | commander + Ink CLI/TUI (`--json` for automation) |
| `fleet-mcp` | `dist/mcp/index.js` | MCP server — shared Streamable HTTP + bearer auth (stdio fallback) |
| `fleet-serve` | `dist/server/index.js` | Hono HTTP service (`/health` `/ready` `/version` + `/v1`) |

**Pinned ports:** serve `3485`, MCP HTTP `8889`.

## Storage

Two runtime modes (Amendment A1, PURE REMOTE): `local` (bun:sqlite at
`~/.hasna/fleet/fleet.db`, authoritative) and `cloud` (Postgres via the vendored
`@hasna/contracts` storage-kit, `sslmode=verify-full`). Mode/DSN resolve from
`HASNA_FLEET_STORAGE_MODE` / `HASNA_FLEET_DATABASE_URL[_FILE]` (presence only; the
value is never read to choose a mode, and is scrubbed from the env after connect).
A DSN present while mode resolves to `local` is a hard startup error (fail-closed).

## Interface parity

CLI, MCP, and `/v1` are all generated from one operation registry
(`src/services/registry.ts`) and call the same `src/services/*` layer. Config
resources are full-CRUD; fused observability resources are `GET`-only across every
surface.

### Config resources (CRUD)
`saved-views` · `slos` · `error-budget-policies` · `alert-thresholds` · `annotations`

### Fused observability (read-only)
`health/agents` · `health/company` · `token-burn` · `cost` · `traces` ·
`traces/:id` · `slo-status` · `alerts`

## Security

- Copy-verbatim scope/role/org+entity-scoping auth stack (`src/server/auth.ts` +
  `src/services/authorization.ts`), deny-by-default, timing-safe bearer compare,
  expiry + revocation. Auth is decoupled from storage mode and fails closed on any
  non-loopback / cloud bind without credentials.
- Bearer auth on every `/mcp` request (§5.1a).
- Append-only, hash-chained audit (`fleet_audit`) with SQLite UPDATE/DELETE guard
  triggers; excluded from storage push/pull/sync.
- Redacted `fleet_storage_status` (no DSN); `push`/`pull`/`sync` require the
  `storage:admin` scope and are audited.
- CORS deny-by-default; per-IP rate limiter.

## Develop

```bash
bun install
bun run dev:serve         # Hono on 127.0.0.1:3485
bun run dev:mcp           # MCP Streamable HTTP on 127.0.0.1:8889
bun run dev:cli -- --json health company --entity-id <uuid>
bun run verify            # typecheck + test + build + conformance
```

### v0 vs v1 (integrator phasing)

This cohort ships **v0**: fleet models its own domain and exposes all surfaces over
**fixture read-adapters** (`src/adapters/*`). **v1** (later, gated by
`HASNA_FLEET_LIVE_UPSTREAM=1`) swaps the fixtures for live MCP/CLI calls to the
upstream services — the rollup layer depends only on the adapter interfaces.

## License

Apache-2.0
