# Evidence Storage Contract

`@hasna/files` is a shared durable file and evidence layer for apps.

## Boundary

Apps own domain meaning. `@hasna/files` owns bytes.

Apps should store `file_asset_id` plus domain metadata such as `company_id`, `source_type`, `source_id`, and `kind`. They should not own production bucket names, object keys, signed URL generation, retention behavior, or file access audit.

## Production Bucket

This package ships no default bucket name. Operators configure their own
bucket via `HASNA_FILES_S3_BUCKET` (or `HASNA_FILES_EVIDENCE_BUCKET`); detailed
migration runbooks and legacy bucket aliases are private operator evidence and
are not part of the public package.

Canonical evidence object layout (content-addressed, hasna/apps#1650):

```txt
quarantine/evidence/{org_id}/{sha256}[.{ext}]      staging (new uploads)
evidence/{org_id}/{sha256}[.{ext}]                 content-addressed object
evidence/{org_id}/manifests/{asset_id}.json        immutable per-asset manifest
```

- Keys are deterministic in (org, content): a duplicate upload for the same
  org lands on the same object — completion skips the copy when the canonical
  object already exists with the same checksum, so a duplicate never leaves a
  second object.
- The manifest carries the content address + provenance summary, so a bucket
  listing is restorable without the database.
- Legacy keys (`orgs/{org}/companies/...` and `tenants/{tenant}/objects/...`)
  stay readable for the whole migration window: assets persist their own
  `object_key` and reads resolve it verbatim. `isLegacyEvidenceKey` classifies
  stored keys for tooling.
- Files enter the bucket under `quarantine/` and move to the final key only
  after completion verifies size and checksum metadata.

## Bucket Configuration (operator infra — applied, never attempted in code)

The package executes object operations only; versioning, lifecycle, tagging
and IAM are applied as infrastructure change (documented constants in
`src/lib/bucket-config.ts`):

| Setting | Value |
| --- | --- |
| Versioning | Enabled |
| Lifecycle | Noncurrent versions expire after 90 days |
| Lifecycle | Incomplete multipart uploads abort after 7 days |
| Tags | `Class`, `Project`, `Component` on objects |
| Task-role grant | One inline policy per role, exactly one bucket ARN |

## Required Lifecycle

1. App requests an upload intent from `@hasna/files`.
2. `@hasna/files` creates a `file_asset` and `file_upload_intent`.
3. Client uploads to the returned destination.
4. `@hasna/files` completes the upload by verifying the object metadata.
5. Verified assets may be linked to app records.
6. Downloads are signed through `@hasna/files` and recorded in `file_access_events`.

## Local Mode

Local filesystem storage is allowed for development, tests, and offline
deployments. The default evidence provider is S3; select local storage with
`--storage local`, an SDK override, or `HASNA_FILES_EVIDENCE_STORAGE=local`.
The default local root is `<files-data-dir>/evidence` and can be overridden with
`HASNA_FILES_EVIDENCE_LOCAL_ROOT`. Each asset persists its resolved local root
so later complete, verify, and download operations resolve the same bytes.

## Environment

Repo-level object storage aliases are preferred:

```bash
HASNA_FILES_S3_BUCKET=<your-bucket>
HASNA_FILES_S3_PREFIX=objects
HASNA_FILES_AWS_REGION=us-east-1
HASNA_FILES_AWS_PROFILE=<your-aws-profile>
HASNA_FILES_S3_ENDPOINT=
HASNA_FILES_S3_FORCE_PATH_STYLE=0
```

`HASNA_FILES_EVIDENCE_BUCKET` (the `EVIDENCE_S3_BUCKET` alias) is the legacy
dedicated-evidence bucket. Either bucket env works — evidence keys are
identical in both (`evidence/{org_id}/{sha256}` under the optional prefix), so
the alias keeps deployments that already carved out a separate bucket running,
and folding evidence into the shared files bucket later is a copy, never a
rewrite. The existing `HASNA_FILES_EVIDENCE_*` variables remain compatible for
apps that already use evidence-specific configuration.

## Cloud Runtime Boundary

Evidence operations use the active files store:

- In local mode, evidence metadata is in SQLite. Per-call CLI/MCP/SDK storage
  overrides are honored and bytes may use local storage or S3.
- In API mode, evidence metadata is in the service's PostgreSQL database and
  the service owns storage configuration. Client bucket, profile, endpoint,
  prefix, and local-root overrides are ignored by the API store so a thin
  client cannot redirect the vault.
- There is no local/remote metadata synchronization command. PostgreSQL schema
  changes are applied by the service-only `files-migrate` executable.
- Bytes move only through evidence, S3, Google Drive import, upload, download,
  copy, delete, and signed-URL operations; metadata transport selection does
  not migrate object bytes.

For hosted deployments, configure AWS credentials by named profile, environment
provider chain, or platform secret injection. Do not write raw access keys into
task comments, docs, logs, PRs, or public config. S3-compatible endpoints may
set `HASNA_FILES_S3_ENDPOINT` and `HASNA_FILES_S3_FORCE_PATH_STYLE`.
`files sources` does not persist static S3 access keys or session tokens.

Use `files evidence configure-prod` to print the effective no-secret local
evidence configuration. It does not probe credentials or contact S3.

## 2026-06-09 Checksum Note

S3 uploads that include a SHA-256 checksum must set both the checksum value and
`ChecksumAlgorithm=SHA256`. Checksum-bound direct uploads use single
`PutObject`; multipart upload does not accept the same whole-object checksum
semantics. Presigned PUTs also include the checksum algorithm. Verification
evidence should record aggregate status, checksum algorithm, size, and result;
private asset ids and object keys stay in operator artifacts.

## Security Defaults

- Generate storage names; preserve original names only as metadata.
- Require checksum algorithm and checksum on every asset.
- Keep upload URLs short lived.
- Treat signed URLs as bearer tokens.
- Store access events for reads, downloads, signing, linking, and verification.
- Track scan status even when the current implementation marks local/S3 direct uploads as `skipped`.
- Track retention and legal hold metadata now so S3 Object Lock can be enabled without app schema changes.
