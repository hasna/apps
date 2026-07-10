# Evidence Storage Contract

`@hasna/files` is a shared durable file and evidence layer for apps.

## Boundary

Apps own domain meaning. `@hasna/files` owns bytes.

Apps should store `file_asset_id` plus domain metadata such as `company_id`, `source_type`, `source_id`, and `kind`. They should not own production bucket names, object keys, signed URL generation, retention behavior, or file access audit.

## Production Bucket

`hasna-xyz-opensource-files-prod` is the production bucket for this repo,
following the Hasna XYZ storage naming pattern. Detailed migration runbooks stay
in private operator evidence and are not part of the public package.

The old `hasna-files-prod` bucket is legacy only. Keep old buckets readable
until rollback windows and global legacy retirement gates close, but do not use
them for new writes.

Current evidence object layout:

```txt
quarantine/orgs/{org_id}/companies/{company_id|_global}/{app}/{yyyy}/{mm}/{kind}/{asset_id}/{filename}
orgs/{org_id}/companies/{company_id|_global}/{app}/{yyyy}/{mm}/{kind}/{asset_id}/{filename}
```

Files enter the bucket under `quarantine/` and move to the final key only after completion verifies size and checksum metadata.

## Required Lifecycle

1. App requests an upload intent from `@hasna/files` through an explicit
   low-level SDK/REST transport, or uses the one-shot upload API.
2. `@hasna/files` creates a `file_asset` and `file_upload_intent`.
3. The byte client uses the destination internally and never copies it into an
   ordinary command/tool result, log, error, receipt, or persisted metadata.
4. `@hasna/files` completes the upload by verifying the object metadata.
5. Verified assets may be linked to app records.
6. Downloads are signed through `@hasna/files` and recorded in `file_access_events`.

## Local Mode

Local filesystem storage is allowed for development, tests, offline, and self-hosted deployments. Hosted apps should use their configured bucket through this package.

## Environment

Repo-level object storage aliases are preferred:

```bash
HASNA_FILES_S3_BUCKET=hasna-xyz-opensource-files-prod
HASNA_FILES_S3_PREFIX=objects
HASNA_FILES_AWS_REGION=us-east-1
HASNA_FILES_AWS_PROFILE=files-sync
HASNA_FILES_S3_ENDPOINT=
HASNA_FILES_S3_FORCE_PATH_STYLE=0
```

The existing `HASNA_FILES_EVIDENCE_*` variables remain compatible for apps that
already use evidence-specific configuration.

## Cloud Runtime Boundary

Storage status and metadata sync are intentionally separate from object-byte
mutation:

- SQLite is the local metadata index under the Hasna files data directory.
- PostgreSQL is the remote metadata store and is touched only by explicit
  storage migration or push/pull/sync commands.
- S3-compatible storage owns durable bytes for evidence assets, imported Drive
  objects, and S3 sources. Bytes move only through object APIs such as evidence
  upload completion, Drive import, S3 upload/download, copy, delete, and signed
  URL helpers.
- `files storage status` is diagnostic. It reports no-secret credential source
  diagnostics such as `aws_profile` or `default_provider_chain`, and it does not
  call S3 listing APIs, upload objects, apply migrations, or replace the local
  SQLite index. Credential readiness is reported as `not_checked` unless a
  separate mocked, dry-run, or approved live operation verifies it.

For hosted deployments, configure AWS credentials by named profile, environment
provider chain, or platform secret injection. Do not write raw access keys into
task comments, docs, logs, PRs, or public config. S3-compatible endpoints may
set `HASNA_FILES_S3_ENDPOINT` and `HASNA_FILES_S3_FORCE_PATH_STYLE`.
`files sources` does not persist static S3 access keys or session tokens.

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
- API clients accept HTTPS upload capabilities only for AWS S3 origins by
  default. Non-AWS S3-compatible endpoints must be explicitly allowlisted with
  `HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS` (comma-separated HTTPS origins); plain
  HTTP is accepted only for an explicitly listed loopback origin when
  `HASNA_FILES_EVIDENCE_ALLOW_INSECURE_LOOPBACK=1` is also set. Every accepted
  URL is bound to an approved bucket and the canonical
  `quarantine/<object_key>` path. An explicit
  `HASNA_FILES_EVIDENCE_UPLOAD_BUCKETS` allowlist is authoritative; otherwise
  the selected configured evidence bucket is used, and the built-in default is
  used only when neither is present. Redirects are rejected before bytes can be
  forwarded to another origin. Intent creation and expiry timestamps must also
  be fresh relative to the client request/response window, so a server cannot
  extend a requested capability lifetime with future-dated timestamps.
- Default CLI/MCP upload output is an opaque receipt containing asset, intent,
  checksum, and status identifiers only. Transport URLs and signing headers are
  available only inside the explicit low-level create-intent transport and must
  never be printed or logged; agents should use the one-shot upload operation.
- Transport errors are recursively copied into a sanitized error surrogate.
  Known-safe built-in and `HasnaHttpError` prototypes/status are preserved;
  unknown subclasses fall back to `Error.prototype` so inherited accessors
  cannot survive. The surrogate shadows executable serializers, string
  coercion, tags, and custom inspectors, and never returns the unsafe original,
  including when fields are immutable or accessor-backed. Both property names
  and values are redacted recursively; colliding redacted names receive stable
  numeric suffixes so fields cannot overwrite one another.
- Store access events for reads, downloads, signing, linking, and verification.
- Track scan status even when the current implementation marks local/S3 direct uploads as `skipped`.
- Track retention and legal hold metadata now so S3 Object Lock can be enabled without app schema changes.
