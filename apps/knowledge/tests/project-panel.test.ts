import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeProjectPanel } from '../src/project-panel';
import { createKnowledgeService } from '../src/service';
import { saveStore } from '../src/store';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.ts');

function seedStore(dir: string) {
  const service = createKnowledgeService({ scope: 'project', cwd: dir });
  service.paths();
  saveStore(service.jsonStorePath(), {
    items: [{
      id: 'k_swiss_bank_account',
      short_id: 'swissbank',
      title: 'Swiss Bank Account Checklist',
      content: `Passport, proof of funds, tax residency, and bank intake documents. ${'private details '.repeat(30)} SECRET_TAIL_DO_NOT_INCLUDE`,
      url: 'https://example.com/checklist',
      tags: ['swiss-bank-account', 'documents'],
      created_at: '2026-06-29T00:00:00.000Z',
      updated_at: '2026-06-29T00:01:00.000Z',
    }],
  });
  return service;
}

describe('knowledge project panel provider', () => {
  test('emits a contract-valid bounded panel without raw note bodies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-project-panel-'));
    const service = seedStore(dir);
    const source = join(dir, 'source.md');
    writeFileSync(source, 'Swiss banking source document with due diligence context.');
    await service.ingestSource(`file://${source}`, 'knowledge_index');

    const panel = createKnowledgeProjectPanel('Swiss Bank Account', { service, limit: 5 });

    expect(panel.schema).toBe('hasna.project_panel.v1');
    expect(panel.projectId).toBe('swiss-bank-account');
    expect(panel.provider.kind).toBe('knowledge');
    expect(panel.kind).toBe('knowledge');
    expect(panel.state).toBe('ready');
    expect(panel.items.length).toBeGreaterThanOrEqual(2);
    expect(panel.items[0].summary?.length).toBeLessThanOrEqual(180);
    expect(panel.items[0].summary).not.toContain('SECRET_TAIL_DO_NOT_INCLUDE');
    expect(panel.metrics.find((metric) => metric.id === 'active_items')?.value).toBe(1);
    expect(panel.metrics.find((metric) => metric.id === 'sources')?.value).toBe(1);
    expect(panel.resourceRefs.some((ref) => ref.uri === 'project://swiss-bank-account')).toBe(true);
  });

  test('CLI prints project-panel contract JSON for project scope', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-project-panel-cli-'));
    seedStore(dir);

    const result = spawnSync('bun', [CLI, 'project-panel', '--project', 'Swiss Bank Account', '--json', '--contract'], {
      cwd: dir,
      maxBuffer: 16 * 1024 * 1024,
    });

    expect(result.status).toBe(0);
    const panel = JSON.parse(result.stdout.toString());
    expect(panel.schema).toBe('hasna.project_panel.v1');
    expect(panel.projectId).toBe('swiss-bank-account');
    expect(panel.provider.kind).toBe('knowledge');
    expect(panel.metrics.some((metric: { id: string; value: number }) => metric.id === 'active_items' && metric.value === 1)).toBe(true);
  });
});
