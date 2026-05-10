# Local To Cloud Migration

The OSS migration path is copy-only. It reads the local SQLite database and
builds a manifest for a hosted compatible API. It never deletes local data,
never marks local rows as migrated, and never switches the CLI to remote mode.

Dry-run first:

```bash
todos cloud migrate --dry-run --json
```

Send to a configured remote API:

```bash
TODOS_API_URL=https://todos.md TODOS_API_KEY=tdos_... todos cloud migrate --confirm
```

The command posts to:

```text
/api/imports/local-sqlite
```

The request includes an `Idempotency-Key` header so retries can resume safely on
the paid API side. Use `--idempotency-key` to reuse a known key.

## Data Covered

The manifest covers local projects, task lists, plans, agents, sessions, tasks,
tags, dependencies, comments, audit history, templates, template tasks and
versions, dispatches, dispatch logs, checkpoints, heartbeats, task files,
commits, checklists, relationships, project sources, project-agent roles,
handoffs, context snapshots, task traces, and cycles.

## Conflict Handling

`--conflict skip` is the default. Paid import implementations should preserve
source IDs as provenance and map them to tenant-owned cloud IDs. Supported
strategy values are:

- `skip`
- `upsert`
- `fail`

## Safety Contract

Every manifest declares:

```json
{
  "mode": "copy-only",
  "safety": {
    "deletesLocalData": false,
    "mutatesLocalData": false,
    "localRemainsSource": true
  }
}
```

The paid app must enforce auth, org selection, ownership mapping, and RLS during
import. The OSS exporter does not assume any tenant model.
