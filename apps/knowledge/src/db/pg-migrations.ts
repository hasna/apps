export const PG_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    uri TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    title TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    acl_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS wiki_pages (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    artifact_uri TEXT,
    content_hash TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS source_revisions (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    revision TEXT NOT NULL,
    hash TEXT,
    extracted_text_uri TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(source_id, revision)
  )`,

  `CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
    wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    text TEXT NOT NULL,
    token_count INTEGER,
    start_offset INTEGER,
    end_offset INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS chunk_embeddings (
    id TEXT PRIMARY KEY,
    chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    vector_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(chunk_id, provider, model)
  )`,

  `CREATE TABLE IF NOT EXISTS wiki_backlinks (
    from_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    to_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    PRIMARY KEY(from_page_id, to_page_id)
  )`,

  `CREATE TABLE IF NOT EXISTS citations (
    id TEXT PRIMARY KEY,
    wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
    chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
    source_uri TEXT NOT NULL,
    quote TEXT,
    start_offset INTEGER,
    end_offset INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS knowledge_indexes (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    artifact_uri TEXT,
    shard_key TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(kind, name, shard_key)
  )`,

  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    prompt TEXT,
    status TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    cost_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    event TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS provider_usage (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS redaction_findings (
    id TEXT PRIMARY KEY,
    source_uri TEXT,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    severity TEXT NOT NULL,
    finding_type TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS storage_objects (
    id TEXT PRIMARY KEY,
    artifact_uri TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    content_type TEXT,
    hash TEXT,
    size_bytes INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    action TEXT NOT NULL,
    target_uri TEXT,
    decision TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS approval_gates (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    target_uri TEXT,
    status TEXT NOT NULL,
    reason TEXT,
    approved_by TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS vector_index_entries (
    id TEXT PRIMARY KEY,
    chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    vector_json TEXT NOT NULL,
    vector_norm DOUBLE PRECISION NOT NULL,
    source_uri TEXT,
    source_ref TEXT,
    revision TEXT,
    hash TEXT,
    start_offset INTEGER,
    end_offset INTEGER,
    token_count INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(chunk_id, provider, model)
  )`,

  `CREATE TABLE IF NOT EXISTS reindex_queue (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    source_uri TEXT,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(kind, target_id, reason)
  )`,

  `CREATE TABLE IF NOT EXISTS knowledge_machines (
    machine_id TEXT PRIMARY KEY,
    hostname TEXT,
    platform TEXT,
    user_label TEXT,
    workspace_home TEXT,
    tailscale_dns TEXT,
    tailscale_ips_json TEXT NOT NULL DEFAULT '[]',
    ssh_target TEXT,
    last_seen_at TEXT,
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS knowledge_sync_snapshots (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    workspace_home TEXT NOT NULL,
    sqlite_schema_version INTEGER NOT NULL,
    artifact_root_uri TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    tables_json TEXT NOT NULL,
    artifact_hashes_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS knowledge_sync_changes (
    id TEXT PRIMARY KEY,
    origin_machine_id TEXT NOT NULL,
    updated_by_machine_id TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    base_hash TEXT,
    next_hash TEXT,
    source_ref TEXT,
    source_revision_id TEXT,
    artifact_uri TEXT,
    logical_clock INTEGER NOT NULL DEFAULT 0,
    bundle_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `ALTER TABLE knowledge_sync_changes ADD COLUMN IF NOT EXISTS logical_clock INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE knowledge_sync_changes ADD COLUMN IF NOT EXISTS bundle_id TEXT`,

  `CREATE TABLE IF NOT EXISTS knowledge_sync_conflicts (
    id TEXT PRIMARY KEY,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    local_machine_id TEXT NOT NULL,
    remote_machine_id TEXT NOT NULL,
    local_hash TEXT,
    remote_hash TEXT,
    base_hash TEXT,
    status TEXT NOT NULL,
    resolution_strategy TEXT,
    proposed_patch_uri TEXT,
    approved_by TEXT,
    resolved_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS knowledge_sync_table_clocks (
    table_name TEXT NOT NULL,
    machine_id TEXT NOT NULL,
    logical_clock INTEGER NOT NULL DEFAULT 0,
    high_water_hash TEXT,
    high_water_bundle_id TEXT,
    origin_machine_id TEXT,
    updated_by_machine_id TEXT,
    last_applied_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    PRIMARY KEY(table_name, machine_id)
  )`,

  `CREATE TABLE IF NOT EXISTS knowledge_sync_imports (
    bundle_id TEXT PRIMARY KEY,
    source_machine_id TEXT NOT NULL,
    target_machine_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    status TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    table_clocks_json TEXT NOT NULL,
    tables_json TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  )`,

  `CREATE INDEX IF NOT EXISTS idx_source_revisions_source ON source_revisions(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_source_revision ON chunks(source_revision_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_wiki_page ON chunks(wiki_page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_citations_wiki_page ON citations(wiki_page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_citations_chunk ON citations(chunk_id)`,
  `CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_usage_run ON provider_usage(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_uri)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_gates_action ON approval_gates(action)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_gates_status ON approval_gates(status)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_provider_model ON vector_index_entries(provider, model)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_source_revision ON vector_index_entries(source_revision_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_source_uri ON vector_index_entries(source_uri)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_status ON vector_index_entries(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_status ON reindex_queue(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_kind_target ON reindex_queue(kind, target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_source_uri ON reindex_queue(source_uri)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_machines_last_seen ON knowledge_machines(last_seen_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_snapshots_machine_created ON knowledge_sync_snapshots(machine_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_snapshots_hash ON knowledge_sync_snapshots(content_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_entity ON knowledge_sync_changes(entity_kind, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_origin ON knowledge_sync_changes(origin_machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_created ON knowledge_sync_changes(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_bundle ON knowledge_sync_changes(bundle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_clock ON knowledge_sync_changes(entity_kind, logical_clock)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON knowledge_sync_conflicts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON knowledge_sync_conflicts(entity_kind, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_machine ON knowledge_sync_table_clocks(machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_updated ON knowledge_sync_table_clocks(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_imports_source ON knowledge_sync_imports(source_machine_id, applied_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_imports_target ON knowledge_sync_imports(target_machine_id, applied_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_imports_status ON knowledge_sync_imports(status)`,

  // Knowledge catalog items (the CLI add/list/get catalog). In local mode this
  // catalog lives in the JSON store (db.json); in cloud mode (PURE REMOTE,
  // Amendment A1) it is durable here. Kept faithful to the KnowledgeItem shape.
  `CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY,
    short_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    url TEXT,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_short_id ON knowledge_items(short_id)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_archived ON knowledge_items(archived)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_created ON knowledge_items(created_at)`,

  // --- Full-text search parity (search overhaul, Stage 2) ---------------------
  // The cloud notes list previously matched with `title/content ILIKE '%q%'`
  // and ordered by `created_at DESC` — a substring/recency path that misses
  // word-order/multi-term queries (returning near-empty results) and never
  // ranks by relevance. Add a weighted tsvector generated column (title = A,
  // content = B) plus a GIN index so the serve layer can use
  // websearch_to_tsquery + ts_rank_cd, matching the local SQLite FTS behavior.
  //
  // APPEND-ONLY: PG migration ids are derived from array index
  // (`knowledge_pg_${index+1}`), so these must stay at the end of the array —
  // never inserted mid-array — or every following id/checksum shifts and the
  // ledger drift-guard trips. Both statements are idempotent.
  `ALTER TABLE knowledge_items
     ADD COLUMN IF NOT EXISTS search_vector tsvector
     GENERATED ALWAYS AS (
       setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
       setweight(to_tsvector('english', coalesce(content, '')), 'B')
     ) STORED`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_search_vector
     ON knowledge_items USING GIN (search_vector)`,

  // --- Entry versioning (R4) --------------------------------------------------
  // MEASURED 2026-07-28, before this shipped: an entry created over the hosted
  // API and edited twice had BOTH prior bodies unrecoverable. knowledge_items
  // carried no version column, there was no versions table, and PATCH was
  // last-writer-wins with no conflict detection — on a fleet running many agents
  // against one store. (Positive control that the absence was real and not a
  // reading error: this same file DOES define source_revisions above, with
  // UNIQUE(source_id, revision) and a hash column.)
  //
  // Shape follows source_revisions rather than inventing a second convention:
  // TEXT primary key, TEXT foreign key with ON DELETE CASCADE, a hash column, a
  // *_uri column for a body held outside Postgres, and UNIQUE(parent, revision).
  // Timestamps are TEXT like every other table here; a TIMESTAMPTZ column would
  // have needed a cast of the existing TEXT updated_at inside a BEFORE UPDATE
  // trigger, and a cast that throws on one badly-shaped legacy string would
  // abort a legitimate write. Range queries cast at read time instead.
  //
  // APPEND-ONLY: ids derive from array index, so these stay at the end.
  `ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,

  `CREATE TABLE IF NOT EXISTS knowledge_item_versions (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    tenant_id TEXT,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    body_uri TEXT,
    content_hash TEXT NOT NULL,
    content_bytes INTEGER NOT NULL,
    url TEXT,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    actor TEXT,
    reason TEXT,
    valid_from TEXT,
    valid_to TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    UNIQUE(item_id, version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_item_versions_item
     ON knowledge_item_versions(item_id, version DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_item_versions_hash
     ON knowledge_item_versions(content_hash)`,

  // WHY A TRIGGER AND NOT APPLICATION CODE — this is the load-bearing decision,
  // and it is settled by measurement rather than taste.
  //
  // open-mementos implements the same feature in TypeScript: updateMemory
  // snapshots into memory_versions and then bumps, while the merge branch of
  // createMemory bumps with NO snapshot. `mementos save` takes the second path,
  // which is the path every agent actually uses, so a memory sitting at version
  // 4 today returns "No previous versions" — zero retained bodies. The failure
  // was not a caller forgetting to call a helper; it was a SECOND WRITE PATH
  // INSIDE THE OWNING PACKAGE forgetting. Application-level discipline failed at
  // the layer that wrote the code.
  //
  // The writers of knowledge_items are already plural — the serve handler, the
  // upsert/import path, `ingest rules`, sync/outbox replay, a backfill script,
  // and a human at psql — and next month there will be another. A BEFORE UPDATE
  // trigger is the only place that sits below all of them, and it cannot be
  // bypassed by code that has not been written yet.
  //
  // Accepted trade-off: the bump is invisible in the TypeScript and the row the
  // database returns differs from the row the caller sent. That is why
  // tests/entry-versioning.test.ts writes via raw SQL, bypassing every
  // application path, and asserts the snapshot appeared anyway.
  //
  // Three details are each load-bearing:
  //   - THE NO-OP GUARD. Without it every idempotent re-upsert — what `ingest
  //     rules` and every sync replay do on each run — would manufacture a
  //     version and bury the real edits. History would become noise.
  //   - NULLIF on the GUCs. A transaction-local setting resets to the EMPTY
  //     STRING, not to unset, so on a pooled connection the write after an
  //     attributed one would otherwise record an actor that is present but
  //     blank — an attribution that reads as real and is not.
  //   - to_jsonb(OLD)->>'tenant_id' rather than OLD.tenant_id. This repo's
  //     knowledge_items has no tenant column; the deployed build's does. Reading
  //     it through jsonb yields NULL where the column is absent and the real
  //     value where it exists, so one migration is correct against both schemas.
  `CREATE OR REPLACE FUNCTION knowledge_items_version_snapshot()
   RETURNS TRIGGER AS $knowledge_item_version$
   BEGIN
     IF (OLD.title, OLD.content, OLD.url, OLD.tags, OLD.metadata, OLD.archived)
        IS NOT DISTINCT FROM
        (NEW.title, NEW.content, NEW.url, NEW.tags, NEW.metadata, NEW.archived) THEN
       -- No content-bearing change: no version, no snapshot. Pin the counter so
       -- a caller cannot move it on a write the trigger otherwise ignores.
       NEW.version := OLD.version;
       RETURN NEW;
     END IF;

     INSERT INTO knowledge_item_versions
       (id, item_id, tenant_id, version, title, content, content_hash, content_bytes,
        url, tags, metadata, archived, actor, reason, valid_from, valid_to)
     VALUES
       (gen_random_uuid()::text,
        OLD.id,
        to_jsonb(OLD)->>'tenant_id',
        OLD.version,
        OLD.title,
        OLD.content,
        encode(sha256(convert_to(coalesce(OLD.content, ''), 'UTF8')), 'hex'),
        octet_length(coalesce(OLD.content, '')),
        OLD.url,
        OLD.tags,
        OLD.metadata,
        OLD.archived,
        NULLIF(current_setting('hasna.actor', true), ''),
        NULLIF(current_setting('hasna.reason', true), ''),
        OLD.updated_at,
        to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

     -- The bump and the snapshot are ONE write. The counter advances by exactly
     -- one and only here, so a caller can neither skip it nor forge it.
     NEW.version := OLD.version + 1;

     -- updated_at is TEXT and the application fills it with toISOString(), so
     -- the trigger must write the SAME shape. NOW()::text renders as
     -- '2026-07-28 21:29:56.01+00'; space (0x20) sorts below 'T' (0x54), so a
     -- column carrying both formats orders every trigger-written row before
     -- every application-written one regardless of actual time, and valid_from
     -- (copied verbatim from the row below) would stop being comparable with
     -- valid_to. One format, no casts needed at read time.
     --
     -- Only stamped when the caller did NOT set it. Import, sync replay, and
     -- backfill carry a SOURCE timestamp and kept it before this trigger
     -- existed; silently replacing it would be a regression. A writer that says
     -- nothing still gets a truthful advance.
     IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
       NEW.updated_at := to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
     END IF;
     RETURN NEW;
   END
   $knowledge_item_version$ LANGUAGE plpgsql`,

  // Idempotent trigger creation as ONE statement. `CREATE OR REPLACE TRIGGER`
  // would be shorter but needs Postgres 14+, and a migration that silently
  // requires a newer server than the fleet runs is a deploy-time surprise.
  `DO $knowledge_item_version_trigger$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_knowledge_items_version'
          AND tgrelid = 'knowledge_items'::regclass
     ) THEN
       CREATE TRIGGER trg_knowledge_items_version
         BEFORE UPDATE ON knowledge_items
         FOR EACH ROW EXECUTE FUNCTION knowledge_items_version_snapshot();
     END IF;
   END
   $knowledge_item_version_trigger$`,

  // A trigger created normally does NOT fire while `session_replication_role =
  // replica`. That is not an exotic setting: it is what logical-replication
  // apply workers, `pg_restore --disable-triggers`, and AWS DMS set. MEASURED
  // against a plain trigger — the update lands, the prior body is destroyed, no
  // version row appears, AND the counter stays put, so `version` then actively
  // lies about the row. With the deployed source still unlocated (task
  // e0759534), any move of this data runs through one of those paths.
  //
  // ENABLE ALWAYS closes it. Idempotent, so re-running the migration is a no-op.
  //
  // What it does NOT close, stated rather than left implied: the table owner can
  // still `ALTER TABLE ... DISABLE TRIGGER`. Nothing a trigger can do defends
  // against its own owner; the service connects with a DML-only role, for which
  // both this and the replication role are already refused.
  `ALTER TABLE knowledge_items ENABLE ALWAYS TRIGGER trg_knowledge_items_version`,

  // Append-only, enforced rather than merely named. Nothing in this package
  // updates a retained version, so refusing it costs nothing and removes the one
  // way history can be edited in place instead of added to. MEASURED before
  // this: a plain application role could `UPDATE knowledge_item_versions SET
  // content = ...` and rewrite a snapshot silently.
  //
  // DELETE is deliberately NOT blocked: `knowledge_item_versions` cascades from
  // `knowledge_items`, and refusing it here would make `knowledge delete` fail
  // outright. History for a deleted entry therefore goes with the entry — the
  // S3 journal (task 7b80e498) is what survives that, and until it lands this
  // table is append-only for LIVE entries, not durable across deletion.
  `CREATE OR REPLACE FUNCTION knowledge_item_versions_append_only()
   RETURNS TRIGGER AS $knowledge_item_versions_append_only$
   BEGIN
     RAISE EXCEPTION 'knowledge_item_versions is append-only: version % of item % cannot be rewritten',
       OLD.version, OLD.item_id
       USING ERRCODE = 'restrict_violation';
   END
   $knowledge_item_versions_append_only$ LANGUAGE plpgsql`,

  `DO $knowledge_item_versions_guard$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_knowledge_item_versions_append_only'
          AND tgrelid = 'knowledge_item_versions'::regclass
     ) THEN
       CREATE TRIGGER trg_knowledge_item_versions_append_only
         BEFORE UPDATE ON knowledge_item_versions
         FOR EACH ROW EXECUTE FUNCTION knowledge_item_versions_append_only();
     END IF;
   END
   $knowledge_item_versions_guard$`,

  `ALTER TABLE knowledge_item_versions ENABLE ALWAYS TRIGGER trg_knowledge_item_versions_append_only`,
];
