import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeKnowledgeSyncConflictResolutionWithAi } from '../src/conflict-agent';
import { migrateKnowledgeDb, openKnowledgeDb } from '../src/knowledge-db';
import { getKnowledgeSyncConflict, recordKnowledgeSyncConflict } from '../src/sync';

function createWikiConflict(options: { localRow?: boolean; remoteRow?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-conflict-agent-'));
  const dbPath = join(dir, 'knowledge.db');
  const pageId = 'page-1';
  migrateKnowledgeDb(dbPath);
  if (options.localRow) {
    const db = openKnowledgeDb(dbPath);
    try {
      db.query(`
        INSERT INTO wiki_pages (id, path, title, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        pageId,
        'wiki/page-1.md',
        'Local page',
        JSON.stringify({ source_ref: 'open-files://file/local-page' }),
        '2026-07-29T00:00:00.000Z',
        '2026-07-29T00:00:00.000Z',
      );
    } finally {
      db.close();
    }
  }
  const conflict = recordKnowledgeSyncConflict(dbPath, {
    entityKind: 'wiki_pages',
    entityId: `id=${JSON.stringify(pageId)}`,
    localMachineId: 'local-machine',
    remoteMachineId: 'remote-machine',
    localHash: 'sha256:local',
    remoteHash: 'sha256:remote',
    baseHash: 'sha256:base',
    metadata: options.remoteRow ? {
      remote_row: {
        id: pageId,
        path: 'wiki/page-1.md',
        title: 'Remote page',
        source_ref: 'open-files://file/remote-page',
      },
    } : {},
  });
  return { dbPath, conflict };
}

describe('conflict proposal agent', () => {
  test('builds and records a fake approval-gated manual merge from local and remote evidence', async () => {
    const { dbPath, conflict } = createWikiConflict({ localRow: true, remoteRow: true });

    const proposal = await proposeKnowledgeSyncConflictResolutionWithAi({
      dbPath,
      id: conflict.id,
      modelRef: 'anthropic:claude-sonnet-4-6',
      fake: true,
      now: new Date('2026-07-29T12:00:00.000Z'),
    });

    expect(proposal).toMatchObject({
      mode: 'ai',
      requires_approval: true,
      proposed_strategy: 'manual-merge',
      confidence: 0.5,
      proposed_patch: {
        kind: 'manual_merge',
        target: `wiki_pages:id=${JSON.stringify('page-1')}`,
        strategy: 'manual-merge',
        metadata: {
          fake: true,
          local_hash: 'sha256:local',
          remote_hash: 'sha256:remote',
        },
      },
      agent: {
        generated: true,
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      },
    });
    expect(proposal.proposed_patch?.diff).toContain('Local page');
    expect(proposal.proposed_patch?.diff).toContain('Remote page');
    expect(proposal.citations.map((citation) => citation.ref)).toContain('open-files://file/remote-page');
    expect(proposal.agent?.usage.input_tokens).toBeGreaterThan(0);
    expect(proposal.agent?.usage.output_tokens).toBeGreaterThan(0);
    expect(proposal.warnings).not.toContain('remote_row_snapshot_unavailable');
    expect(getKnowledgeSyncConflict(dbPath, conflict.id)?.status).toBe('open');

    const db = openKnowledgeDb(dbPath);
    try {
      const run = db.query<{
        status: string;
        provider: string;
        model: string;
        cost_tokens: number;
        metadata_json: string;
      }, []>('SELECT status, provider, model, cost_tokens, metadata_json FROM runs').get();
      expect(run).toMatchObject({
        status: 'dry_run',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      });
      expect(run?.cost_tokens).toBeGreaterThan(0);
      expect(JSON.parse(run?.metadata_json ?? '{}')).toMatchObject({
        conflict_id: conflict.id,
        fake: true,
        proposed_strategy: 'manual-merge',
      });
      expect(db.query<{ event: string }, []>('SELECT event FROM run_events ORDER BY rowid').all()).toEqual([
        { event: 'conflict_evidence_retrieved' },
        { event: 'fake_conflict_proposal_generated' },
      ]);
      expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM provider_usage').get()?.n).toBe(0);
    } finally {
      db.close();
    }
  });

  test('uses the limited-evidence fake strategy and reports a missing remote snapshot', async () => {
    const { dbPath, conflict } = createWikiConflict();

    const proposal = await proposeKnowledgeSyncConflictResolutionWithAi({
      dbPath,
      id: conflict.id,
      fake: true,
    });

    expect(proposal.proposed_patch).toMatchObject({
      kind: 'custom',
      strategy: 'review-and-select',
      diff: null,
    });
    expect(proposal.warnings).toContain('remote_row_snapshot_unavailable');
  });

  test('records a failed run and rethrows when provider credentials are missing', async () => {
    const { dbPath, conflict } = createWikiConflict({ remoteRow: true });

    await expect(proposeKnowledgeSyncConflictResolutionWithAi({
      dbPath,
      id: conflict.id,
      modelRef: 'openai:gpt-5-mini',
      env: {},
      now: new Date('2026-07-29T12:00:00.000Z'),
    })).rejects.toThrow('Missing OPENAI_API_KEY for openai');

    const db = openKnowledgeDb(dbPath);
    try {
      const run = db.query<{ status: string; cost_tokens: number; metadata_json: string }, []>(
        'SELECT status, cost_tokens, metadata_json FROM runs',
      ).get();
      expect(run?.status).toBe('failed');
      expect(run?.cost_tokens).toBeGreaterThan(0);
      expect(JSON.parse(run?.metadata_json ?? '{}')).toMatchObject({
        conflict_id: conflict.id,
        mode: 'ai',
        error: expect.stringContaining('Missing OPENAI_API_KEY'),
      });
      expect(db.query<{ event: string; level: string }, []>(
        'SELECT event, level FROM run_events ORDER BY rowid',
      ).all()).toEqual([
        { event: 'conflict_evidence_retrieved', level: 'info' },
        { event: 'conflict_proposal_generation_failed', level: 'error' },
      ]);
    } finally {
      db.close();
    }
  });

  test('rejects an unknown conflict without creating a run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-conflict-agent-missing-'));
    const dbPath = join(dir, 'knowledge.db');

    await expect(proposeKnowledgeSyncConflictResolutionWithAi({
      dbPath,
      id: 'missing-conflict',
      fake: true,
    })).rejects.toThrow('Sync conflict not found: missing-conflict');

    const db = openKnowledgeDb(dbPath);
    try {
      expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM runs').get()?.n).toBe(0);
    } finally {
      db.close();
    }
  });
});
