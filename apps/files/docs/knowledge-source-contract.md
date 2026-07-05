# Open Knowledge Source Contract

`@hasna/files` is the source-of-truth file layer for `@hasna/knowledge`.
Knowledge may cite, chunk, summarize, embed, and index files, but it should not
own original bytes, storage credentials, source sync state, or file permissions.

## Boundary

`open-files` owns:

- source registration for local folders, S3 buckets, Google Drive imports, and
  future connector-backed sources;
- durable file identity, path, size, MIME type, hash, source metadata, deletion
  state, and machine/source ownership;
- byte retrieval, signed access, and future read-only content authorization;
- source revisions and change events that tell downstream indexes when to
  refresh.

`open-knowledge` owns:

- derived chunks, embeddings, lexical indexes, wiki pages, backlinks, agent run
  logs, citations, and provider usage;
- hybrid semantic search over knowledge chunks;
- AI-native workflows such as `knowledge <prompt>`, web search, model routing,
  and wiki maintenance.

## Stable URI Forms

These URI forms are stable and intended for storage in knowledge citations,
chunk provenance, manifests, and logs:

```txt
open-files://file/{file_id}
open-files://file/{file_id}/revision/{revision_id}
open-files://asset/{asset_id}
open-files://asset/{asset_id}/revision/{asset_revision_id}
open-files://source/{source_id}/path/{url_encoded_path}
```

Current `open-files://file/{file_id}` resolves to the active file record.
`open-files://file/{file_id}/revision/{revision_id}` resolves to a row in
`file_versions`, which records immutable storage identity for the bytes as they
were indexed or imported. `open-files://asset/{asset_id}` identifies private
evidence assets owned by `open-files`, such as fleet manifests or audit
artifacts. Asset revision refs are derived from immutable asset metadata
including checksum, size, scan status, storage descriptor, and update time; they
do not copy asset bytes into downstream indexes. `open-files://source/{source_id}/path/{path}` is useful
for manifests and reindex requests when the file id is not known yet.

Use the helper functions in `src/lib/source-ref.ts` to build and parse these
refs instead of string-concatenating them.

## Indexing Workflow

Local flow:

1. Add or sync sources through `open-files`.
2. Export a manifest from `open-files` with source refs, hashes, MIME types,
   deletion state, and extraction availability.
3. `open-knowledge` reads the manifest, resolves allowed content through
   read-only open-files APIs, and writes derived chunks/embeddings into
   `.hasna/apps/knowledge`.
4. Search and wiki answers cite `open-files://...` refs instead of copying file
   ownership into knowledge.
5. File changes emit outbox events that trigger chunk invalidation and
   reindexing in `open-knowledge`.

Remote flow:

1. `open-files` owns the S3 source or canonical object bucket, for example
   `s3://example-files-prod/objects/sha256/...`.
2. `open-files` keeps its local SQLite index as the local metadata cache. Remote
   PostgreSQL metadata is updated only through explicit storage migrate, push,
   pull, or sync commands.
3. `open-files` writes manifest and extraction artifacts to a local directory or
   S3 job prefix through explicit object APIs. Metadata sync does not move S3
   bytes or rewrite canonical object keys.
4. `open-knowledge` can run locally or in a future SaaS worker, fetch only the
   manifest/extracted text it is allowed to read, and store knowledge artifacts
   in a local app data directory or its own configured S3 bucket.

Example hosted paths:

```txt
open-files source bucket: s3://example-files-prod/objects/sha256/...
open-files secrets: secrets://files/prod/{env,aws,s3,rds}
open-knowledge artifact bucket: s3://example-knowledge-prod/artifacts/
open-knowledge secrets: secrets://knowledge/prod/{env,aws,s3}
```

The knowledge bucket is for generated artifacts only: chunk indexes, wiki
pages, run ledgers, schemas, exports, citations, and embedding metadata. It
must not become a second source-file bucket. Raw source bytes, immutable object
identity, extraction snapshots, S3 version metadata, and access enforcement stay
in `open-files`.

