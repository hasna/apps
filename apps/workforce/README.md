# @hasna/workforce

Unified roster / HRIS that treats **humans, contractors AND autonomous agents** as
first-class org members. It is the system-of-record for who is in the org, what
they can do, how they move through the joiner-mover-leaver lifecycle, and where
they are assigned — and it feeds payroll/timesheets via an export contract.

Part of the Hasna agent-operated back-office control plane. Ships the canonical
**CLI + MCP + serve** triad over a Hasna Service Contract v1 store.

- npm: `@hasna/workforce`  ·  bins: `workforce`, `workforce-mcp`, `workforce-serve`
- serve port `3484`  ·  MCP HTTP port `8888`
- store: local `bun:sqlite` (authoritative) or `cloud` PURE-REMOTE Postgres via the vendored `@hasna/contracts` storage-kit

## Domain

| Resource | What it models |
|---|---|
| **members** | roster entries: `kind` (human\|contractor\|agent), name, owner (agents require an owning human), role, home entity, status, email |
| **capabilities** | catalog of skills/capabilities per member (level, category) |
| **lifecycle** | joiner-mover-leaver events (hire, role_change, suspend, reactivate, offboard) with effective dates — append-only + tamper-evident |
| **assignments** | member → entity/project allocations |
| **export** | `roster_export.v1` contract that feeds payroll/timesheets |

Every record anchors to an **`entity_id` (UUIDv4)** and is authorized against the
authenticated principal's entity/org scope — knowing an id is never access.

## Interface parity

The CLI, MCP tools, and `/v1` REST API expose the **same operations** over the
same `src/services/*` layer. The operation set is defined once in
`src/services/registry.ts` and drives the CLI namespaces, MCP tools, OpenAPI
paths, MCP profiles, and the generated interface-parity test.

## Quickstart (local)

```bash
bun install
bun run dev:cli -- member create --kind human --name "Ada" --entity "$(uuidgen)" --role Engineer
bun run dev:serve            # Hono API on http://127.0.0.1:3484  (/health /ready /version /v1)
bun run dev:mcp              # MCP Streamable HTTP on http://127.0.0.1:8888/mcp (bearer auth)
bun run verify              # typecheck + test + build + conformance
```

## Storage modes

- `local` (default): SQLite at `~/.hasna/workforce/workforce.db`.
- `cloud`: `HASNA_WORKFORCE_STORAGE_MODE=cloud` + a DSN (`HASNA_WORKFORCE_DATABASE_URL[_FILE]`),
  PURE REMOTE with `sslmode=verify-full`. A DSN present while mode is `local` is a
  hard startup error (fail-closed).

## Security

- Serve + MCP share one copy-verbatim credential/scope stack (`ApiCredentialConfig`,
  timing-safe bearer compare, roles→scopes, entity/org scoping, expiry + revocation),
  deny-by-default, auth decoupled from storage mode.
- MCP HTTP requires a bearer token; auth may only be disabled with
  `HASNA_WORKFORCE_MCP_AUTH=off` on a loopback bind in local mode.
- Lifecycle events are append-only (SQLite triggers block UPDATE/DELETE) and
  hash-chained; `workforce lifecycle verify` detects tampering.
- `workforce_storage_status` is redacted (never emits a DSN); push/pull/sync
  require an elevated scope and exclude audit tables.
- CORS is deny-by-default (allowlist via `HASNA_WORKFORCE_CORS_ORIGINS`).

## Self-host

`docker-compose.yml` runs serve + mcp + Postgres with file-mounted secrets. See
the compose file for the exact `bunx --package` bin invocation.

## License

Apache-2.0
