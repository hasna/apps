# Evidence Storage Contract

`@hasna/files` is a shared durable file and evidence layer for apps.

## Boundary

Apps own domain meaning. `@hasna/files` owns bytes.

Apps should store `file_asset_id` plus domain metadata such as `company_id`, `source_type`, `source_id`, and `kind`. They should not own production bucket names, object keys, signed URL generation, retention behavior, or file access audit.

## Production Bucket

Use an app-owned S3 bucket for hosted deployments, for example `example-files-prod`.

Default object layout:

```txt
quarantine/orgs/{org_id}/companies/{company_id|_global}/{app}/{yyyy}/{mm}/{kind}/{asset_id}/{filename}
orgs/{org_id}/companies/{company_id|_global}/{app}/{yyyy}/{mm}/{kind}/{asset_id}/{filename}
```

Files enter the bucket under `quarantine/` and move to the final key only after completion verifies size and checksum metadata.

## Required Lifecycle

1. App requests an upload intent from `@hasna/files`.
2. `@hasna/files` creates a `file_asset` and `file_upload_intent`.
3. Client uploads to the returned destination.
4. `@hasna/files` completes the upload by verifying the object metadata.
5. Verified assets may be linked to app records.
6. Downloads are signed through `@hasna/files` and recorded in `file_access_events`.

## Local Mode

Local filesystem storage is allowed for development, tests, offline, and self-hosted deployments. Hosted apps should use their configured bucket through this package.

## Security Defaults

- Generate storage names; preserve original names only as metadata.
- Require checksum algorithm and checksum on every asset.
- Keep upload URLs short lived.
- Treat signed URLs as bearer tokens.
- Store access events for reads, downloads, signing, linking, and verification.
- Track scan status even when the current implementation marks local/S3 direct uploads as `skipped`.
- Track retention and legal hold metadata now so S3 Object Lock can be enabled without app schema changes.
