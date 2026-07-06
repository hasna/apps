# @hasna/access

Non-human-identity (NHI) governance for the Hasna agent-operated back-office. A
CLI + MCP + serve triad over a Hasna-contract store that keeps a live entitlement
inventory of every agent/service identity, its credential references and MCP tool
scopes, owner mapping, just-in-time elevation, scheduled access reviews, and
one-click revocation — and issues/verifies the cohort's MCP bearer tokens.

- **npm:** `@hasna/access` · **bins:** `access`, `access-mcp`, `access-serve`
- **serve port:** 3483 · **MCP HTTP port:** 8887
- **store:** local `bun:sqlite` (`~/.hasna/access/access.db`) or cloud Postgres
  (PURE REMOTE, `sslmode=verify-full`) via the vendored `@hasna/contracts`
  storage kit.

## Domain

| Resource | What it holds |
|---|---|
| **identities** | agent / service / human NHIs: kind, name, owner ref, home entity ref, status |
| **credentials** | credential *references only* (never values) → `@hasna/secrets` refs |
| **scopes** | MCP tool scopes granted per identity (grant / revoke) |
| **elevations** | JIT elevation: identity, scope, `expires_at`, approver, reason |
| **access_reviews** | scheduled recertification campaigns |
| **revocations** | one-click, audited revocation (targeted or identity cascade) |
| **tokens** | issued MCP bearer tokens (access is the cohort token **issuer**) |
| **audit** | append-only, hash-chained audit of elevation/revocation/lifecycle events |

Every record is anchored to a home **`entity_id`** (an unguessable UUIDv4) and is
authorized against the caller's scopes + entity set — knowing an id grants
nothing on its own (deny by default).

## Surfaces (interface parity)

CLI, MCP tools, and `/v1` REST all dispatch through one operation registry
(`src/services/registry.ts`), so a capability added to one surface appears on all
three.

```bash
# CLI (add --json for machine output)
access identity create --entity-id <uuid> --kind agent --name billing-bot
access scope grant --identity-id <id> --scope wallets:read
access elevation request --identity-id <id> --scope secrets:write --reason "rotate key" --ttl-minutes 30
access token issue --identity-id <id>
access revocation execute --identity-id <id> --target-type identity --reason offboarded

# serve (Hono)
access-serve                 # GET /health /ready /version, /v1/*
# MCP (Streamable HTTP + mandatory bearer auth)
access-mcp --http --port 8887
```

## Security

- **MCP HTTP** requires a per-caller bearer token (timing-safe); auth may be
  disabled only in local mode on a loopback bind.
- **`/v1`** uses the copy-verbatim scope/role/entity-scoping stack, deny-by-default,
  CORS deny-by-default, rate-limited, fail-closed on non-loopback/cloud bind.
- **Credentials store references only** — never secret values.
- **Audit log** is append-only (SQLite triggers block UPDATE/DELETE) and
  hash-chained; excluded from storage push/pull/sync.
- **`access_storage_status`** is redacted (no DSN); push/pull/sync are
  elevated-scope gated.

## Develop

```bash
bun install
bun run verify   # typecheck + test + build + conformance
```

License: Apache-2.0.
