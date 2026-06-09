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
];
