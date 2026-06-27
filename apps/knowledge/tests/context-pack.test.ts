import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildKnowledgeAgentContextPack } from '../src/context-pack';
import { migrateKnowledgeDb, openKnowledgeDb } from '../src/knowledge-db';
import { ingestOpenFilesManifestItems } from '../src/manifest-ingest';
import { ingestSourceRef } from '../src/source-ingest';
import { defaultKnowledgeConfig, workspaceForHome } from '../src/workspace';
import { resolveSafetyPolicy } from '../src/safety';

function safetyFor(home: string) {
  return resolveSafetyPolicy(defaultKnowledgeConfig(), workspaceForHome(home));
}

describe('bounded knowledge agent context packs', () => {
  test('builds compact cited search packs under token and item budgets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-context-pack-'));
    const dbPath = join(dir, 'knowledge.db');
    const source = join(dir, 'source.md');
    writeFileSync(source, 'Bounded agent context packs cite alpha launch decisions. token=sk-testsecretkeyvalue1234567890');
    const sourceRef = `file://${source}`;

    await ingestSourceRef({ dbPath, sourceRef, purpose: 'knowledge_index' });

    const pack = await buildKnowledgeAgentContextPack({
      dbPath,
      safetyPolicy: safetyFor(dir),
      source: 'search',
      query: 'alpha launch decisions',
      maxTokens: 1200,
      maxItems: 1,
      now: new Date('2026-06-26T00:00:00.000Z'),
    });

    expect(pack.format).toBe('knowledge-agent-context-pack');
    expect(pack.source).toBe('search');
    expect(pack.dry_run).toBe(true);
    expect(pack.safety.raw_artifact_content_included).toBe(false);
    expect(pack.budgets.items_included).toBeLessThanOrEqual(1);
    expect(pack.budgets.estimated_tokens).toBeLessThanOrEqual(pack.budgets.max_tokens);
    expect(pack.evidence[0].citation_ids.length).toBeGreaterThan(0);
    expect(JSON.stringify(pack)).not.toContain('sk-testsecretkeyvalue');
  });

  test('summarizes loop run evidence and duplicate candidates without raw artifacts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-loop-context-pack-'));
    const dbPath = join(dir, 'knowledge.db');
    migrateKnowledgeDb(dbPath);
    const db = openKnowledgeDb(dbPath);
    try {
      for (const id of ['run_loop_a', 'run_loop_b']) {
        db.run(
          `INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            'loop-proposal',
            'Bounded proposal context should assemble loop evidence for alpha rollout.',
            'completed',
            'local',
            'context-pack',
            JSON.stringify({
              loop_id: 'loop_alpha',
              artifact_uri: `file:///tmp/${id}.json`,
              task_id: 'task_alpha',
            }),
            '2026-06-25T00:00:00.000Z',
            '2026-06-25T00:00:00.000Z',
          ],
        );
      }
      db.run(
        `INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          'evt_loop_a',
          'run_loop_a',
          'info',
          'loop_evidence_recorded',
          JSON.stringify({ loop_id: 'loop_alpha', evidence_uri: 'knowledge://project/runs/run_loop_a' }),
          '2026-06-25T00:10:00.000Z',
        ],
      );
    } finally {
      db.close();
    }

    const pack = await buildKnowledgeAgentContextPack({
      dbPath,
      safetyPolicy: safetyFor(dir),
      source: 'loops',
      purpose: 'proposal',
      topic: 'bounded proposal alpha rollout',
      since: '7d',
      dedupe: true,
      maxTokens: 1500,
      maxItems: 5,
      now: new Date('2026-06-26T00:00:00.000Z'),
    });

    expect(pack.source).toBe('loops');
    expect(pack.purpose).toBe('proposal');
    expect(pack.evidence.some((entry) => entry.id === 'run:run_loop_a')).toBe(true);
    expect(pack.citations.some((citation) => citation.ref === 'file:///tmp/run_loop_a.json')).toBe(true);
    expect(pack.safety.raw_artifact_content_included).toBe(false);
    expect(pack.duplicate_candidates.length).toBeGreaterThan(0);
    expect(pack.budgets.estimated_tokens).toBeLessThanOrEqual(pack.budgets.max_tokens);
  });

  test('redacts search citation refs with secret-bearing URLs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-search-ref-redaction-pack-'));
    const dbPath = join(dir, 'knowledge.db');
    const safetyPolicy = safetyFor(dir);
    const secretUrl = 'https://evidence.example/doc?token=sk-testsecretkeyvalue1234567890&ok=1';

    await ingestOpenFilesManifestItems({
      dbPath,
      items: [{
        source_ref: secretUrl,
        name: 'Secret ref doc',
        mime: 'text/plain',
        status: 'active',
        extracted_text: 'search context packs should cite alpha launch evidence without leaking ref secrets.',
      }],
      sourceLabel: 'search-ref-redaction',
      safetyPolicy,
      now: new Date('2026-06-26T00:00:00.000Z'),
    });

    const pack = await buildKnowledgeAgentContextPack({
      dbPath,
      safetyPolicy,
      source: 'search',
      query: 'alpha launch evidence',
      maxTokens: 1200,
      maxItems: 1,
      now: new Date('2026-06-26T00:00:00.000Z'),
    });

    expect(JSON.stringify(pack)).not.toContain('sk-testsecretkeyvalue');
    expect(pack.citations[0]).toMatchObject({
      ref: 'https://evidence.example/doc',
      source_ref: 'https://evidence.example/doc',
      source_uri: 'https://evidence.example/doc',
    });
  });

  test('redacts run citation prompts and secret-bearing refs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-loop-redaction-pack-'));
    const dbPath = join(dir, 'knowledge.db');
    migrateKnowledgeDb(dbPath);
    const db = openKnowledgeDb(dbPath);
    try {
      db.run(
        `INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'run_secret_loop',
          'loop-proposal',
          'Secret loop prompt token=sk-testsecretkeyvalue1234567890 for beta rollout.',
          'completed',
          'local',
          'context-pack',
          JSON.stringify({
            loop_id: 'loop_secret',
            evidence_uri: 'https://evidence.example/run?token=sk-testsecretkeyvalue1234567890&ok=1',
          }),
          '2026-06-25T00:00:00.000Z',
          '2026-06-25T00:00:00.000Z',
        ],
      );
    } finally {
      db.close();
    }

    const pack = await buildKnowledgeAgentContextPack({
      dbPath,
      safetyPolicy: safetyFor(dir),
      source: 'loops',
      purpose: 'proposal',
      topic: 'beta rollout secret loop',
      maxTokens: 1500,
      now: new Date('2026-06-26T00:00:00.000Z'),
    });

    const serialized = JSON.stringify(pack);
    expect(serialized).not.toContain('sk-testsecretkeyvalue');
    expect(pack.citations[0].ref).toBe('https://evidence.example/run');
    expect(pack.citations[0].quote_preview).toContain('[REDACTED:secret_assignment]');
  });

  test('rejects impossible token budgets and empty proposal topics', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-context-pack-errors-'));
    const dbPath = join(dir, 'knowledge.db');
    migrateKnowledgeDb(dbPath);

    await expect(buildKnowledgeAgentContextPack({
      dbPath,
      safetyPolicy: safetyFor(dir),
      source: 'search',
      query: 'nothing',
      maxTokens: 160,
    })).rejects.toThrow('--max-tokens must be at least');

    await expect(buildKnowledgeAgentContextPack({
      dbPath,
      safetyPolicy: safetyFor(dir),
      source: 'loops',
      purpose: 'proposal',
      maxTokens: 1000,
    })).rejects.toThrow('Proposal context requires');
  });
});
