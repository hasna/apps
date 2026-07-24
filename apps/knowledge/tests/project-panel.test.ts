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

    const panel = await createKnowledgeProjectPanel('Swiss Bank Account', { service, limit: 5 });

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

  // Regression: a knowledge item whose `url` used a scheme outside the contract
  // allow-list (e.g. s3://) was copied verbatim into evidenceRefs[].uri, so
  // parseContract rejected the whole panel with a ContractValidationError. This
  // surfaced in cloud mode where the shared corpus carries such URLs. The panel
  // must now drop the unsupported URI from evidenceRefs and stay contract-valid.
  test('drops evidence URIs with unsupported schemes instead of failing validation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-project-panel-uri-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    service.paths();
    saveStore(service.jsonStorePath(), {
      items: [
        {
          id: 'k_bad_scheme',
          short_id: 'badscheme',
          title: 'Item with an unsupported URL scheme',
          content: 'Body content for the unsupported-scheme knowledge item.',
          url: 's3://internal-bucket/reports/2026/summary.json',
          tags: ['reports'],
          created_at: '2026-06-29T00:00:00.000Z',
          updated_at: '2026-06-29T00:01:00.000Z',
        },
        {
          id: 'k_good_scheme',
          short_id: 'goodscheme',
          title: 'Item with a supported URL scheme',
          content: 'Body content for the supported-scheme knowledge item.',
          url: 'https://example.com/report',
          tags: ['reports'],
          created_at: '2026-06-29T00:00:00.000Z',
          updated_at: '2026-06-29T00:01:00.000Z',
        },
      ],
    });

    // Would throw ContractValidationError before the fix.
    const panel = await createKnowledgeProjectPanel('reports', { service, limit: 10 });
    expect(panel.schema).toBe('hasna.project_panel.v1');

    const bad = panel.items.find((item) => item.id === 'item_k_bad_scheme');
    const good = panel.items.find((item) => item.id === 'item_k_good_scheme');
    expect(bad?.evidenceRefs.length).toBe(0);
    expect((bad?.metadata as { url?: string } | undefined)?.url).toBe('s3://internal-bucket/reports/2026/summary.json');
    expect(good?.evidenceRefs[0]?.uri).toBe('https://example.com/report');
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
