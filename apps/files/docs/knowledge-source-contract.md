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
open-files://source/{source_id}/path/{url_encoded_path}
```

Current `open-files://file/{file_id}` resolves to the active file record.
`revision_id` is reserved for the future file-version table and should point to
immutable bytes. `open-files://source/{source_id}/path/{path}` is useful for
manifests and reindex requests when the file id is not known yet.

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
   `s3://hasna-xyz-opensource-files-prod/objects/sha256/...`.
2. `open-files` writes manifest and extraction artifacts to a local directory or
   S3 job prefix.
3. `open-knowledge` can run locally or in a future SaaS worker, fetch only the
   manifest/extracted text it is allowed to read, and store knowledge artifacts
   in `.hasna/apps/knowledge` or its own configured S3 bucket.

Current CLI examples:

```bash
files sources add ~/Documents --name local-docs
files sources add s3://hasna-xyz-opensource-files-prod/imports/google-drive --region us-east-1 --aws-profile hasna-xyz-infra
files sources list --json
```

Future CLI/MCP examples:

```bash
files knowledge manifest --source <source_id> --jsonl --out manifest.jsonl
files knowledge resolve open-files://file/f_123 --purpose knowledge_index --json
files knowledge outbox --since <cursor> --json
```

These future commands should also be exposed as MCP tools so `knowledge
<prompt>` can ask for read-only source manifests and content resolution without
receiving write access to source files.

## Resolver Shape

The future read-only resolver consumed by knowledge agents should return a
manifest object, not raw storage credentials:

```json
{
  "source_ref": "open-files://file/f_123/revision/rev_456",
  "file_id": "f_123",
  "revision_id": "rev_456",
  "source_id": "src_abc",
  "storage": {
    "provider": "s3",
    "bucket": "hasna-xyz-opensource-files-prod",
    "key": "objects/sha256/aa/bb/<sha256>",
    "region": "us-east-1"
  },
  "content": {
    "mime": "text/markdown",
    "size": 12345,
    "hash": "sha256:<hex>",
    "text_available": true,
    "extracted_text_ref": "open-files://file/f_123/revision/rev_456/text"
  },
  "permissions": {
    "mode": "read_only",
    "allowed_purposes": ["knowledge_index", "knowledge_answer"]
  },
  "updated_at": "2026-06-08T00:00:00.000Z",
  "deleted": false
}
```

Knowledge can use this to decide whether to fetch bytes, fetch extracted text,
or skip/reindex a stale chunk. The resolver must enforce access before any S3
or local path is revealed to an agent.

## Manifest Export

`open-files` should provide a paginated export for `open-knowledge`:

```json
{
  "cursor": "next-cursor",
  "items": [
    {
      "source_ref": "open-files://file/f_123",
      "file_id": "f_123",
      "source_id": "src_abc",
      "path": "Team Drive/Notes/Q2 plan.md",
      "name": "Q2 plan.md",
      "mime": "text/markdown",
      "size": 12345,
      "hash": "sha256:<hex>",
      "status": "active",
      "updated_at": "2026-06-08T00:00:00.000Z"
    }
  ]
}
```

The export should support filtering by source, status, modified range, and
`sync_version` so knowledge indexing can resume without a full scan.

## Change Outbox

For scalable reindexing, `open-files` should emit an append-only outbox when a
file is created, changed, moved, deleted, restored, or permission-changed. The
event payload should include `source_ref`, `file_id`, previous/current revision
ids when available, status, hash, size, MIME type, and updated timestamp.

`open-knowledge` consumes this outbox to invalidate chunks and embeddings. It
does not need to watch every source directly.
