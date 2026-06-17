# Knowledge Machine Sync Schema

This spec defines the local-first sync shape for `knowledge` across personal
machines such as `linux-node-b` and `linux-node-a`, plus future hosted/SaaS operation.

## Scope

`knowledge` owns the derived knowledge catalog, generated artifacts, search
state, wiki pages, run ledgers, and sync metadata under:

```text
.hasna/apps/knowledge/
```

`open-files` remains the source of truth for raw files, raw bytes, file
revisions, hashes, extraction records, and connector-owned source storage.
`knowledge` stores source refs, derived chunks, citations, embeddings, wiki
artifacts, and provenance rows. Sync must never turn `knowledge` into a raw
file bucket.

## Optional Machine Adapter

Machine discovery is an optional integration:

- `knowledge` uses the `KnowledgeMachinesAdapter` boundary in `auto` mode by
  default: `@hasna/machines/consumer` SDK, then installed `machines --json`
  CLI, then local OS identity and optional Tailscale status probing.
- The adapter also supports explicit `sdk`, `cli`, and `disabled` modes for
  installed-package smoke tests, hosted/SaaS wrappers, and offline operation.
- `@hasna/knowledge` must not import `@hasna/machines` as a required runtime
  dependency.
- Topology, preflight, route, and workspace outputs include adapter
  diagnostics with package, entrypoint, mode, implementation, contract version,
  availability, and error fields.

The shared shape is exposed through:

```bash
knowledge machines topology --scope project --json
```

and MCP:

```text
knowledge_machines_topology
knowledge://project/machines
```

The topology result is read-only. It does not sync data by itself.

Knowledge-aware sync state is exposed through:

```bash
knowledge sync status --scope project --json
knowledge sync snapshot --scope project --no-tailscale --json
knowledge sync machines --scope project --json
knowledge sync conflicts --scope project --json
knowledge sync dry-run --peer-workspace <repo-or-knowledge-home> --scope project --json
knowledge sync pull --peer-workspace <repo-or-knowledge-home> --scope project --json
knowledge sync push --peer-workspace <repo-or-knowledge-home> --scope project --json
knowledge sync dry-run --machine linux-node-a --peer-workspace <remote-repo> --scope project --json
```

and MCP:

```text
knowledge_sync_status
knowledge_sync_snapshot
knowledge_sync_conflicts
knowledge_sync_peer
knowledge://project/sync
```

`sync status` is read-only. `sync snapshot` writes registry/snapshot rows and
uses topology only to identify machines; it does not copy raw files or perform
a merge. Peer sync compares SQLite rows by table primary key, copies generated
artifacts tracked in `storage_objects`, normalizes per-machine local artifact
URIs, and writes conflict rows instead of overwriting divergent records.
With `--machine`, the CLI uses SSH and the remote `knowledge sync
export/import` bundle protocol, so remote machines need compatible published
CLI versions.

## Machine Registry

Future registry rows should be stored in SQLite locally and can be synced to
Postgres in hosted mode:

```text
knowledge_machines
  machine_id text primary key
  hostname text
  platform text
  user_label text
  workspace_home text
  tailscale_dns text
  tailscale_ips_json text
  ssh_target text
  last_seen_at text
  capabilities_json text
  metadata_json text
  created_at text
  updated_at text
```

`machine_id` should come from `open-machines` when available. Without it,
`knowledge` may use a stable local fallback, but fallback ids should be marked
as provisional in metadata.

## Sync Objects

Generated sync state should be structured records, not only Markdown files:

```text
knowledge_sync_snapshots
  id text primary key
  machine_id text not null
  scope text not null
  workspace_home text not null
  sqlite_schema_version integer not null
  artifact_root_uri text not null
  content_hash text not null
  tables_json text not null
  artifact_hashes_json text not null
  created_at text not null

knowledge_sync_changes
  id text primary key
  origin_machine_id text not null
  updated_by_machine_id text not null
  entity_kind text not null
  entity_id text not null
  operation text not null
  base_hash text
  next_hash text
  source_ref text
  source_revision_id text
  artifact_uri text
  logical_clock integer not null default 0
  bundle_id text
  metadata_json text not null
  created_at text not null

knowledge_sync_conflicts
  id text primary key
  entity_kind text not null
  entity_id text not null
  local_machine_id text not null
  remote_machine_id text not null
  local_hash text
  remote_hash text
  base_hash text
  status text not null
  resolution_strategy text
  proposed_patch_uri text
  approved_by text
  resolved_at text
  metadata_json text not null
  created_at text not null

knowledge_sync_table_clocks
  table_name text not null
  machine_id text not null
  logical_clock integer not null default 0
  high_water_hash text
  high_water_bundle_id text
  origin_machine_id text
  updated_by_machine_id text
  last_applied_at text
  metadata_json text not null
  created_at text not null
  updated_at text not null

knowledge_sync_imports
  bundle_id text primary key
  source_machine_id text not null
  target_machine_id text not null
  direction text not null
  status text not null
  content_hash text not null
  table_clocks_json text not null
  tables_json text not null
  generated_at text not null
  applied_at text not null
  metadata_json text not null
```

