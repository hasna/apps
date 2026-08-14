# Local Storage and Baselines

Saved runs and baselines use Bun's SQLite driver. The default database is:

```text
~/.hasna/evals/evals.db
```

Set `EVALS_DB_PATH` to use a different file or `:memory:`. The database enables WAL mode and foreign keys on open.

## Legacy migration

When `~/.evals` exists, regular files missing from `~/.hasna/evals` are copied into the new directory on a best-effort basis. Existing destination files are never overwritten. Migration read/copy failures do not block startup.

## Saving runs

- `evals run` saves only with `--save`.
- `evals ci run` always saves.
- `POST /api/runs` saves unless `save` is `false`.
- MCP `evals_run` saves only when `save` is true.
- SDK callers save explicitly with `saveRun`.

Run IDs are UUIDs. `getRun` and commands built on it accept an exact ID or unique prefix; ambiguous prefixes throw instead of choosing an arbitrary run. Lists are newest-first and can filter by exact dataset path.

## Secret redaction

Before a run is returned by `runEvals`, serialized by `toJson`, or persisted by `saveRun`, a top-level adapter `apiKey` is removed. Other arbitrary secrets in headers, command strings, environment maps, case outputs, or metadata are not automatically redacted. Treat stored run data as sensitive.

## Baselines

A baseline maps a name to a saved run ID. `setBaseline` replaces an existing mapping with the same name. `evals ci set-baseline <name>` uses a supplied `--run-id` or the newest saved run; `evals compare` and MCP `evals_compare` resolve baseline names as well as run IDs.

Deleting a run referenced by a baseline is subject to SQLite foreign-key constraints. Use SDK storage functions when explicit baseline listing or removal is required.