`files storage status --json` exposes this boundary under `runtime`: SQLite
local index, PostgreSQL remote metadata, S3/local object bytes, and booleans
stating that status and metadata sync do not mutate remote bytes or replace the
local index. The status payload reports credential source as no-secret
diagnostics only; consumers must not expect raw credentials in manifests or
resolver contracts. It does not verify S3 credential readiness; that remains
`not_checked` until a separate mocked, dry-run, or approved live operation
checks access. S3 source records persist named profiles, endpoints, and
path-style settings, not static access keys or session tokens.

For S3-backed bytes, `open-files` also owns `s3_objects`. That table stores the
canonical object identity and metadata used by future resolvers: bucket, region,
key, version id when present, ETag, SHA-256 checksum when present, size, content
type, storage class, encryption metadata, and optional org/company/project/app
scope. `file_versions.s3_object_id` links a revision to this object metadata
when a matching record exists. Knowledge consumers should receive source refs,
resolver contracts, extracted text refs, and object metadata needed for search,
not AWS credentials or writable object handles.

`extractTextFromFile`, `extractTextFromBuffer`, the `files extract-text` CLI
command, and the `extract_file_text` MCP tool return chunk-ready text for
supported text-like MIME types. The extraction contract includes status,
encoding, byte and character spans, line spans, markdown section hints when
available, truncation metadata, and redaction hooks. It is read-only and does
not create embeddings or write open-knowledge artifacts.

`extractTextSnapshotFromFile`, `extractTextSnapshotFromBuffer`,
`files extract-snapshot`, and the `extract_file_snapshot` MCP tool wrap the
extracted text into a deterministic semantic-chunking snapshot. The snapshot
adds a stable snapshot id, normalized SHA-256 content hash, pages, sections,
language/content hints, redaction state, and source/revision refs. It is still a
read-only contract; open-knowledge owns chunk storage, embeddings, and indexes.

Semantic search is split by ownership: `open-files` exports stable manifests,
extracted text snapshots, revision hashes, and outbox events; `open-knowledge`
stores chunks, embeddings, FTS/vector indexes, reranking metadata, and cited
wiki artifacts.

Current CLI examples:

```bash
files sources add ~/Documents --name local-docs
files sources add s3://example-files-prod/imports/google-drive --region us-east-1 --aws-profile files-sync
files sources list --json
```

Current CLI examples:

```bash
files knowledge manifest --source <source_id> --jsonl --out manifest.jsonl
files knowledge doctor open-files://file/f_123 --json
files knowledge resolve open-files://file/f_123 --purpose knowledge_index --json
files extract-text f_123 --json
files extract-snapshot f_123 --json
files knowledge outbox poll --consumer open-knowledge --json
files knowledge outbox ack open-knowledge <cursor> --json
```

Current MCP tools expose the same read-only surface:
`export_knowledge_manifest`, `doctor_knowledge_sources`,
`resolve_knowledge_source`, `resolve_extracted_text`, `poll_knowledge_outbox`, and
`ack_knowledge_outbox`. This lets `knowledge <prompt>` ask for read-only source
manifests and content resolution without receiving write access to source files.

The doctor is a read-only readiness diagnostic for agents before sync. It checks
refs through the same resolver contract used by manifests and returns stable
JSON issue codes for missing refs, stale revisions, restricted ACLs, deleted
rows, disabled sources, unsupported content, and missing extracted text support.
Recommendations are machine-readable (`reindex`, `source_review`, `fix_ref`,
`skip`, or `none`) and never include raw source bytes or credentials.

## Read-Only Resolver

`resolveKnowledgeSourceRef` in `src/lib/knowledge-resolver.ts` is the core
read-only resolver for knowledge agents. It accepts any stable `open-files://`
source ref and a requested mode:

- `metadata` for file/source/storage descriptors without reading bytes;
- `content` for bounded text-like byte reads;
- `extracted_text` for chunk-ready extracted text;
- `snapshot` for semantic chunking snapshots;
- `signed_url` for temporary read-only S3 access when the object is inside the
  scoped source bucket.

