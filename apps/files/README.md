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

Build bounded agent context packs with citations instead of dumping full files:

```bash
files context-pack f_abc123 --max-total-chars 6000
files context-pack --source-ref open-files://source/src_abc/path/Notes%2Fbrief.md
files search-pack "supplier renewal" --max-files 5 --max-excerpts 12
files search-pack "loop receipt" --out ./context-pack.json --dry-run
```

Context packs print compact deterministic JSON with `attachment_refs`, `citations`,
bounded `excerpts`, and omitted counts. Secret-like values are redacted by
default; repeat `--redact <regex>` for local policy patterns. Use `--out` to
write the bounded pack as a local artifact and print a compact pointer.

## Google Drive Sync

Google Drive sync uses profiles configured through the connectors CLI:

```bash
connectors auth googledrive
```

Add or repair your S3 destination once. This stores the AWS named profile on
the source and sets it as the default Google Drive destination. This package
ships no default bucket or AWS profile — set `HASNA_FILES_S3_BUCKET` (and
optionally `HASNA_FILES_AWS_PROFILE`) or pass `--bucket`/`--aws-profile`
explicitly:

```bash
export HASNA_FILES_S3_BUCKET=<your-bucket>
files sources bootstrap-prod-files
files sources add-google-drive --all-profiles --all
files sources sync-google-drive --dry-run
files sources sync-google-drive
```

`bootstrap-prod-files` (aliased `bootstrap-prod-emails`) creates or updates a
single canonical S3 source at `s3://<bucket>/imports/google-drive/live/<profile>/...`
and sets it as the default Google Drive destination; new imports land under
`imports/google-drive/live/`. The `--aws-profile` flag defaults to the
standard AWS SDK `default` profile (or `HASNA_FILES_AWS_PROFILE` if set) —
never a hardcoded profile name. Operator-specific bucket names, legacy bucket
aliases, and migration runbooks are internal evidence and are not shipped in
the public package.

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

The MCP server also exposes read-only `build_context_pack` and
`search_context_pack` tools for bounded excerpts, citations, attachment refs,
and omitted counts in agent loops.

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

## SDK-Safe Path Helpers

Application runtimes that only need file-path normalization can import the
pure path subpath. It does not import the files database, CLI, server, MCP, or
cloud sync surfaces.

```ts
import {
  normalizeFolderPathSegments,
  normalizeSafeRelativePath,
  sanitizePathSegment,
} from "@hasna/files/path";

const folderSegments = normalizeFolderPathSegments("Reports/Q1", {
  fallback: "Downloads",
});
const sandboxPath = normalizeSafeRelativePath("src/index.ts");
const safeName = sanitizePathSegment("../report.pdf");
```

## SDK-Safe S3 Object Store

Application runtimes that need S3-compatible object storage can import the
pure S3 subpath. It does not import the files database, CLI, server, MCP, or
cloud sync surfaces; callers own tenant keys, billing, audit, and policy.

```ts
import { createS3ObjectStore } from "@hasna/files/s3";

const store = createS3ObjectStore({ region: "us-east-1" });
await store.putObject({
  bucket: "my-bucket",
  key: "orgs/org-1/files/report.txt",
  body: Buffer.from("hello"),
  contentType: "text/plain",
});
const buffer = await store.getObjectBodyBuffer({
  bucket: "my-bucket",
  key: "orgs/org-1/files/report.txt",
});
```

## REST API

```bash
files-serve
```

REST mutation, destructive, signed URL, download, import, and indexing routes
are also disabled by default. Use `OPEN_FILES_REST_ALLOW_<CAPABILITY>=1` or
`OPEN_FILES_ALLOW_<CAPABILITY>=1` for controlled operator sessions.

`files-serve` binds to `127.0.0.1` by default and does not emit wildcard CORS
headers. Browser requests are accepted only from the same origin or from exact
origins listed in `OPEN_FILES_REST_ALLOWED_ORIGINS` (comma-separated), for
example `OPEN_FILES_REST_ALLOWED_ORIGINS=http://localhost:5173`. Set
`OPEN_FILES_REST_HOST` only for explicit non-loopback operator deployments.

## Evidence Vault

`@hasna/files` can also serve as a shared evidence layer for other apps. Apps
store `file_asset_id` plus domain metadata; this package owns durable storage,
upload intents, checksum verification, quarantine promotion, signed downloads,
retention metadata, and access audit.

This package ships no default evidence bucket. Configure one via
`HASNA_FILES_S3_BUCKET` (or `HASNA_FILES_EVIDENCE_BUCKET`) and inspect the
effective configuration with:

```bash
export HASNA_FILES_S3_BUCKET=<your-bucket>
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
the shared cloud package. The cloud runtime has three separate boundaries:

- local index: SQLite remains the local metadata index and cache;
- remote metadata: PostgreSQL is updated only by explicit `storage migrate`,
  `storage push`, `storage pull`, or `storage sync` commands;
- object bytes: S3-compatible storage is used only by explicit S3, evidence,
  Google Drive import, upload, download, and signed URL APIs.

`files storage status` is diagnostic only. It does not contact AWS, mutate
PostgreSQL, migrate object bytes, or replace the local SQLite index.

```bash
export HASNA_FILES_STORAGE_MODE=hybrid
export HASNA_FILES_DATABASE_URL="$FILES_DATABASE_URL"
export HASNA_FILES_S3_BUCKET=<your-bucket>
export HASNA_FILES_S3_PREFIX=objects
export HASNA_FILES_AWS_REGION=us-east-1
export HASNA_FILES_AWS_PROFILE=files-sync
# Optional for S3-compatible stores such as MinIO/R2-compatible endpoints:
export HASNA_FILES_S3_ENDPOINT=https://s3-compatible.example.test
export HASNA_FILES_S3_FORCE_PATH_STYLE=1

files storage status
files storage push --tables machines,sources,files
files storage pull
files storage sync
```

`HASNA_FILES_STORAGE_MODE` accepts `local`, `hybrid`, or `remote`. The older
`HASNA_FILES_EVIDENCE_*` S3 settings are still supported for evidence uploads,
but `HASNA_FILES_S3_BUCKET`, `HASNA_FILES_S3_PREFIX`, `HASNA_FILES_AWS_REGION`,
`HASNA_FILES_AWS_PROFILE`, `HASNA_FILES_S3_ENDPOINT`, and
`HASNA_FILES_S3_FORCE_PATH_STYLE` are the canonical repo-level object storage
aliases. Status output reports credential source as a no-secret diagnostic
(`aws_profile` or `default_provider_chain`) and never prints credential values
or database URLs. It also reports credential checks as `not_checked`; readiness
requires an explicit mocked, dry-run, or approved live operation outside
`storage status`.

Do not store static S3 access keys in `files sources`. S3 source config accepts
named profiles, endpoints, and path-style settings only. Use platform secret
injection, AWS environment provider chain, or a named AWS profile for
credentials.

Migration plan for hosted runtime:

1. Run `files storage status --json` with only env-var names/profile names
   configured and verify `runtime.boundary` stays false for remote mutation and
   byte migration.
2. Apply PostgreSQL metadata migrations with `files storage migrate`; this
   changes schema only, not S3 bytes.
3. Push/pull metadata tables deliberately with `files storage push`, `pull`, or
   `sync`.
4. Move or create object bytes only through the S3/evidence/import APIs with
   mocked or approved credentials. Live bucket changes, production migrations,
   secret creation, deploys, or terraform changes require a separate approval
   task.

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
