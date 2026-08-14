import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getKnowledgeDbStats } from '../src/knowledge-db';
import { runKnowledgePrompt } from '../src/agent';
import { ingestSourceRef } from '../src/source-ingest';

describe('knowledge prompt agent', () => {
  test('builds citation drafts and records run ledger entries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-agent-'));
    const dbPath = join(dir, 'knowledge.db');
    const source = join(dir, 'source.md');
    writeFileSync(source, 'Prompt agent should cite company handbook evidence from open-files sources.');
    const sourceRef = `file://${source}`;
    await ingestSourceRef({ dbPath, sourceRef, purpose: 'knowledge_index' });

    const draft = await runKnowledgePrompt({
      dbPath,
      prompt: 'How should the agent cite company handbook evidence?',
      limit: 5,
    });
    expect(draft.generated).toBe(false);
    expect(draft.provider).toBe('local');
    expect(draft.answer).toContain('Found 1 relevant knowledge excerpt');
    expect(draft.citations[0].source_uri).toBe(sourceRef);
    expect(draft.proposed_wiki_updates[0].requires_approval).toBe(true);
    expect(draft.write_policy.durable_writes_performed).toBe(false);

    const fakeGenerated = await runKnowledgePrompt({
      dbPath,
      prompt: 'Generate a cited answer about handbook evidence',
      generate: true,
      fake: true,
      modelRef: 'openai:gpt-5-mini',
    });
    expect(fakeGenerated.generated).toBe(true);
    expect(fakeGenerated.provider).toBe('openai');
    expect(fakeGenerated.answer).toContain('Fake generated answer');

    const stats = getKnowledgeDbStats(dbPath);
    expect(stats.runs).toBe(2);
    expect(stats.run_events).toBeGreaterThanOrEqual(4);
  });
});
