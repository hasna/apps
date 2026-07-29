# Data model and library API

## Application records

The SQLite store contains validated `hasna.app.v1` documents keyed by `appId`.
The top-level record is strict: unknown fields are rejected.

| Field | Required | Notes |
| --- | --- | --- |
| `schema` | yes | Literal `hasna.app.v1` |
| `id` | yes | Non-empty contract record id |
| `createdAt` | yes | ISO datetime |
| `updatedAt` | no | ISO datetime or `null` |
| `appId` | yes | Lowercase dashed identifier |
| `npmName` | yes | Scoped or unscoped npm package name |
| `repoFolder` | yes | Lowercase dashed identifier |
| `githubUrl` | yes | `https://github.com/` or `git+https://github.com/` URL |
| `projectSlug` | yes | Lowercase dashed identifier |
| `surfaces` | no | Defaults to `{ "bins": [] }` |
| `lifecycle` | yes | `active`, `stub`, `deprecated`, or `archived` |
| `releaseChannel` | no | Defaults to `stable` |
| `summary` | no | Non-empty string |
| `tags` | no | Non-empty strings; defaults to `[]` |
| `metadata` | no | Open JSON object |

`surfaces.bins` must contain unique, non-empty strings. An optional MCP surface
has `transport` (`http` by default, or `stdio`), `bin`, and `url`. An optional
HTTP surface has `healthPath` (`/health` by default), positive integer `port`,
and `baseUrl`.

The current scanner records package versions in `metadata.version`, provenance
in `metadata.seededFrom`, and scan time in `metadata.seededAt`.

## Storage

`CatalogStore` uses Bun SQLite and enables write-ahead logging. Construction
creates the database directory, the `apps` table, and lifecycle/channel
indexes. Upserts validate the complete document and replace records that share
an `appId`.

List results are ordered by app id. List pagination defaults to 500 and is
clamped to 1–1000. Search is case-insensitive across app id, npm name, summary,
and the serialized tags field; it defaults to 50 results and is clamped to
1–500.

Only application records are stored. Install and rollout state is not.

## Seeding

For each eligible checkout, the scanner reads:

- package name, version, description, `bin`, and repository URL from
  `package.json`;
- the first nonblank, non-badge, non-HTML README line as a summary fallback;
- an optional projects-registry record matched by exact checkout path.

Object-valued `bin` fields contribute their keys. A string-valued `bin`
contributes the unscoped npm package name. If any bin ends in `-mcp`, the
scanner adds an MCP surface with that bin and `transport: "http"`.

The summary preference is package description, joined project description,
then README line. The GitHub URL preference is joined project remote, package
repository URL, then `https://github.com/hasna/<folder>`. Only recognized
GitHub URL prefixes are accepted from joins and package metadata.

A joined project slug is used only when it is a valid lowercase dashed
identifier. Lifecycle is `active` when the package has at least one bin or a
version; otherwise it is `stub`. Scanner-created records use release channel
`stable` and tag `oss`.

See [the CLI reference](cli.md#catalog-seed) for eligibility, duplicate
handling, output, and configuration.

## Rollout event validation

`createRolloutIngestionHook()` is intentionally a read-only stub. It accepts
these event types:

- `release.rollout.started`
- `release.rollout.completed`
- `release.rollout.failed`
- `app.installed`

All require non-empty `appId`, `package`, `version`, and `machine` strings in
`data`. Completed and failed events also require a non-empty `result`. Payload
and envelope extras are allowed. Accepted results always contain
`persisted: false`; no store is accepted or written.

The separately exported `RolloutRecordSchema` validates
`hasna.rollout_record.v1`, including the stronger requirements that
`freeze-blocked` results be `blocked` or `skipped`, and successful install or
update records include `verifiedBy`.

## Package exports

| Import path | Main exports |
| --- | --- |
| `@hasna/catalog` | contracts, types, store, seed helpers, static-site helpers, rollout hook, paths, version |
| `@hasna/catalog/contracts` | Zod schemas and distribution event types |
| `@hasna/catalog/store` | `CatalogStore` |
| `@hasna/catalog/seed` | scan and record-building helpers |
| `@hasna/catalog/site` | static HTML rendering and generation |
| `@hasna/catalog/ingest` | read-only rollout ingestion hook |
| `@hasna/catalog/server` | HTTP handler and Bun server |
| `@hasna/catalog/mcp` | MCP server and tool registration |

Example:

```ts
import {
  CatalogStore,
  seedCatalog,
} from "@hasna/catalog";

const store = new CatalogStore({ dbPath: "./catalog.db" });
const report = seedCatalog({
  root: "/path/to/checkouts",
  store,
  projectsJoin: [],
});
console.log(report.seeded.length);
store.close();
```