The resolver enforces source enablement, purpose allowlists, safe relative
source paths, byte limits, MIME allowlists, S3 bucket/key credential scope, and
read-only permissions. When an `agent_id` is supplied it writes an audit
`read` event containing resolver metadata only, not source content or secret
values. It has no write modes and does not create knowledge chunks, embeddings,
or artifacts.

The resolver returns a manifest object, not raw storage credentials:

```json
{
  "source_ref": "open-files://file/f_123/revision/rev_456",
  "file_id": "f_123",
  "revision_id": "rev_456",
  "source_id": "src_abc",
  "storage": {
    "provider": "s3",
    "bucket": "example-files-prod",
    "key": "objects/sha256/aa/bb/<sha256>",
    "region": "us-east-1"
  },
  "content": {
    "mime": "text/markdown",
    "size": 12345,
    "hash": "sha256:<hex>",
    "text_available": true,
    "extracted_text_ref": "open-files://file/f_123/revision/rev_456/text",
    "extraction": {
      "status": "ready",
      "extractor": "open-files-text-v1",
      "snapshot_id": "snap_abc"
    }
  },
  "permissions": {
    "mode": "read_only",
    "purpose": "knowledge_index",
    "requested_mode": "snapshot",
    "allowed_purposes": ["knowledge_index", "knowledge_answer", "agent_context"],
    "write": false
  },
  "updated_at": "2026-06-08T00:00:00.000Z",
  "deleted": false
}
```

Knowledge can use this to decide whether to fetch bytes, fetch extracted text,
or skip/reindex a stale chunk. The resolver must enforce access before any S3
or local path is revealed to an agent.

## Manifest Export

`exportKnowledgeSourceManifest` in `src/lib/knowledge-manifest.ts` provides the
core manifest export for `open-knowledge`. It supports file selection by source,
collection, tag, project, status, modified range, stable opaque cursor, and
sync-version delta cursor. It also supports optional evidence asset rows. Output
can be returned in memory, formatted as JSON or JSONL, or written as a local
artifact or to a configured S3 source for remote indexing jobs.

The manifest prefers revision refs when `file_versions` has a row for the
current file state:

```json
{
  "cursor": "next-cursor",
  "items": [
    {
      "source_ref": "open-files://file/f_123",
      "revision_ref": "open-files://file/f_123/revision/rev_456",
      "revision_id": "rev_456",
      "s3_object_id": "s3obj_abc",
      "sync_version": 42,
      "source_revision_hash": "sha256:<hex>",
      "file_id": "f_123",
      "source_id": "src_abc",
      "path": "Team Drive/Notes/Q2 plan.md",
      "name": "Q2 plan.md",
      "mime": "text/markdown",
      "size": 12345,
      "hash": "sha256:<hex>",
      "status": "active",
      "tombstone": false,
      "updated_at": "2026-06-08T00:00:00.000Z"
    }
  ]
}
```

Manifest paging uses a high watermark and `(sync_version, file_id)` cursor
rather than offset-only paging, so large-corpus scans have stable page
boundaries while files continue to change. Every manifest includes a
`delta_cursor` representing the current high watermark. Later calls can pass
that cursor as `since_cursor` with `delta: true` to export only changed rows.
Soft-deleted files are included as tombstones in delta mode.

Current manifest rows also include storage descriptors, extraction availability,
read-only permission labels, tags, deleted/tombstone state, source revision
hashes, sync versions, allowed-purpose metadata, and optional ACL summaries or
evidence asset storage/link metadata. Evidence asset rows include stable
`source_ref`, `revision_ref`, `revision_id`, `source_revision_hash`,
`permissions`, and `redaction` fields so downstream tools can cite private
evidence without receiving raw inventory bytes or writable storage handles. File rows include `open_files_root`
evidence with the stable `open-files://source/{source_id}` root, source type,
source path, machine id/host metadata, and local or S3 root descriptors such as
local source path or S3 bucket/prefix/region. The root evidence includes a
stable SHA-256 evidence hash and intentionally excludes source config values,
credentials, raw file bytes, embeddings, and writable handles. Manifest export
is metadata-only: it does not read source file bytes, create embeddings, or
write knowledge artifacts.

