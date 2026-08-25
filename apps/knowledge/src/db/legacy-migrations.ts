/**
 * rc.6 tenancy schema program, byte-exact (O15-00684).
 *
 * The prod knowledge DB ledger (knowledge-prod, oss-fleet-prod) was written by the
 * pre-monorepo image @hasnaxyz/knowledge 1.0.0-rc.6 (deployed 2026-08-11), whose
 * apply-cloud-migrations.mjs applied these statements under
 * knowledge_tenancy_001..062 AFTER the api-key migrations. The current build does
 * not apply tenancy from its own schema program, but the ledger guard refuses
 * every deploy while these rows are unrecognized — and fresh installs need the
 * tenant columns for FCAME-1 guarded writes (the authority trigger requires
 * NEW.tenant_id). Defining the exact rc.6 statements under the same ids makes
 * the checksums match the applied rows (skipped on prod) and gives fresh
 * installs the same schema the fleet runs.
 *
 * APPEND-ONLY: these ids are pinned by tests/fixtures/legacy-ledger-checksums.json.
 * Edit nothing here in place; append new statements under new ids only.
 */
export const LEGACY_TENANCY_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS tenants (
    id            UUID PRIMARY KEY,
    slug          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'org',
    status        TEXT NOT NULL DEFAULT 'active',
    identity_id   TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL DEFAULT NOW()::text,
    updated_at    TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY,
    kind          TEXT NOT NULL DEFAULT 'human',
    email         TEXT,
    display_name  TEXT,
    identity_id   TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL DEFAULT NOW()::text,
    updated_at    TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'reader',
    scopes_json TEXT NOT NULL DEFAULT '[]',
    status     TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    PRIMARY KEY (tenant_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id)`,
  `INSERT INTO tenants (id, slug, name, kind, status)
    VALUES ('adfd95c7-ee8b-52cb-ae47-4ae65dae3313', 'hasna', 'Hasna Fleet', 'root', 'active')
    ON CONFLICT (id) DO NOTHING`,
  `ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE sources ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE source_revisions ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE chunks ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE chunk_embeddings ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE wiki_backlinks ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE citations ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE knowledge_indexes ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE runs ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE run_events ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE provider_usage ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE redaction_findings ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE storage_objects ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE approval_gates ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE vector_index_entries ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE reindex_queue ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS created_by_user_id UUID`,
  `ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'tenant'`,
  `ALTER TABLE sources ADD COLUMN IF NOT EXISTS created_by_user_id UUID`,
  `ALTER TABLE sources ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'tenant'`,
  `ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS created_by_user_id UUID`,
  `ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'tenant'`,
  `ALTER TABLE runs ADD COLUMN IF NOT EXISTS created_by_user_id UUID`,
  `ALTER TABLE runs ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'tenant'`,
  `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS tenant_id UUID`,
  `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id UUID`,
  `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS principal_type TEXT`,
  `CREATE INDEX IF NOT EXISTS api_keys_kid_idx ON api_keys(kid)`,
  `UPDATE knowledge_items SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE sources SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE wiki_pages SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE source_revisions SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE chunks SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE chunk_embeddings SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE wiki_backlinks SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE citations SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE knowledge_indexes SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE runs SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE run_events SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE provider_usage SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE redaction_findings SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE storage_objects SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE audit_events SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE approval_gates SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE vector_index_entries SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `UPDATE reindex_queue SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_tenant_created ON knowledge_items(tenant_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_tenant_archived ON knowledge_items(tenant_id, archived)`,
  `CREATE INDEX IF NOT EXISTS idx_sources_tenant ON sources(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_pages_tenant ON wiki_pages(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_tenant ON chunks(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_source_revisions_tenant ON source_revisions(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_tenant ON vector_index_entries(tenant_id, provider, model, status)`,
  `CREATE INDEX IF NOT EXISTS idx_storage_objects_tenant ON storage_objects(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_tenant ON runs(tenant_id)`,
];
