# open-secrets Canonical S3 Adoption Evidence: 2026-06-09

Scope: repo-local task `d5a5eebe`, adopting the Hasna XYZ canonical bucket and
secret paths for `open-secrets`.

## Decision

`open-secrets` does not currently own durable S3 object storage. It stores local
vault data in SQLite by default, supports optional Postgres/RDS storage sync, and
syncs secret values with AWS Secrets Manager. There is no app runtime path that
uploads to or downloads from S3.

Therefore this task is a no-op for object migration and code-level S3 runtime
configuration. Do not add fake S3 runtime dependencies just to satisfy the
bucket naming task. The canonical bucket remains available for future
app-owned artifacts if the app later adds object storage.

## Canonical Resource Mapping

| Purpose | Canonical resource |
| --- | --- |
| App bucket | `hasna-xyz-opensource-secrets-prod` |
| AWS metadata secret | `hasna/xyz/opensource/secrets/prod/aws` |
| Env metadata secret | `hasna/xyz/opensource/secrets/prod/env` |
| RDS runtime secret | `hasna/xyz/opensource/secrets/prod/rds` |
| S3 metadata secret | `hasna/xyz/opensource/secrets/prod/s3` |

Legacy object storage mapping: none found.

## Evidence

- Source/dependency scan found no `@aws-sdk/client-s3`, `S3Client`,
  `PutObject`, `GetObject`, `ListObjects`, `s3://`, `S3_BUCKET`, or `AWS_S3`
  runtime references in `src/`, `extension/`, or `tests/`.
- `package.json` dependencies are AWS Secrets Manager, AWS credential providers,
  MCP SDK, and Postgres. There is no S3 client dependency.
- Canonical bucket `hasna-xyz-opensource-secrets-prod` exists in
  `hasna-xyz-infra/us-east-1`.
- Bucket controls were verified read-only:
  - public access block: all four block settings are `true`
  - versioning: `Enabled`
  - server-side encryption: `AES256`
- AWS Secrets Manager metadata in `hasna-xyz-infra/us-east-1` has the four
  canonical `hasna/xyz/opensource/secrets/prod/{aws,env,rds,s3}` names.
- Local open-secrets vaults on spark02, spark01, and apple03 each have the same
  four canonical names with redacted/no-value inspection only.
- `AWS_PROFILE=hasna-xyz-infra secrets aws sync --dry-run` planned four
  metadata-only pushes for the open-secrets canonical names with `mutation=none`.

## Safety Boundary

No secret values were printed or read for this evidence. No AWS secrets, S3
objects, local vault rows, RDS rows, or open-files review rows were mutated.