## Private Fleet Manifests

Private fleet manifests and machine evidence remain source assets owned by
`open-files`. Downstream `open-knowledge` and `open-machines` consumers should
ingest them through manifest rows filtered by evidence metadata, for example
`include_evidence_assets=true` with `app=machines` and `kind=fleet_manifest`.
The manifest row is metadata-only:

```json
{
  "kind": "evidence_asset",
  "source_ref": "open-files://asset/asset_fleet_manifest",
  "revision_ref": "open-files://asset/asset_fleet_manifest/revision/assetrev_abc123",
  "source_revision_hash": "sha256:<hex>",
  "app": "machines",
  "asset_kind": "fleet_manifest",
  "classification": "restricted",
  "storage": {
    "provider": "s3",
    "bucket": "hasna-xyz-opensource-files-prod",
    "key": "private/fleet/manifests/asset_fleet_manifest.json"
  },
  "redaction": {
    "status": "metadata_only",
    "raw_bytes_copied": false,
    "raw_text_copied": false,
    "private_inventory_copied": false,
    "secret_values_copied": false
  }
}
```

Consumer fixtures and docs must use fictional machine identifiers such as
`fictional-macbook-pro-01`. Real hostnames, serial numbers, asset tags, private
IP addresses, credentials, or raw fleet inventory payloads must stay in
`open-files` storage and may only be read through an approved read-only resolver.

## Knowledge Sync Fixtures

`src/lib/knowledge-sync-fixtures.ts` exports deterministic fixture manifests and
outbox JSONL for downstream `open-knowledge` tests. Use
`buildKnowledgeSyncFixturePack()` when a consumer needs a stable corpus that
covers duplicate content hashes, stale revisions, deleted source tombstones, ACL
revocation, extraction failures, and renamed paths. The fixture pack includes:

- `baseline_manifest_jsonl` with rows that should initially index into
  knowledge chunks;
- `outbox_jsonl` with `event_type` and `event` aliases for deletion,
  `revision_changed`, `acl_revoked`, `extraction_failed`, and moved-path
  invalidation;
- `current_manifest_jsonl` with the post-change manifest, including tombstones,
  restricted read-only permissions, extraction error metadata, and replacement
  current revisions.

Consumers should prove that stale, deleted, and ACL-revoked fixture content no
longer appears in source chunks, semantic retrieval results, or wiki citations
after outbox consumption. Catalog metadata may still exist for audit and
reindexing, but it must not expose raw source text or unauthorized chunks.

## Change Outbox

For scalable reindexing, `open-files` emits an append-only outbox in
`knowledge_source_outbox_events` and exposes it through
`src/db/knowledge-outbox.ts`. Events use a monotonic numeric `cursor` and can be
polled by cursor, consumer checkpoint, source, file, or event type. Consumers
acknowledge progress into `knowledge_source_outbox_checkpoints`, so
`open-knowledge` workers can process events idempotently and resume after a
restart.

Outbox event types include:

- `source_created`, `source_disabled`, `source_enabled`, and `source_updated`
  for source state;
- `indexed`, `updated`, `deleted`, `moved`, `hash_changed`,
  `revision_changed`, and `canonical_key_changed` for file/revision state;
- `permission_changed` and `acl_revoked` for organization/ACL review state;
- `extraction_ready`, `extraction_failed`, and `extraction_changed` for
  workflows that persist extraction status.

The event payload includes `source_ref`, `file_id`, `source_id`,
previous/current revision ids when available, status, hash, size, MIME type,
path, idempotency key, and metadata. File/source mutation paths emit compact
metadata only; source config values and file contents must not be copied into
outbox metadata.

`pollKnowledgeSourceOutbox` returns a watermark with the latest event cursor,
consumer checkpoint cursor when provided, and lag. `getKnowledgeSourceOutboxWatermark`
can be used independently by workers that only need source-change freshness.

`open-knowledge` consumes this outbox to invalidate chunks and embeddings. It
does not need to watch every source directly.
