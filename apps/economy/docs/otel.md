# OTLP/HTTP sidecar

`economy-otel` writes application/service metrics into the local Economy SQLite database:

```bash
economy-otel --port 4318
```

It binds to `127.0.0.1` by default. Override the bind with `ECONOMY_OTEL_BIND` and the port with `ECONOMY_OTEL_PORT` or `--port`.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/health` | `{ status, service, version }`. |
| `POST` | `/v1/metrics` | Parse an OTLP JSON `resourceMetrics` payload. |
| `POST` | `/ingest` | Parse one simplified JSON cost/token event. |

Other methods return 405. Invalid JSON returns 400. A valid payload with no recognized positive cost/token metrics returns `{ "ingested": 0, "message": "no matching metrics" }`.

## Simplified event

```bash
curl -X POST http://127.0.0.1:4318/ingest \
  -H 'content-type: application/json' \
  -d '{
    "source": "app",
    "cost_center": "alumia",
    "cost_center_kind": "app",
    "project_path": "/workspace/alumia",
    "model": "gpt-5-mini",
    "cost_usd": 0.12,
    "input_tokens": 1200,
    "output_tokens": 300
  }'
```

Core fields are `agent`/`source`, `session_id`, `request_id` or `source_request_id`, `model`, `timestamp`, `cost_usd`, `input_tokens`, and `output_tokens`. An event must have positive cost or tokens.

Attribution fields include:

- `cost_center`, `cost_center_kind`, `cost_center_id`
- `attribution_tag`, `project_path`, `project_name`, `repo`
- `account_key`, `account_tool`, `account_name`, `account_email`, `account_source`
- `cost_basis` (`metered_api`, `subscription_included`, `estimated`, or `unknown`)

Cost-center kinds are `loop`, `app`, `repo`, `service`, and `team`. When kind and name are present, the sidecar creates a cost center such as `app:alumia` unless an explicit ID is supplied. Unknown agents normalize to the cost-center kind when it is a supported pseudo-agent (`app`, `service`, `repo`, `loop`), otherwise `service`.

## OTLP recognition

The OTLP parser reads sum or gauge data points. Metric names containing cost or `.usd` become cost; names containing input+token or `tokens.input` become input tokens; names containing output+token or `tokens.output` become output tokens. Points are joined by agent and request/event ID.

Resource and point attributes may use plain names (`model`, `session_id`, `request_id`, `project_path`, and the attribution fields above) or common dotted aliases such as `ai.model`, `session.id`, `event.id`, `service.name`, `economy.cost_center`, and `account.email`.

The sidecar always opens the local SQLite database. It does not forward to a cloud API; use the authenticated REST bulk-ingest path for remote ingestion.
