# S3 Object Storage Contract

The attachments object store follows the artifact-remote kit key layout
(hasna/apps#1631), first implemented by the skills app (hasna/apps#1639):

```txt
attachments/global/<sha256>[.<ext>]           content-addressed object (blob)
attachments/global/manifests/<id>.json        immutable per-attachment manifest
attachments/global/uploads/<id>               staging keys (pre-digest uploads, compat)
```

- `kind` = `attachments`, `owner` = `global`: `global` is a fixed structural
  segment (the store is single-tenant per deployment) so a bucket policy or
  lifecycle rule can key on it, and a future tenant split cannot collide keys.
- `<sha256>` is the lowercase hex digest of the bytes ACTUALLY stored — the
  ciphertext when an upload is encrypted. Encryption re-keys content, so a
  password-encrypted duplicate is a distinct object (correct).
- Duplicate uploads of identical bytes land on the SAME key: upload paths
  HEAD first and skip the PUT; a repeat PUT would in any case be an idempotent
  overwrite, never a second object.
- The manifest is written once per attachment row (id is the immutable
  identity) and carries `{ schema, app, kind, owner, id, sha256, byteSize,
  contentType, filename, createdAt, storageKey }`, so a bucket listing is
  restorable without the metadata database.
- S3 whole-object checksums: uploads that know the digest send it and the
  presigned PUT carries the checksum condition; completion verifies
  `HeadObject.ChecksumSHA256` against the row when both are present.

## Legacy keys (migration window)

Pre-alignment rows keep `attachments/YYYY-MM-DD/att_<id>/<random>[.<ext>]`
keys, including their sibling `.sha256` sidecar objects. Every read path
resolves the row's stored `s3Key` verbatim, so downloads, links, deletes and
verification all keep working with zero migration. `isLegacyObjectKey` /
`isStagingKey` / `isCanonicalKey` (src/core/artifact-keys.ts) classify stored
keys for tooling. The `.sha256` sidecar objects are retired: their role is
taken over by the row's `content_sha256` plus the S3 object checksum. Sidecar
objects still present in the bucket are inert and can be removed by the
operator together with the lifecycle rollout.

## Bucket configuration (operator infra — applied, never attempted in code)

This package ships no bucket name, no IAM, and executes no AWS calls beyond
the object operations it performs. The desired end state, carried as testable
constants in `src/core/bucket-config.ts` and applied as infrastructure change:

| Setting | Value |
| --- | --- |
| Versioning | Enabled (makes duplicate uploads observable as overwrites) |
| Lifecycle | Noncurrent versions → expire after 90 days |
| Lifecycle | Incomplete multipart uploads → abort after 7 days |
| Tags | `Class`, `Project`, `Component` on objects (billing/inventory) |
| Task-role grant | One inline policy per role, scoped to exactly one bucket ARN |

The legacy `hasna-oss-` bucket name predates the naming standard; S3 cannot
rename buckets, so the name is class-D grandfathered and a taxonomy-conformant
name is only adopted on the next bucket replacement.

## Environment

- `HASNA_ATTACHMENTS_S3_BUCKET` / `ATTACHMENTS_S3_BUCKET` — bucket (required
  for S3 backend; no default ships).
- `HASNA_ATTACHMENTS_S3_REGION`, `HASNA_ATTACHMENTS_AWS_PROFILE`,
  `HASNA_ATTACHMENTS_S3_ENDPOINT` (S3-compatible stores, with force-path-style
  support for tests/minio).
- Max upload size: `storage.maxSizeBytes` (default 10 GiB).