# HTTP API

`evals-serve` starts a JSON API on port `19440`. Set `EVALS_PORT` to override it.

```bash
evals-serve
EVALS_PORT=8080 evals-serve
```

The server currently exposes API routes only. The React dashboard is run separately during development; see [dashboard/README.md](../dashboard/README.md).

## Endpoints

### `GET /api/health`

Returns `{ "ok": true, "version": "0.1.0" }`.

### `POST /api/runs`

Runs a dataset. `dataset` and `adapter` are required.

```json
{
  "dataset": "datasets/smoke.jsonl",
  "adapter": {
    "type": "http",
    "url": "http://localhost:3000/api/chat"
  },
  "concurrency": 5,
  "skipJudge": false,
  "save": true
}
```

The run is saved by default; set `save` to `false` to keep it in memory only. Returns the full `EvalRun`.

### `GET /api/runs`

Lists saved runs newest-first. Query parameters:

- `limit`: maximum rows; default `20`.
- `dataset`: exact dataset-path filter.

### `GET /api/runs/:id`

Returns one saved run by full ID or unambiguous prefix. Add `?format=markdown` for a Markdown response; other values return JSON. Missing runs return `404`.

### `POST /api/judge`

Requires `input`, `output`, and `rubric`; accepts optional `expected` and `model`. It uses the default Anthropic provider and returns a `JudgeResult`.

```json
{
  "input": "What is 2+2?",
  "output": "4",
  "rubric": "Must answer 4"
}
```

### `POST /api/baselines`

Requires `name` and `runId`, then stores or replaces that baseline mapping. The endpoint does not validate the run ID before writing; the database foreign-key constraint may reject an unknown ID.

### `GET /api/baselines/:name`

Returns the run referenced by a baseline or `404` when no matching baseline exists.

## Errors

Validation errors use status `400` and `{ "error": "..." }`. Unknown routes and missing resources use `404`. Unhandled loader, runner, provider, or database failures use `500`.
