# Hosted-Backend Readiness Contract

This contract describes what the hosted backend covers in `@hasna/projects`
today and what still requires an approval-backed migration task. It is
intentionally narrower than a cutover plan: no production AWS, RDS, S3, secret,
Terraform, or live data mutation is allowed by this document.

## Runtime Selection

The client connection is selected by API URL and API key presence
(`resolveProjectStore`): HTTP when both are present. With neither present,
registry commands fail closed naming the required env — the local SQLite
registry opens only under the explicit opt-in
`HASNA_PROJECTS_LOCAL_REGISTRY=1`. A partial pair fails closed.

| Surface | Local connection | Hosted HTTP connection |
| --- | --- | --- |
| Global project registry | `HASNA_PROJECTS_DB_PATH` or `~/.hasna/projects/projects.db` SQLite | Hosted API — every registry read/write routes to `<HASNA_PROJECTS_API_URL>/v1` with the bearer key |
| Per-project app store | `$HASNA_PROJECTS_HOME/data/<workspace_id>/project.db` SQLite | Not hosted-backed — stays local on the invoking machine |
| Project assets and canvas files | `$HASNA_PROJECTS_HOME/data/<workspace_id>/{assets,canvases}` local files | Not hosted-backed — stays local on the invoking machine |

The hosted HTTP connection is the joint presence of
`HASNA_PROJECTS_API_URL` plus `HASNA_PROJECTS_API_KEY`. The unprefixed
`PROJECTS_API_URL` and `PROJECTS_API_KEY` aliases are also accepted. No other
selector is read.

## Adapter Rules

- Running WITHOUT the API variables fails closed (owner ruling 2026-09-04):
  registry commands exit non-zero with an actionable error naming
  `HASNA_PROJECTS_API_URL` / `HASNA_PROJECTS_API_KEY`; the local SQLite
  registry is never opened as a default.
- The local SQLite registry is reachable only through the explicit opt-in
  `HASNA_PROJECTS_LOCAL_REGISTRY=1`; the hosted pair, when present, takes
  precedence.
- A complete API URL/key pair routes every registry command through the hosted
  API. The client
  carries only the API key (never a database DSN), and the key value is never
  logged or embedded in output.
- Misconfiguration is fail-closed: setting only one of
  `HASNA_PROJECTS_API_KEY` and `HASNA_PROJECTS_API_URL` refuses to route, and
  commands hard-fail rather than silently reading the wrong dataset.
- The HTTP connection does not move per-project data: canvases, data records,
  loop links, and asset files stay in
  `$HASNA_PROJECTS_HOME/data/<workspace_id>/` on the invoking machine.
- The server requires PostgreSQL: `projects-serve` fails fast without
  `HASNA_PROJECTS_DATABASE_URL` (or `PROJECTS_DATABASE_URL` / `DATABASE_URL`).
  API keys are verified per request and scoped `projects:read` (reads) and
  `projects:write` (writes).
- `workspaces.s3_bucket` and `workspaces.s3_prefix` are registry metadata only;
  they do not imply an active S3 asset adapter.

## Migration Approval Gate

A follow-up approval task is required before any of these actions:

- create or mutate production RDS schemas for per-project app store tables
- backfill real `project.db` data into Postgres
- create, select, or write production S3 buckets or object prefixes
- move user project data from local files to hosted storage
- change runtime reads/writes of the per-project app store or asset files from
  local SQLite/local files to hosted services

The approval task should include source data inventory, dry-run output, rollback
steps, read-only smoke evidence, secret provisioning evidence without secret
values, and a maintenance window.
