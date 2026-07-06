# @hasna/catalog

Read-model app catalog for Hasna distribution. `open-catalog` seeds canonical
`hasna.app.v1` app records from the local opensource workspace, serves them
through a CLI, an MCP server, and minimal HTTP GET endpoints, and generates the
public static catalog site (the hasna.xyz surface).

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

## CLI

```bash
# Seed the catalog from an opensource checkout directory (writes SQLite + JSONL fixture)
catalog seed --root ~/workspace/hasna/opensource --fixture fixtures/apps.seed.jsonl

# Query the read model
catalog list
catalog list --lifecycle active --channel stable --json
catalog get open-todos
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
