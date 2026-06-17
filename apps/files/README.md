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

Add or repair an S3 destination once. This stores an AWS named profile on the
source and sets it as the default Google Drive destination:

```bash
files sources add s3://example-files-bucket/google-drive --region us-east-1 --aws-profile files-sync
files sources add-google-drive --all-profiles --all
files sources sync-google-drive --dry-run
files sources sync-google-drive
```

For a custom S3 destination, pass your AWS profile explicitly:

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

## MCP Server

```bash
files-mcp
```

Includes file, source, Google Drive, project, collection, agent activity, and evidence-vault tools.

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

## Evidence Vault

`@hasna/files` is also the shared evidence layer for Hasna internal apps. Apps
store `file_asset_id` plus domain metadata; this package owns durable storage,
upload intents, checksum verification, quarantine promotion, signed downloads,
retention metadata, and access audit.

Evidence storage can be configured to use your own S3 bucket:

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

Files stores metadata locally in SQLite under the Hasna data directory. The repo includes its own S3 integrations and PostgreSQL migration definitions for remote deployments without depending on the shared cloud package.

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