The ledger stores hashes, refs, proposed patches, per-table logical clocks, and
bundle replay records. Large generated objects live in the artifact store,
locally or in S3.

## Artifact Storage

Local mode stores generated artifacts under:

```text
.hasna/apps/knowledge/artifacts/
```

Cloud mode may store generated artifacts under an S3-compatible prefix:

```text
s3://<bucket>/<prefix>/.hasna/apps/knowledge/
```

For example open-source knowledge, the canonical generated-artifact location
is:

```text
s3://example-knowledge-prod/.hasna/apps/knowledge/
```

Artifacts include wiki pages, index shards, schema docs, logs, run outputs, and
conflict proposals. Raw source bytes remain in `open-files`.

Private fleet setup uses the same ownership split. `open-machines` owns the
manifest semantics, `open-files` owns source refs to private manifests, and
`open-secrets` owns secret refs and secret values. `knowledge` can record
redacted decisions, citations, runbook summaries, and evidence hashes, but it
must not store private manifests, machine hostnames, serial numbers, sudo
passwords, VNC passwords, SSH private keys, GitHub App private keys, or secret
values.

## Dedupe Rules

Sync dedupe should compare:

- Source identity: `source_ref`, source URI, revision id, and hash.
- Generated artifact identity: artifact URI, artifact hash, kind, and title.
- Chunk identity: source revision id, ordinal, offsets, text hash, and kind.
- Wiki identity: page slug/path, title, cited sources, and artifact hash.
- Run identity: prompt hash, source refs, model/provider, and created time.

Exact duplicate rows can merge automatically. Conflicts must be recorded when
two machines changed the same durable entity from the same base hash.

Bundle imports are idempotent. A repeated bundle is skipped when the target
still matches the imported high-water hashes. If the target diverged after the
last import, replay falls through to normal row comparison so conflicts are
visible instead of silently ignored. Older incoming table clocks are skipped as
stale and never overwrite newer local durable records.

## Merge Rules

Safe automatic merges:

- New source refs, chunks, embeddings, runs, and audit rows from different ids.
- Identical hashes for the same source revision or generated artifact.
- Append-only logs with stable event ids.
- Vector rows whose model, dimensions, source revision, and chunk id match.

Conflict-producing merges:

- Same wiki path with different content hashes.
- Same source revision id with different hash.
- Same generated artifact URI with different hash.
- Same durable knowledge id edited on two machines from the same base.
- Any merge that would drop citations or downgrade read-only provenance.

AI SDK conflict resolution can propose a patch, summary, or merged Markdown
artifact, but durable writes remain approval-gated.

## Search And Index Sync

Semantic search state is derived but expensive. Local sync may copy vector rows
when provider/model/dimensions/source hash match, but must be able to rebuild
them from chunks and source refs.

Hosted mode may replace local JSON vectors with pgvector or managed vector
stores. CLI, SDK, and MCP should keep the same search/context result contracts.

## Acceptance Criteria

- `knowledge machines topology --json` works with and without `@hasna/machines`.
- CLI, SDK, and MCP expose the same read-only topology and sync-status shapes.
- Machine registry tables and sync ledgers are idempotent migrations.
- `knowledge sync snapshot --json` records machine registry rows, a snapshot
  content hash, durable table counts, generated artifact hashes, and table
  high-water clocks.
- `knowledge sync dry-run --peer-workspace <repo>` previews row/artifact
  movement without writing to either workspace.
- `knowledge sync push --peer-workspace <repo>` copies derived rows and
  generated artifacts to the peer and records conflicts instead of overwrites.
- `knowledge sync import` records bundle ids, content hashes, source/target
  machine ids, table clocks, and replay status.
- Duplicate, interrupted, and out-of-order imports do not overwrite newer local
  durable records and do not duplicate identical open conflict rows.
- Sync can pull/push SQLite catalog rows and generated artifacts without copying
  raw open-files bytes into knowledge.
- Conflict records are inspectable before approval.
- The same contract can run over LAN/Tailscale/SSH locally or a hosted API/S3
  backend later.
