# HTTP API reference

`createAccountsHttpHandler(options)` returns a Fetch-compatible handler; it does
not start a server. Callers provide authentication, catalog, idempotency, intent,
and internal services. Public and internal token audiences are separate.

## Unauthenticated

| Method and path | Behavior |
| --- | --- |
| `GET /health` | Process health. |
| `GET /ready` | `200` only when ready, off recovery hold, and positive eligibility is possible; otherwise `503`. |
| `GET /version` | Package version and pinned contract SHA-256. |
| `GET /openapi.json` | Runtime OpenAPI 3.1 document. |

## Public API

| Methods | Path | Scope |
| --- | --- | --- |
| `GET`, `POST` | `/v1/provider-accounts`, `/v1/entitlements`, `/v1/account-lanes` | `accounts:read` / `accounts:write` |
| `GET` | `/v1/{provider-accounts|entitlements|capacity-pools|account-lanes|auth-capsules|credential-bindings}/{id?}` | `accounts:read` |
| `POST`, `GET` | `/v1/auth-capsules/{id}/bootstrap-intents[/{intentId}]` | `accounts:capsules:bootstrap-intent` |
| `GET`, `POST` | `/v1/credential-operations` | `accounts:read` / `accounts:credentials:request` |
| `GET` | `/v1/credential-operations/{id}` | `accounts:read` |
| `POST` | `/v1/capacity/query` | `accounts:read` |

Collection reads accept `cursor` and `limit` 1–100. Mutations require
`Idempotency-Key`; bootstrap creation also requires quoted `If-Match`. Access is
owner-bound. Provider subjects and credential handles are redacted. Capacity
query results must remain diagnostic with `reservation: "none"`.

## Internal API

All internal routes use the internal audience and `POST`:

| Path | Scope |
| --- | --- |
| `/internal/v1/native-subscriptions/probe` | `accounts:read` |
| `/internal/v1/capsule-maintenance/grants` | `accounts:credentials:request` |
| `/internal/v1/capsule-maintenance/consume` | `accounts:credentials:issue` |
| `/internal/v1/capability-uses/consume` | `accounts:generation:check` |
| `/internal/v1/slot-eligibility` | `accounts:eligibility:issue` |
| `/internal/v1/generation-check` | `accounts:generation:check` |
| `/internal/v1/capacity-pool-evidence` | `accounts:capacity-pools:attest` |
| `/internal/v1/execution-policy-evidence` | `accounts:execution-policy:attest` |
| `/internal/v1/credential-binding-receipts` | `accounts:credentials:issue` |

Complete schemas, status codes, and operation IDs are in
[`../openapi/accounts.capacity.v1.json`](../openapi/accounts.capacity.v1.json).
Regenerate with `bun openapi/generate.ts`; unknown failures are returned as safe
`accounts.error.v1` dependency failures.
