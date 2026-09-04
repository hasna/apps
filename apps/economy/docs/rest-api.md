# REST API

Start the service with `economy-serve` or `economy serve`. The default local origin is `http://127.0.0.1:3456`; the bind behavior is detailed in [configuration](configuration.md#rest-server).

The canonical application prefix is `/v1`. Equivalent `/api` routes remain available for older clients. Successful application responses use:

```json
{ "data": {}, "meta": {} }
```

Errors use `{ "error": "message" }`. Foundation probes return a direct `{ status, version, mode, service }` object instead of the data envelope.

## Discovery and probes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health`, `/healthz` | Liveness. |
| `GET` | `/ready`, `/readyz` | Storage readiness; may return 503. |
| `GET` | `/version`, `/v1/version` | Version and deployment mode. |
| `GET` | `/openapi.json` | Runtime-versioned OpenAPI document. |

These routes are open. The checked-in OpenAPI source is [`openapi/economy.json`](../openapi/economy.json).

## Authentication

In local mode, set `ECONOMY_API_TOKEN` or `HASNA_ECONOMY_API_TOKEN` and send either:

```text
Authorization: Bearer <token>
X-Economy-Token: <token>
```

In self-hosted Postgres mode, send a valid Economy API key as `x-api-key` or a bearer token. All non-probe routes require a valid key when the server has an authenticator. Bulk ingest and feedback additionally request the `economy:write` scope.

## Read routes

| Method | Canonical path | Parameters/behavior |
| --- | --- | --- |
| `GET` | `/v1/summary` | `period` (default `today`), optional `machine`. |
| `GET` | `/v1/machines` | Machine rollups and current machine metadata. |
| `GET` | `/v1/fleet` | `period` (default `month`), optional `machine`; returns summary, machines, registry. |
| `GET` | `/v1/daily` | `days` (default 30), optional `machine`. |
| `GET` | `/v1/hourly` | Optional `machine`; `hours` must be 1–48. |
| `GET` | `/v1/sessions` | `agent`, `project`, `search`, `machine`, `account`, `limit` (50), `offset` (0), `since`, and comma-separated `fields`. |
| `GET` | `/v1/sessions/{id}/requests` | Full ID or unique prefix; returns 404 when absent. |
| `GET` | `/v1/top` | `n` (default 10), optional `agent` and `since`. |
| `GET` | `/v1/models` | Model breakdown. |
| `GET` | `/v1/projects` | Project breakdown; `period` defaults to `all`, optional `machine`. |
| `GET` | `/v1/projects/detail` | Detailed project query; `q` is required. |
| `GET` | `/v1/accounts` | Account breakdown; `period` defaults to `all`, optional `machine`. |
| `GET` | `/v1/breakdown` | `by=model|project|agent|account|cost-center|loop|app|repo|service|team`, optional `period` and `machine`. |
| `GET` | `/v1/usage` | `period` (default `month`), optional valid `agent`. |
| `GET` | `/v1/savings` | `period` (default `month`), optional valid `agent`. |
| `GET` | `/v1/billing` | `period` (default `month`). |
| `GET` | `/v1/billing/diff` | `period` (default `month`), `threshold` percentage (default 15). |
| `GET` | `/v1/budgets` | Budget statuses. |
| `GET` | `/v1/goals` | Goal statuses. |
| `GET` | `/v1/pricing` | Model pricing rows. |
| `GET` | `/v1/subscriptions` | Subscription plans. |
| `GET` | `/v1/project-registry` | Registered projects. |
| `GET` | `/v1/brief` | Fleet brief; optional `since` and `machine`. |
| `GET` | `/v1/export` | `type=sessions|requests`, `period` (default `month`); returns rows in JSON for clients to encode. |
| `GET` | `/v1/compare` | Required `from` and `to` dates (`YYYY-MM-DD`). |
| `GET` | `/v1/forecast` | Current-month projection. |
| `GET` | `/v1/efficiency` | Per-model token efficiency. |
| `GET` | `/v1/requests` | Requests after required ISO `since`; used by live watch. |

Common period values are `today`, `yesterday`, `week`, `month`, `year`, and `all`, but individual routes accept the subset documented above.

## Mutation routes

| Method | Canonical path | Body/behavior |
| --- | --- | --- |
| `POST` | `/v1/budgets` | Positive `limit_usd`; optional `period`, `alert_at_percent`, `project_path`, `agent`, `cost_center_id`. |
| `DELETE` | `/v1/budgets/{id}` | Delete a budget. |
| `POST` | `/v1/goals` | Positive `limit_usd`; `period=day|week|month|year`; optional `project_path`, `agent`. |
| `DELETE` | `/v1/goals/{id}` | Delete a goal. |
| `POST` | `/v1/pricing` | `model`, non-negative input/output/cache pricing fields. |
| `DELETE` | `/v1/pricing/{model}` | Delete a URL-encoded model row. |
| `POST` | `/v1/subscriptions` | Required `provider` and `plan`; optional ID, agent, fee/inclusion, cycle/reset, and active fields. |
| `DELETE` | `/v1/subscriptions/{id}` | Delete a plan. |
| `POST` | `/v1/project-registry` | Required `path`; optional `name`, `description`, `tags`. |
| `DELETE` | `/v1/project-registry/{path}` | Delete a URL-encoded project path. |
| `POST` | `/v1/sync` | `{ "sources": "all" }` or one of the eight agents/`loops`; triggers server-local ingestion. |
| `POST` | `/v1/billing/sync` | Optional `days` (1–366) and `providers` from `anthropic`, `openai`, `gemini`. Provider failures are returned per provider. |
| `POST` | `/v1/ingest` | Idempotently merge arrays named `requests`, `sessions`, `projects`, `budgets`, `goals`, `billing_daily`, `model_pricing`, `subscriptions`, and `usage_snapshots`. |
| `POST` | `/v1/feedback` | Required `message`; optional `email` and `category=bug|feature|general`. |

Agent fields accept `claude`, `takumi`, `codex`, `gemini`, `opencode`, `cursor`, `pi`, or `hermes`.
