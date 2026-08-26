# @hasna/billing

Thin agent-facing **billing/dunning orchestration over Stripe Billing** — NOT a rebuilt billing engine. It mirrors Stripe subscription/invoice state and owns its own derived dunning tables, exposing a CLI + MCP + serve triad over a Hasna-contract store.

`billing` is a standalone billing/dunning orchestration layer over Stripe Billing: it mirrors Stripe subscription and invoice state into its own tables and applies configurable dunning policies (decline-code retry schedules, pre-dunning window, graduated downgrades), with multi-entity invoicing and signature-verified webhook ingest.

## What it does

- **Customers** — linked to a seller `entity_id` and an external Stripe customer ref.
- **Subscriptions** — mirror of Stripe subscription state (plan, status, current period).
- **Invoices** — multi-entity (seller entity, amount, status, attempt count).
- **Dunning policies** — decline-code → retry schedule, pre-dunning window, graduated downgrade rules.
- **Dunning runs** — smart retry attempts + outcomes (retry succeeded/failed, downgraded, canceled, abandoned).
- **Events** — Stripe webhook ingest: **signature-verified** (fail-closed) then idempotent (dedup on `stripe_event_id`).

The Stripe integration is an **interface** with a deterministic **mock** implementation (no live keys). Live Stripe is gated behind `HASNA_BILLING_LIVE_UPSTREAM=1` (not in this cohort — v0 builds/tests over the mock).

### Webhook integrity

`ingest_event` mutates money/delinquency state (`invoice.paid`, `invoice.payment_failed`), so it **verifies the Stripe webhook signature before any mutation** and fails closed. Set `HASNA_BILLING_STRIPE_WEBHOOK_SECRET`; unsigned, malformed, replayed (outside a 5-minute window), or mismatched events are rejected (`WEBHOOK_VERIFICATION_FAILED`). The signature is a timing-safe HMAC-SHA256 in Stripe's `t=<unix>,v1=<hmac>` scheme, modeled in the `StripeAdapter` interface (the v0 mock provides a deterministic signer/verifier). On the serve tier the signature arrives as the `Stripe-Signature` header (or a body `signature` field on the CLI/MCP surfaces).

## Triad

| Bin | Entry | Purpose |
|---|---|---|
| `billing` | `dist/cli/index.js` | commander + Ink CLI (`--json`) |
| `billing-mcp` | `dist/mcp/index.js` | MCP server (Streamable HTTP + bearer auth on `:8891`; stdio fallback) |
| `billing-serve` | `dist/server/index.js` | Hono HTTP service (`:3487`, `/health` `/ready` `/version` + `/v1`) |

All three surfaces call the **same** `src/services/*` layer through one `runOp` choke point, so CLI/MCP/API stay at parity (see `test/interface-parity.test.ts`).

## Storage

- **SQLite** (default): `bun:sqlite` at the effective billing data home's `data/billing.db` is authoritative.
- **PostgreSQL** (`HASNA_BILLING_DATABASE_URL` or `HASNA_BILLING_DATABASE_URL_FILE`): selected by the server through the vendored storage kit, with `sslmode=verify-full`. This build fails **closed** rather than silently writing money/audit data to ephemeral storage.

The billing data home is resolved through `@hasna/paths`. The legacy
`~/.hasna/billing` default (with the `HASNA_BILLING_HOME` / `BILLING_HOME`
exact-app overrides) stays the effective home until the store has actually been
migrated to the XDG data home (`~/.local/share/hasna/billing` on Linux;
`~/Library/Application Support/Hasna/billing` on macOS) or the operator sets the
data-kind override `HASNA_DATA_HOME`, so an existing local store never becomes
invisible on upgrade.

The append-only, hash-chained `audit_log` (SQLite triggers forbid UPDATE/DELETE) records money/lifecycle events and is excluded from `storage_push/pull/sync`.

> **Current PostgreSQL limitation (operators read this):** this integrator wires the PostgreSQL **pool config + TLS + reachability probe**, but not a PostgreSQL-backed domain query path. When a database URL selects PostgreSQL, every `/v1` route and MCP domain tool fails closed and `/ready` returns `503`; it never falls back to an in-memory or SQLite store. Use the default SQLite backend for a working service until the domain query layer is wired. `docker-compose.yml` is the user-hosted service artifact and demonstrates the intended PostgreSQL configuration without changing this fail-closed boundary.

## Develop

```sh
bun install
bun run dev:cli -- customers create --input '{"entity_id":"<uuid>","email":"a@b.com"}'
bun run dev:serve      # http://127.0.0.1:3487
bun run dev:mcp        # http://127.0.0.1:8891/mcp
bun run verify         # typecheck + test + build + conformance
```

## Security

- Bearer-credential auth (timing-safe) shared by serve **and** MCP; deny-by-default scope + entity scoping. Each token maps to a **distinct** credential (`HASNA_BILLING_API_CREDENTIALS`, a JSON array) with explicit scopes and a bounded entity set — there is **no** shared-static-key / owner-bypass path (money-app segregation-of-duties, BUILD-SPEC §5.1a). `bypass` is reserved for the in-process SYSTEM bootstrap only.
- MCP domain tools thread the **caller** principal into per-op authorization — a read-only or single-entity token is denied privileged/cross-entity ops on the MCP transport, exactly as on `/v1`.
- CORS deny-by-default; redacted `storage_status` (never emits a DSN).
- Rate limiter keyed on a non-forgeable identity (authenticated `credential_id`, else the trusted socket peer) — the raw `X-Forwarded-For` header is honored only behind a known proxy (`HASNA_BILLING_TRUST_PROXY=1`); system endpoints (`/health`,`/ready`,`/version`) are exempt.
- Webhook signature verification (fail-closed) on `ingest_event` — see **Webhook integrity** above.

License: Apache-2.0.
