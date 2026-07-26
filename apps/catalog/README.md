# @hasna/catalog

Read-model app catalog. `catalog` seeds canonical `hasna.app.v1` app records
from a local workspace of checkouts, serves them through a CLI, an MCP server,
and minimal HTTP GET endpoints, and generates a public static catalog site.

This package is a **read model only**: it never writes install or rollout
state. Rollout state arrives later as `hasna.rollout_record.v1` events written
by `machines-agent`; a read-only ingestion hook validates those events today
without persisting anything.

## Install

```bash
bun add @hasna/catalog
# or globally
bun add -g @hasna/catalog
```

## Behaviour change in 0.2.0: duplicate checkouts

`DUPLICATE_CHECKOUTS` used to hard-code six real repository folder names. It is
empty by default now, so a **deliberately renamed** duplicate checkout is no
longer skipped by name. Worktree, PR, release, fix, legacy, and hash-suffixed
checkouts are still skipped by pattern, and `dedupeByNpmName` still collapses
two folders sharing an npm name.

The gap is narrow but real: when both folders share an npm name, the winner is
the one matching `open-<unscoped-npm-name>`, so a stale alias can win over the
folder you actually want, silently flipping that record's `appId` and
`githubUrl`. When the npm names have also diverged, both get seeded.

Supply your aliases to restore the old behaviour:

```bash
catalog seed --root <checkout-dir> --duplicates ./duplicates.json
# or
export CATALOG_DUPLICATE_CHECKOUTS=~/.config/catalog/duplicates.json
```

```json
{ "stale-folder-name": "canonical-folder-name" }
```

That file is operator configuration. Keep it outside this repository.

## CLI

```bash
# Seed the catalog by scanning a directory of checkouts (writes SQLite, and JSONL if asked)
# The JSONL it writes is real inventory: send it somewhere outside this repo.
catalog seed --root <checkout-dir> --db ./catalog.db
catalog seed --root <checkout-dir> --fixture ~/catalog-export/apps.jsonl --seeded-from workspace-scan

# Query the read model
catalog list
catalog list --lifecycle active --channel stable --json
catalog get example-widget
catalog search "uptime"

# Generate the static catalog site into dist-site/
catalog site --out dist-site

# Serve minimal HTTP GET endpoints
catalog serve --port 8797
```

## HTTP API (read-only)

| Method | Path              | Description                          |
| ------ | ----------------- | ------------------------------------ |
| GET    | `/health`         | Health probe                         |
| GET    | `/v1/apps`        | List apps (`?lifecycle=&channel=`)   |
| GET    | `/v1/apps/:appId` | Get one app by `appId`               |
| GET    | `/v1/search?q=`   | Search apps by id, name, summary     |

## MCP

`catalog-mcp` exposes read-only tools over stdio:

- `catalog_list` — list apps with optional `lifecycle`, `channel`, `query` filters
- `catalog_get` — fetch a single app by `app_id`

## Contracts

App records implement `hasna.app.v1` from `@hasna/contracts`
(`feat/distribution-schemas`). Because that branch is not yet published, this
package vendors a minimal structural mirror of the schema in
`src/contracts.ts`; swap it for the real `@hasna/contracts` import once
published.

## License

Apache-2.0
