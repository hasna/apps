# @hasna/files

Agent-first file management — index local folders and S3 buckets, sync Google Drive, tag, search, and retrieve files via CLI + MCP

[![npm](https://img.shields.io/npm/v/@hasna/files)](https://www.npmjs.com/package/@hasna/files)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
bun install -g @hasna/files
```

## CLI Usage

```bash
files --help
```

## Google Drive Sync

Google Drive sync uses profiles configured through the connectors CLI:

```bash
connectors auth googledrive
```

Add or repair the production S3 destination once. This stores the AWS named
profile on the source and sets it as the default Google Drive destination.
As of the 2026 storage migration cutover, the default bootstrap points new
Drive imports at the canonical open-files bucket:

```bash
files sources bootstrap-prod-files
files sources add-google-drive --all-profiles --all
files sources sync-google-drive --dry-run
files sources sync-google-drive
```

The canonical bootstrap destination is
`s3://hasna-xyz-opensource-files-prod/imports/google-drive/live/<profile>/...`
using the `hasna-xyz-infra` AWS profile. The previous production default pointed at
`s3://hasna-xyz-prod-emails/drive/<profile>/...` using the `hasna-xyz-infra`
AWS profile and remains a legacy compatibility alias only. The full Google
Drive archive found during the June 2026 audit is under
`s3://hasna-xyz-prod-files/google-drive/`.

The canonical target bucket for this repo is
`hasna-xyz-opensource-files-prod`; the verified canonical content-addressed
archive lives under `objects/sha256/`, while future Drive sync imports should
land under `imports/google-drive/live/`. Detailed S3, secrets, and RDS
migration runbooks are operator evidence and are not shipped in the public
package.

For a custom S3 destination, pass the shared AWS profile explicitly:

```bash
files sources add s3://my-files-bucket/google-drive --region us-east-1 --aws-profile files-sync
```

To sync into local storage instead, add a local source and pass it as the
destination:

```bash
files sources add ~/Files/google-drive-imports --name drive-local
files sources add-google-drive --profile personal --all --destination-source <local-source-id>
```

Synced files are indexed under the actual S3 or local destination source, so
`files download`, `files where`, and MCP file tools operate on the stored copy.

To organize the migrated Google Drive corpus into the unified open-files
taxonomy, run the policy command as a dry-run first:

```bash
files organize apply-drive-policy --json
files organize apply-drive-policy --apply
```

This updates review metadata only: owner, normalized virtual target path,
duplicate status, and broad additive permission metadata. Canonical S3 objects
stay under `objects/sha256/`, and legacy/import buckets stay readable until the
final retirement audit.

## MCP Server

```bash
files-mcp
```

Includes file, source, Google Drive, project, collection, agent activity, and
evidence-vault tools. Agent-facing mutation, destructive, import, signed URL,
download, and indexing tools fail closed unless explicitly enabled:

```bash
OPEN_FILES_MCP_ALLOW_MUTATIONS=1 files-mcp
OPEN_FILES_MCP_ALLOW_IMPORTS=1 files-mcp
OPEN_FILES_MCP_ALLOW_SIGNED_URLS=1 files-mcp
OPEN_FILES_MCP_ALLOW_DOWNLOADS=1 files-mcp
OPEN_FILES_MCP_ALLOW_INDEXING=1 files-mcp
OPEN_FILES_MCP_ALLOW_DESTRUCTIVE=1 files-mcp
```

`OPEN_FILES_ALLOW_<CAPABILITY>=1` or `OPEN_FILES_MCP_ALLOW_ALL=1` may be used
for controlled local operator sessions.

## HTTP mode

Run a shared Streamable HTTP MCP server (127.0.0.1 only):

```bash
files-mcp --http              # default port 8818
files-mcp --http --port 8818
MCP_HTTP=1 files-mcp
```

- Health: `GET http://127.0.0.1:8818/health`
- MCP: `POST http://127.0.0.1:8818/mcp`

Stdio remains the default when no `--http` flag is passed.

## REST API

```bash
files-serve
```

REST mutation, destructive, signed URL, download, import, and indexing routes
are also disabled by default. Use `OPEN_FILES_REST_ALLOW_<CAPABILITY>=1` or
`OPEN_FILES_ALLOW_<CAPABILITY>=1` for controlled operator sessions.

## Evidence Vault

`@hasna/files` is also the shared evidence layer for Hasna internal apps. Apps
store `file_asset_id` plus domain metadata; this package owns durable storage,
upload intents, checksum verification, quarantine promotion, signed downloads,
retention metadata, and access audit.

Production evidence storage defaults to the canonical
`hasna-xyz-opensource-files-prod` S3 bucket:

```bash
files evidence configure-prod
```

For local development and tests:

```bash
files evidence upload ./receipt.pdf \
  --org org_hasna \
  --company co_us \
  --app iapp-accounting \
  --kind receipt \
  --storage local \
  --local-root ./.tmp/evidence
```

The future web interface can use the REST endpoints under `/evidence/*`, and
agents can use the MCP tools such as `create_evidence_upload_intent`,
`upload_evidence_file`, `link_evidence_asset`, and `sign_evidence_download`.

See [docs/evidence-storage.md](docs/evidence-storage.md) for the storage
boundary and object layout.

## Storage

Files stores metadata locally in SQLite under the Hasna data directory. Remote
metadata sync uses this repo's PostgreSQL schema directly, without depending on
the shared cloud package.

```bash
export HASNA_FILES_STORAGE_MODE=hybrid
export HASNA_FILES_DATABASE_URL=postgres://user:pass@host:5432/files
export HASNA_FILES_S3_BUCKET=hasna-xyz-opensource-files-prod
export HASNA_FILES_S3_PREFIX=objects
export HASNA_FILES_AWS_REGION=us-east-1

files storage status
files storage push --tables machines,sources,files
files storage pull
files storage sync
```

`HASNA_FILES_STORAGE_MODE` accepts `local`, `hybrid`, or `remote`. The older
`HASNA_FILES_EVIDENCE_*` S3 settings are still supported for evidence uploads,
but `HASNA_FILES_S3_BUCKET`, `HASNA_FILES_S3_PREFIX`, `HASNA_FILES_AWS_REGION`,
and `HASNA_FILES_S3_ENDPOINT` are the canonical repo-level object storage
aliases.

## Knowledge Source Contract

`@hasna/files` is the source-of-truth file layer for `@hasna/knowledge`.
Knowledge stores derived chunks, embeddings, wiki pages, citations, and agent
logs; files owns original bytes, source sync state, file identity, revisions,
and read-only access. Stable refs use `open-files://file/<id>` and
`open-files://source/<id>/path/<path>`.

See [docs/knowledge-source-contract.md](docs/knowledge-source-contract.md) for
the URI, resolver, manifest export, and change outbox plan.

Private fleet manifests should be passed by source ref, not copied into public
packages or logs. Use `buildOpenFilesFleetManifestRef(sourceId, path)` and
`describeOpenFilesSourceRef(ref, { private: true })` when a caller needs a
public-safe descriptor.

## Data Directory

Data is stored in `~/.hasna/files/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
