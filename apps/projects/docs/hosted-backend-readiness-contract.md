# Hosted-Backend Readiness Contract

This contract describes what the hosted backend covers in `@hasna/projects`
today and what still requires an approval-backed migration task. It is
intentionally narrower than a cutover plan: no production AWS, RDS, S3, secret,
Terraform, or live data mutation is allowed by this document.

## Runtime Selection

The client has exactly two stores, selected entirely by environment
(`resolveProjectStore`): the local SQLite registry, or the hosted HTTP API when
`HASNA_PROJECTS_API_URL` plus `HASNA_PROJECTS_API_KEY` are both present. There
are no deployment modes and no mode variable.

| Surface | Local store | Hosted backend |
| --- | --- | --- |
| Global project registry | `HASNA_PROJECTS_DB_PATH` or `~/.hasna/projects/projects.db` SQLite | Hosted API — every registry read/write routes to `<HASNA_PROJECTS_API_URL>/v1` with the bearer key |
| Per-project app store | `$HASNA_PROJECTS_HOME/data/<workspace_id>/project.db` SQLite | Not hosted-backed — stays local either way |
| Project assets and canvas files | `$HASNA_PROJECTS_HOME/data/<workspace_id>/{assets,canvases}` local files | Not hosted-backed — stays local either way |

The hosted route is the joint presence of `HASNA_PROJECTS_API_URL` plus
`HASNA_PROJECTS_API_KEY`. There is exactly one API client transport; the
distinction between deployments is server-side tenancy, not the client.

## Adapter Rules

- Local is the default: no API URL/key pair means the local SQLite registry.
- The hosted backend routes every registry command through the hosted API. The
  client carries only the API key (never a database DSN), and the key value is
  never logged or embedded in output.
- Misconfiguration is fail-closed: setting only one half of the
  `HASNA_PROJECTS_API_URL` / `HASNA_PROJECTS_API_KEY` pair refuses to route,
  and commands hard-fail rather than silently reading the wrong dataset.
- The hosted route does not move per-project data: canvases, data records, loop
  links, and asset files stay in `$HASNA_PROJECTS_HOME/data/<workspace_id>/`
  either way.
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
- move user project data from local files to the hosted backend
- change runtime reads/writes of the per-project app store or asset files from
  local SQLite/local files to remote services

The approval task should include source data inventory, dry-run output, rollback
steps, read-only smoke evidence, secret provisioning evidence without secret
values, and a maintenance window.
