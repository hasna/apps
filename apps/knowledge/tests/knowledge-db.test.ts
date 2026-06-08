import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getKnowledgeDbStats, migrateKnowledgeDb, openKnowledgeDb } from '../src/knowledge-db';
import { ingestOpenFilesManifest } from '../src/manifest-ingest';
import { ingestSourceRef } from '../src/source-ingest';
import { consumeOpenFilesOutbox } from '../src/outbox-consume';
import { resolveOpenFilesSource } from '../src/source-resolver';
import { createApprovalGate, hasApproval, redactSecrets, resolveSafetyPolicy } from '../src/safety';
import { defaultKnowledgeConfig, workspaceForHome } from '../src/workspace';

describe('knowledge sqlite store', () => {
  test('migrates versioned schema and creates core catalog tables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-db-'));
    const dbPath = join(dir, 'knowledge.db');

    const migration = migrateKnowledgeDb(dbPath);
    expect(migration.schema_version).toBe(3);

    const db = openKnowledgeDb(dbPath);
    try {
      const tables = db.query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name",
      ).all().map((row) => row.name);
      expect(tables).toContain('sources');
      expect(tables).toContain('source_revisions');
      expect(tables).toContain('chunks');
      expect(tables).toContain('chunk_embeddings');
      expect(tables).toContain('wiki_pages');
      expect(tables).toContain('citations');
      expect(tables).toContain('knowledge_indexes');
      expect(tables).toContain('runs');
      expect(tables).toContain('provider_usage');
      expect(tables).toContain('redaction_findings');
      expect(tables).toContain('storage_objects');
      expect(tables).toContain('audit_events');
      expect(tables).toContain('approval_gates');
    } finally {
      db.close();
    }

    const stats = getKnowledgeDbStats(dbPath);
    expect(stats.schema_version).toBe(3);
    expect(stats.sources).toBe(0);
    expect(stats.runs).toBe(0);
    expect(stats.redaction_findings).toBe(0);
    expect(stats.audit_events).toBe(0);
    expect(stats.approval_gates).toBe(0);
  });

  test('ingests open-files manifests into sources, revisions, chunks, and FTS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-manifest-'));
    const dbPath = join(dir, 'knowledge.db');
    const manifestPath = join(dir, 'manifest.jsonl');
    const rows = [
      {
        source_ref: 'open-files://file/file_123/revision/rev_001',
        file_id: 'file_123',
        source_id: 'src_drive',
        path: 'Team Drive/Knowledge/Handbook.md',
        name: 'Handbook.md',
        mime: 'text/markdown',
        size: 128,
        hash: 'sha256:abc123',
        status: 'active',
        updated_at: '2026-06-08T00:00:00.000Z',
        permissions: { mode: 'read_only', allowed_purposes: ['knowledge_index'] },
        extracted_text: 'Company handbook\n\nSemantic search should find this source. token=sk-testsecretkeyvalue1234567890',
      },
      {
        source_ref: 'open-files://file/file_456',
        revision_id: 'rev_current',
        name: 'No text yet.pdf',
        mime: 'application/pdf',
        size: 256,
        hash: 'sha256:def456',
        status: 'active',
      },
    ];
    writeFileSync(manifestPath, rows.map((row) => JSON.stringify(row)).join('\n'));

    const result = await ingestOpenFilesManifest({ dbPath, input: manifestPath });
    expect(result).toMatchObject({
      items_seen: 2,
      sources_upserted: 2,
      revisions_upserted: 2,
      chunks_inserted: 1,
      chunks_deleted: 0,
    });

    const stats = getKnowledgeDbStats(dbPath);
    expect(stats.schema_version).toBe(3);
    expect(stats.sources).toBe(2);
    expect(stats.source_revisions).toBe(2);
    expect(stats.chunks).toBe(1);
    expect(stats.redaction_findings).toBeGreaterThanOrEqual(1);
    expect(stats.audit_events).toBeGreaterThanOrEqual(3);

    const resolved = await resolveOpenFilesSource({
      dbPath,
      sourceRef: 'open-files://file/file_123/revision/rev_001',
      purpose: 'knowledge_index',
      limit: 5,
    });
    expect(resolved.resolved).toBe(true);
    expect(resolved.read_only).toBe(true);
    expect(resolved.source?.uri).toBe('open-files://file/file_123');
    expect(resolved.revision?.revision).toBe('rev_001');
    expect(resolved.content.text_available).toBe(true);
    expect(resolved.content.bytes_exposed).toBe(false);
    expect(resolved.chunks).toHaveLength(1);
    expect(resolved.chunks[0].evidence).toMatchObject({
      resolver: 'open-files-read-only',
      mode: 'local_catalog',
      purpose: 'knowledge_index',
      read_only: true,
      source_uri: 'open-files://file/file_123',
      revision: 'rev_001',
    });
    expect(resolved.chunks[0].provenance).toMatchObject({
      source_owner: 'open-files',
      source_ref: 'open-files://file/file_123/revision/rev_001',
      source_uri: 'open-files://file/file_123',
      source_kind: 'open-files',
      revision: 'rev_001',
      hash: 'sha256:abc123',
      read_only: true,
      citation_required: true,
      stale: false,
    });
    expect(resolved.citations[0].evidence.chunk_id).toBe(resolved.chunks[0].id);
    expect(resolved.citations[0].provenance.chunk_id).toBe(resolved.chunks[0].id);
    const sourceIngest = await ingestSourceRef({
      dbPath,
      sourceRef: 'open-files://file/file_123/revision/rev_001',
      purpose: 'knowledge_index',
    });
    expect(sourceIngest.content_source).toBe('catalog_chunks');
    expect(sourceIngest.chunks_inserted).toBe(1);
    await expect(resolveOpenFilesSource({
      dbPath,
      sourceRef: 'open-files://file/file_123/revision/rev_001',
      purpose: 'knowledge_answer',
    })).rejects.toThrow('Allowed purposes: knowledge_index');

    migrateKnowledgeDb(dbPath);

    const db = openKnowledgeDb(dbPath);
    try {
      const source = db.query<{ uri: string; title: string; acl_json: string }, []>('SELECT uri, title, acl_json FROM sources ORDER BY title LIMIT 1').get();
      expect(source?.uri).toBe('open-files://file/file_123');
      expect(source?.title).toBe('Handbook.md');
      expect(JSON.parse(source?.acl_json ?? '{}')).toMatchObject({ mode: 'read_only' });

      const revision = db.query<{ revision: string; hash: string }, [string]>(
        'SELECT revision, hash FROM source_revisions WHERE hash = ?',
      ).get('sha256:abc123');
      expect(revision).toMatchObject({ revision: 'rev_001', hash: 'sha256:abc123' });

      const fts = db.query<{ chunk_id: string }, [string]>(
        'SELECT chunk_id FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT 1',
      ).get('semantic');
      expect(fts?.chunk_id).toStartWith('chk_');

      const chunk = db.query<{ text: string; metadata_json: string }, []>('SELECT text, metadata_json FROM chunks LIMIT 1').get();
      expect(chunk?.text).toContain('[REDACTED:secret_assignment]');
      expect(chunk?.text).not.toContain('sk-testsecretkeyvalue');
      expect(JSON.parse(chunk?.metadata_json ?? '{}').provenance).toMatchObject({
        source_owner: 'open-files',
        source_uri: 'open-files://file/file_123',
        revision: 'rev_001',
        hash: 'sha256:abc123',
      });

      const redactions = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM redaction_findings').get();
      expect(redactions?.n).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }
  });

  test('consumes open-files outbox events and invalidates chunks with a run ledger', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-outbox-'));
    const dbPath = join(dir, 'knowledge.db');
    const manifestPath = join(dir, 'manifest.jsonl');
    const outboxPath = join(dir, 'outbox.jsonl');
    writeFileSync(manifestPath, `${JSON.stringify({
      source_ref: 'open-files://file/file_789/revision/rev_before',
      file_id: 'file_789',
      source_id: 'src_drive',
      path: 'Team Drive/Knowledge/Policy.md',
      name: 'Policy.md',
      mime: 'text/markdown',
      size: 128,
      hash: 'sha256:before',
      status: 'active',
      permissions: { mode: 'read_only' },
      extracted_text: 'Policy text that should be invalidated by the outbox.',
    })}\n`);
    await ingestOpenFilesManifest({ dbPath, input: manifestPath });
    expect(getKnowledgeDbStats(dbPath).chunks).toBe(1);

    writeFileSync(outboxPath, `${JSON.stringify({
      event: 'deleted',
      source_ref: 'open-files://file/file_789/revision/rev_before',
      status: 'deleted',
      hash: 'sha256:before',
      updated_at: '2026-06-08T01:00:00.000Z',
      permissions: { mode: 'read_only', allowed_purposes: [] },
    })}\n`);

    const result = await consumeOpenFilesOutbox({ dbPath, input: outboxPath });
    expect(result.events_seen).toBe(1);
    expect(result.sources_touched).toBe(1);
    expect(result.revisions_touched).toBe(1);
    expect(result.chunks_deleted).toBe(1);
    expect(result.deleted_sources).toBe(1);
    expect(result.permission_updates).toBe(1);

    const stats = getKnowledgeDbStats(dbPath);
    expect(stats.chunks).toBe(0);
    expect(stats.runs).toBe(1);
    expect(stats.run_events).toBe(1);
    expect(stats.audit_events).toBeGreaterThanOrEqual(2);

    const db = openKnowledgeDb(dbPath);
    try {
      const fts = db.query<{ chunk_id: string }, [string]>(
        'SELECT chunk_id FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT 1',
      ).get('policy');
      expect(fts).toBeNull();

      const source = db.query<{ metadata_json: string; acl_json: string }, []>('SELECT metadata_json, acl_json FROM sources LIMIT 1').get();
      expect(JSON.parse(source?.metadata_json ?? '{}')).toMatchObject({
        status: 'deleted',
        last_outbox_event: 'deleted',
      });
      expect(JSON.parse(source?.acl_json ?? '{}')).toMatchObject({ allowed_purposes: [] });

      const usage = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM provider_usage').get();
      expect(usage?.n).toBe(1);
    } finally {
      db.close();
    }
  });

  test('ingests direct read-only file source refs with redaction and provenance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-source-ingest-'));
    const dbPath = join(dir, 'knowledge.db');
    const sourcePath = join(dir, 'source.md');
    writeFileSync(sourcePath, 'Direct file source for knowledge_index. token=sk-testsecretkeyvalue1234567890');

    const result = await ingestSourceRef({
      dbPath,
      sourceRef: `file://${sourcePath}`,
      purpose: 'knowledge_index',
    });
    expect(result.items_seen).toBe(1);
    expect(result.sources_upserted).toBe(1);
    expect(result.revisions_upserted).toBe(1);
    expect(result.chunks_inserted).toBe(1);
    expect(result.redactions).toBe(1);
    expect(result.content_source).toBe('file');
    expect(result.hash).toStartWith('sha256:');

    const resolved = await resolveOpenFilesSource({
      dbPath,
      sourceRef: `file://${sourcePath}`,
      purpose: 'knowledge_index',
    });
    expect(resolved.resolved).toBe(true);
    expect(resolved.source?.kind).toBe('file');
    expect(resolved.chunks[0].text).toContain('[REDACTED:secret_assignment]');
    expect(resolved.chunks[0].text).not.toContain('sk-testsecretkeyvalue');
    expect(resolved.chunks[0].evidence.source_uri).toBe(`file://${sourcePath}`);
    expect(resolved.chunks[0].provenance).toMatchObject({
      source_owner: 'open-files',
      source_uri: `file://${sourcePath}`,
      source_kind: 'file',
      read_only: true,
      citation_required: true,
    });
  });

  test('supports safety policy defaults and local approval gates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-safety-'));
    const dbPath = join(dir, 'knowledge.db');
    migrateKnowledgeDb(dbPath);
    const workspace = workspaceForHome(join(dir, '.hasna', 'apps', 'knowledge'));
    const policy = resolveSafetyPolicy(defaultKnowledgeConfig(), workspace);
    expect(policy.network.webSearchEnabled).toBe(false);
    expect(policy.network.s3ReadsEnabled).toBe(false);
    expect(policy.redaction.enabled).toBe(true);

    const redacted = redactSecrets('token=sk-testsecretkeyvalue1234567890');
    expect(redacted.text).toBe('[REDACTED:secret_assignment]');
    expect(redacted.findings).toHaveLength(1);

    const db = openKnowledgeDb(dbPath);
    try {
      expect(hasApproval(db, 'generated_write', 'wiki://answer')).toBe(false);
      createApprovalGate(db, {
        action: 'generated_write',
        target_uri: 'wiki://answer',
        reason: 'test approval',
      });
      expect(hasApproval(db, 'generated_write', 'wiki://answer')).toBe(true);
    } finally {
      db.close();
    }
  });
});
