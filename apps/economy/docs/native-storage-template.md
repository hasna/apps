# Native Storage Template

Use this template when an `open-[name]` repo needs remote database or file
storage while staying local-first and OSS-friendly.

The open repo owns the public storage contract. The platform wrapper owns
production RDS, S3, auth, tenants, billing, workers, secrets, and deployment.

## Config

Use repo-specific env vars. For `open-prompts`, use `PROMPTS`; for
`open-connectors`, use `CONNECTORS`.

```ts
export type StorageMode = "local" | "remote" | "hybrid";

export interface NativeStorageConfig {
  mode: StorageMode;
  databaseUrl?: string;
  databaseSchema?: string;
  databaseSsl?: boolean;
  s3Bucket?: string;
  s3Prefix?: string;
  awsRegion?: string;
  s3Endpoint?: string;
  s3ForcePathStyle?: boolean;
  syncBatchSize: number;
  dryRun: boolean;
}

export const STORAGE_ENV = {
  mode: "HASNA_SERVICE_STORAGE_MODE",
  databaseUrl: "HASNA_SERVICE_DATABASE_URL",
  databaseSchema: "HASNA_SERVICE_DATABASE_SCHEMA",
  databaseSsl: "HASNA_SERVICE_DATABASE_SSL",
  s3Bucket: "HASNA_SERVICE_S3_BUCKET",
  s3Prefix: "HASNA_SERVICE_S3_PREFIX",
  awsRegion: "HASNA_SERVICE_AWS_REGION",
  s3Endpoint: "HASNA_SERVICE_S3_ENDPOINT",
  s3ForcePathStyle: "HASNA_SERVICE_S3_FORCE_PATH_STYLE",
  syncBatchSize: "HASNA_SERVICE_SYNC_BATCH_SIZE",
  dryRun: "HASNA_SERVICE_SYNC_DRY_RUN",
} as const;
```

Replace `SERVICE` with the plural service name. Keep local mode as the default
when env vars are absent.

## Status

Expose the same status through CLI and MCP:

```ts
export interface NativeStorageStatus {
  package: string;
  mode: StorageMode;
  local: {
    dataDir: string;
    databasePath?: string;
    filesDir?: string;
  };
  remote: {
    databaseConfigured: boolean;
    s3Configured: boolean;
    databaseEnv: string;
    s3BucketEnv: string;
    region: string;
    dryRun: boolean;
  };
}
```

Commands should be safe in CI and local shells:

```bash
<cli> storage status --json
<cli> storage plan --json
<cli> storage sync --dry-run --json
```

Legacy `cloud` command aliases can exist during migration, but help text should
prefer `storage` and JSON output should identify the canonical mode as
`local`, `remote`, or `hybrid`.

## Postgres Sync

When a repo has durable records, use a stable record envelope:

```ts
export interface SyncRecord {
  scope: string;
  kind: string;
  id: string;
  updatedAt: string;
  deletedAt?: string | null;
  source?: string | null;
  payload: Record<string, unknown>;
}
```

Baseline schema:

```sql
CREATE TABLE IF NOT EXISTS service_sync_records (
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  source TEXT,
  payload JSONB NOT NULL,
  PRIMARY KEY (scope, kind, id)
);

CREATE INDEX IF NOT EXISTS service_sync_records_updated_at_idx
  ON service_sync_records (updated_at);

CREATE TABLE IF NOT EXISTS service_sync_cursors (
  scope TEXT NOT NULL,
  cursor_name TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, cursor_name)
);
```

Use idempotent upserts. Do not use tenant, billing, auth, or product tables in
the open repo. Those belong in the platform wrapper.

## S3 Files

Repos with files should write object metadata separately from the object body:

```ts
export interface SyncObject {
  scope: string;
  kind: string;
  id: string;
  key: string;
  sizeBytes: number;
  sha256: string;
  contentType?: string;
  updatedAt: string;
  deletedAt?: string | null;
}
```

Use deterministic keys:

```text
HASNA_SERVICE_S3_PREFIX/scope/kind/id
```

Keep binary uploads behind explicit `remote` or `hybrid` mode. Local mode should
read and write the local files directory only.

## Tests

Each repo should add focused tests for:

- env parsing and local default mode
- remote mode requiring explicit database or bucket config
- status JSON being stable and secret-free
- dry-run sync not mutating local or remote state
- idempotent Postgres upsert behavior with a fake query client
- S3 object key generation without AWS credentials
- local operation with `fetch` disabled
- hidden legacy aliases, if the repo keeps them during migration

Release gates still come from `docs/no-cloud-release-gate-template.md`.

## Wrapper Handoff

The platform wrapper consumes the public package API and provides production
resources:

- database URL and schema
- S3 bucket, prefix, and region
- auth/account/tenant context
- workers and queues
- billing and entitlements
- deployment and observability

The open repo should never need the wrapper installed to run local tests,
publish, or serve CLI/MCP help.
