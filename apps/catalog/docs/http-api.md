# HTTP API

`catalog serve` exposes a minimal read-only HTTP interface backed by the same
SQLite store as the CLI.

```bash
catalog serve
# Open Catalog API listening on http://127.0.0.1:8797
```

All successful and error responses are formatted JSON with
`content-type: application/json; charset=utf-8`.

## Routes

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/health` | `{ "status": "ok", "service": "catalog", "version": "...", "apps": number }` |
| `GET` | `/v1/apps` | `{ "apps": App[], "count": number }` |
| `GET` | `/v1/apps/:appId` | `{ "app": App }`, or 404 |
| `GET` | `/v1/search?q=<text>` | `{ "apps": App[], "count": number, "query": string }` |

Other paths return 404. Any non-`GET` request returns 405 with
`catalog is a read model; only GET is supported`.

### List query parameters

`GET /v1/apps` accepts:

| Parameter | Values or behavior |
| --- | --- |
| `lifecycle` | `active`, `stub`, `deprecated`, or `archived` |
| `channel` | `stable`, `beta`, `canary`, or `internal` |
| `limit` | Integer; defaults to 500 and is clamped to 1–1000 |
| `offset` | Integer; defaults to 0 and negative values become 0 |

Invalid lifecycle or channel values are currently ignored rather than
returning an error. Pagination values are parsed with `Number.parseInt`, so a
leading integer prefix is accepted (for example, `3items` becomes `3`);
values with no integer prefix use their defaults. Results are ordered by
`appId`.

### Search

`q` is required and must contain non-whitespace text; otherwise the endpoint
returns 400. Search is case-insensitive across app id, npm name, summary, and
tags. It returns at most 50 records. Literal `%` and `_` are removed from the
query before matching.

### App ids

The app route accepts lowercase letters, digits, and dashes. A well-formed but
unknown app id returns 404 with `{ "error": "app not found: <appId>" }`.

## Security

The HTTP interface has no authentication, authorization, or TLS. It binds to
`127.0.0.1:8797` by default and is classified as a local development
convenience, not a supported hosted API. Setting `--host`, `CATALOG_HOST`, or a
reverse proxy to expose it beyond loopback makes every catalog record readable
without credentials.

The server does not provide `/ready` or `/version`; use `/health` for its
available probe. The package version is included in the `/health` body.

## Programmatic handler

The `@hasna/catalog/server` export provides:

```ts
import {
  createCatalogHandler,
  startCatalogServer,
} from "@hasna/catalog/server";
```

`createCatalogHandler({ store })` returns a `(Request) => Response` handler and
accepts any `CatalogStoreLike`. `startCatalogServer({ store, host, port })`
starts `Bun.serve`.
