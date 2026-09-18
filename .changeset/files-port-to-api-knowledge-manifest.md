---
"@hasna/files": minor
---

Serve the knowledge-source manifest from the authenticated Files `/v1` API.

`files knowledge manifest` and the MCP `export_knowledge_manifest` now use
`GET /v1/knowledge/manifest` when the hosted transport is selected. The service
assigns every manifest-visible file, tag, project, collection, revision,
extraction, and source mutation a transaction-serialized global change cursor.
It persists privacy-minimized immutable snapshots so pages remain pinned to one
high watermark even while later writes commit.

Hosted page and checkpoint cursors are signed, versioned, tenant-bound, and
query-bound. They use lossless decimal strings and are deliberately distinct
from local per-file `sync_version` cursors. Hosted `since_sync_version` is
refused; use the signed `since_cursor`. Filtered deltas are also refused until a
separate membership-exit tombstone contract exists, while filtered full
snapshots remain available.

Every hosted manifest read resolves the authenticated API key's tenant before
querying and applies that tenant to the watermark and immutable snapshot scan.
The hosted projection omits station identity, local/source paths, S3
bucket/prefix/region/object keys, and hashes derived from those coordinates.
Extraction is reported available only when a tenant-bound materialized
extraction matches the current revision; MIME capability alone is not evidence.
Current-revision partial extractions preserve the `partial` status while
remaining readable with an explicit extraction reference; stale-revision
partial rows remain unavailable.

OpenAPI now defines the complete query, success, item, cursor, and refusal
schemas, and the generated SDK returns the typed manifest contract. CLI and MCP
clients reject malformed or unattested 2xx responses. Existing local manifest
behavior, compact Files output, MCP profiles, canonical Files home, fresh
credential resolution, and `https://api.hasna.com/files` plus one
client-appended `/v1` remain unchanged.

`include_acl_summary` and `include_evidence_assets` continue to refuse rather
than fabricating empty data. Hosted S3 manifest artifacts remain unavailable;
a local `--out` / `output_local_path` artifact is still supported.
