# Open Package Storage Boundary

This standard applies to every `open-[name]` repository, not only
`open-economy`.

The reference shape is the `open-skills` open-core pattern:

- the open repo owns the reusable engine, CLI, MCP/API contracts, SDK helpers,
  schemas, validation, docs, and local-safe defaults
- the private SaaS wrapper owns accounts, auth, billing, tenants, hosted
  databases, object storage, workers, queues, secrets, deployment,
  observability, and entitlement enforcement
- hosted or remote mode can exist in the open repo only as an explicit client
  contract; it must not be the install-time or CI default

## Repository Roles

| Repository | Owns | Must Not Own |
| --- | --- | --- |
| `open-[name]` | local data model, migrations, local SQLite/file storage, public remote/storage interfaces, CLI/MCP/API behavior, local tests, public docs | private account state, SaaS tenant database, hosted workers, billing, private secrets, private deployment |
| `platform-[name]` | SaaS wrapper, auth, accounts, billing, RDS/Postgres, S3/object storage, queues, workers, hosted web app, observability, secrets | public package identity or local-only source of truth |
| `open-cloud` / `@hasna/cloud` | archived reference/templates only; npm latest is a deprecated dependency-free stub | runtime dependency for any `open-[name]` package |

## Local-First Contract

Every `open-[name]` repo must work without network access after installation.

Required defaults:

- store local app data in `~/.hasna/[name]/`
- use SQLite or local files by default
- keep migrations owned by the open repo
- make `sync`, `serve`, CLI, and MCP usable locally without hosted credentials
- do not call hosted APIs unless the user explicitly enables remote/hosted mode

Optional remote mode:

- expose a small storage/sync interface from the open repo
- support direct Postgres/RDS or S3 only when that repo genuinely needs it
- require explicit config such as `HASNA_[SERVICE]_DATABASE_URL`,
  `HASNA_[SERVICE]_S3_BUCKET`, or `HASNA_[SERVICE]_REMOTE_MODE=true`
- preserve local behavior when those variables are absent

Use plural service names in env vars when the package name is plural:
`HASNA_CONNECTORS_DATABASE_URL`, not `HASNA_CONNECT_DATABASE_URL`.

Remote mode names are repo-owned. A package can also support a backwards
compatible alias during migration, but the canonical names should be:

- `HASNA_[SERVICE]_STORAGE_MODE=local|remote|hybrid`
- `HASNA_[SERVICE]_DATABASE_URL`
- `HASNA_[SERVICE]_S3_BUCKET`
- `HASNA_[SERVICE]_S3_PREFIX`
- `HASNA_[SERVICE]_AWS_REGION`
- `HASNA_[SERVICE]_SYNC_BATCH_SIZE`

Do not use shared `HASNA_CLOUD_*` env vars in public packages.

## Cross-Machine Sync

Cross-machine sync stays supported, but it is a repo-native sync concern, not a
shared cloud package dependency.

Each repo that syncs local state should define:

- a stable table/object manifest
- a local cursor or high-water mark
- idempotent upserts by stable ids
- conflict policy, usually last-write-wins unless the domain needs merges
- delete/tombstone behavior
- dry-run/status commands for CLI and MCP
- remote adapter tests with mocked Postgres/S3 endpoints

Local peer sync can still exist for machine-to-machine workflows. It must not
be the only path to hosted remote mode, and it must not require SaaS accounts.

## Cloud Resource Naming

Cloud resources belong to the wrapper or deployment environment, not the open
runtime default.

Use stable, plural service segments and environment folders:

- secrets: `hasna/xyz/opensource/[service]/prod/{env,aws,s3,rds}`
- plural service names: `connectors/prod`, not `connect/prod`
- buckets: `hasna-xyz-opensource-[service]-prod`
- databases: service-owned names matching `[service]` and environment
- wrapper secrets: `[product]/production/runtime/env`, `[product]/production/stripe`,
  `[product]/production/oauth`, and `[product]/production/seed-admin`

If a repo has no cloud storage requirement, do not create empty cloud config.
Record that it is local-only.

The open repo can document the env contract. The platform wrapper owns the
actual production secret, RDS, S3, Redis, ECS, OIDC, observability, and
deployment resources.

## SaaS Wrapper Contract

Use `open-skills` plus `platform-skills` as the reference split:

- the open package publishes the public engine, schemas, CLI/MCP/API contract,
  local storage, remote client/storage interfaces, validation, and docs
- the platform wrapper depends on the public package version
- the platform wrapper owns auth, accounts, billing, tenants, hosted database
  schema, workers, queues, web app, secrets, deploy scripts, and observability
- wrapper tests must pin the upstream package version and fail if private code
  imports public package internals outside an explicit boundary module
- wrapper docs must record the upstream package, version, product domain, and
  what is never upstreamed

Platform wrappers must refresh their locks after every public package release
that removes cloud coupling. The platform package and lock scan is:

```bash
rg -n '@hasna/cloud|open-cloud|@hasna/wallets' \
  /home/hasna/workspace/hasnatools/platform/platform-* \
  --glob 'package.json' \
  --glob 'bun.lock' \
  --glob 'package-lock.json' \
  --glob 'pnpm-lock.yaml' \
  --glob 'yarn.lock' \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  --glob '!coverage/**' \
  --glob '!**/.next/**'
```

## Public Package Gate

Each `open-[name]` repo should have a release gate equivalent to
`open-todos`/`open-skills`:

- package metadata has no `@hasna/cloud`, `open-cloud`, private wrapper, or
  hosted-only dependency
- public bins and exports do not expose `remote`, `cloud`, private SaaS, or
  deployment-only entrypoints
- source and built output do not include private platform markers, secret-like
  values, or private API URLs
- local tests prove common operations run without network access
- install smoke verifies the public CLI/MCP/server help/version paths without
  requiring a live hosted service
- remote mode tests, when present, use explicit env/config and mocked endpoints

Minimum verification for each repo:

```bash
bun run typecheck
bun test
bun run build
```

Use the repo-native equivalents for Rust, Python, Swift, or mixed workspaces.
The cross-repo publish order and downstream lock refresh procedure lives in
`docs/open-package-no-cloud-release-train.md`.

## Migration Rules

1. Remove `@hasna/cloud` and `open-cloud` as runtime dependencies.
2. Preserve only reusable adapter ideas as local interfaces, docs, fixtures, or
   templates.
3. Move SaaS implementation code into `platform-[name]`.
4. Keep public packages installable and useful without hosted accounts.
5. Use explicit remote config for cloud-backed mode.
6. Add release gates before publishing or updating any open package.
7. Keep `open-cloud` out of active runtime graphs. Its npm package line is
   deprecated and latest is a dependency-free archive stub.

## Current Scope Notes

The active scope is every top-level directory matching:

```bash
/home/hasna/workspace/hasna/opensource/open-*
```

That includes packages, CLIs, apps, archived candidates, and future
`open-[name]` repos. Do not treat this document's location inside
`open-economy` as a scope limit.

Regenerate the current inventory with:

```bash
find /home/hasna/workspace/hasna/opensource -maxdepth 1 -type d -name 'open-*' -printf '%f\n' | sort
```
