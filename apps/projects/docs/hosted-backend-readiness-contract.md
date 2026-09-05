# Hosted-Backend Readiness Contract

This contract describes what the hosted backend covers in `@hasna/projects`
today and what still requires an approval-backed migration task. It is
intentionally narrower than a cutover plan: no production AWS, RDS, S3, secret,
Terraform, or live data mutation is allowed by this document.

## Runtime Selection

`resolveProjectStore()` routes on the CREDENTIAL and the AUTHORITY only. There
is no mode switch and no local-registry opt-in: the whole decision belongs to
the `@hasna/contracts` client resolver, re-run on every call
(owner rulings 2026-09-04, hasna/apps#1720).

A credential from ANY of the five tiers selects the hosted HTTP connection:

1. an explicit argument (`--api-key` / a caller-supplied key)
2. a deliberate env pointer — `HASNA_PROJECTS_API_KEY_OVERRIDE`,
   `HASNA_PROFILE`, `HASNA_PROJECTS_API_KEY_REF`
3. the macOS Keychain item `hasna.credentials.projects.api-key`, account
   `HASNA_STATION`, else `hostname -s`, else `USER`
4. `~/.hasna/projects/config/credentials`, mode 0400/0600, read at call time
   (`HASNA_HOME` / `HASNA_CONFIG_HOME` move the roots; XDG is never read)
5. `HASNA_PROJECTS_API_KEY` in the process environment

The authority follows the same ladder — `HASNA_PROJECTS_API_URL`, the Keychain
`api-url` item, the credentials file — and defaults to the path-prefixed fleet
gateway `https://api.hasna.com/projects` (the client appends `/v1`) once a
credential resolves. URLs never need configuring. The unprefixed
`PROJECTS_API_URL` / `PROJECTS_API_KEY` names remain accepted as a documented
alias; the canonical `HASNA_PROJECTS_*` names always work and win.

| Surface | Unhosted (OSS) connection | Hosted HTTP connection |
| --- | --- | --- |
| Global project registry | `HASNA_PROJECTS_DB_PATH` or `~/.hasna/projects/projects.db` SQLite | Hosted API — every registry read/write routes to `<authority>/v1` with the resolved key |
| Per-project app store | `$HASNA_PROJECTS_HOME/data/<workspace_id>/project.db` SQLite | Not hosted-backed — stays local on the invoking machine |
| Project assets and canvas files | `$HASNA_PROJECTS_HOME/data/<workspace_id>/{assets,canvases}` local files | Not hosted-backed — stays local on the invoking machine |

## Adapter Rules

- An authority declared ANYWHERE with no resolvable credential FAILS LOUD:
  registry commands exit non-zero with the resolver's error, which names every
  place it looked. No local SQLite store is opened, and no local-fallback event
  is written.
- The on-box SQLite registry is reachable only when NOTHING configures the
  fleet — no URL in the environment, the Keychain or the credentials file, and
  no credential from any tier. That is the unhosted OSS mode projects supports
  by design, and it is never silent: it prints one line on stderr naming every
  tier that came up empty and the database it is about to use.
- A resolved credential routes every registry command through the hosted API.
  The client carries only the API key (never a database DSN), and the key value
  is never logged or embedded in output.
- Retired locations are never inputs: `~/.hasna/fleet-env/`, `~/.hasna/cloud/`,
  `~/.config/hasna/`, `$XDG_CONFIG_HOME/hasna/`, and any `*-cloud.env`.
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
