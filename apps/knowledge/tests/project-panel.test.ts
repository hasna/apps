import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeProjectPanel } from '../src/project-panel';
import { createKnowledgeService } from '../src/service';
import { saveStore, type KnowledgeItem } from '../src/store';
import { knowledgeTestEnv } from './preload';
import {
  KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
  createLocalKnowledgeProjectLinksAuthority,
  digestKnowledgeProjectLinksValue,
  type KnowledgeProjectLinksAuthority,
} from '../src/project-links';
import type { ItemStore } from '../src/item-store';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.ts');

const panelTempRoots: string[] = [];
const panelLocalAuthorities: KnowledgeProjectLinksAuthority[] = [];
const panelFixedNow = () => '2026-08-10T12:00:00.000Z';

afterAll(async () => {
  for (const authority of panelLocalAuthorities.splice(0)) await authority.close();
  for (const root of panelTempRoots) rmSync(root, { recursive: true, force: true });
});

function panelTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-project-panel-'));
  panelTempRoots.push(root);
  return root;
}

function panelItem(id: string, title: string, tags: string[] = []): KnowledgeItem {
  return {
    id,
    short_id: id.slice(0, 8),
    title,
    content: `${title} body`,
    url: null,
    tags,
    metadata: {},
    archived: false,
    created_at: panelFixedNow(),
    updated_at: panelFixedNow(),
    version: 1,
  };
}

function panelMapItemStore(items: Map<string, KnowledgeItem>): ItemStore {
  return {
    kind: 'local',
    location: 'test-map',
    exists: true,
    supportsVersions: false,
    async list() {
      return { items: [...items.values()], total: items.size, exists: true };
    },
    async listAll() {
      return { items: [...items.values()], total: items.size, exists: true };
    },
    async get(id) {
      return items.get(id) ?? null;
    },
    async create(input) {
      const created = panelItem(input.id ?? `k_${items.size + 1}`, input.title, input.tags);
      items.set(created.id, created);
      return created;
    },
    async update() {
      throw new Error('not used');
    },
    async delete() {
      throw new Error('not used');
    },
    async deleteMany() {
      throw new Error('not used');
    },
    async listVersions() {
      throw new Error('not used');
    },
    async getVersion() {
      throw new Error('not used');
    },
  };
}

async function panelRegistrationRequest(
  authority: KnowledgeProjectLinksAuthority,
  projectId: string,
  slug: string,
  name: string,
) {
  const capability = await authority.capability();
  return {
    operation_id: `op-register-${slug}`,
    step_id: `step-register-${slug}`,
    resource_kind: 'collection' as const,
    direction: 'forward' as const,
    authority_route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    target_selector: projectId,
    idempotency_key: `idem-register-${slug}`,
    request_digest: digestKnowledgeProjectLinksValue({
      action: 'register_collection',
      source_project_id: projectId,
      project_slug: slug,
      project_name: name,
      collection_slug: `${slug}-knowledge`,
      collection_name: `${name} Knowledge`,
      membership_rule: 'explicit_collection_binding',
    }),
    precondition_digest: digestKnowledgeProjectLinksValue({
      source_project_id: projectId,
      expected: 'absent_or_exact_match',
    }),
    project_id: projectId,
    project_slug: slug,
    project_name: name,
    desired: {
      collection_slug: `${slug}-knowledge`,
      collection_name: `${name} Knowledge`,
    },
  };
}

async function panelBindingRequest(
  authority: KnowledgeProjectLinksAuthority,
  collectionId: string,
  itemId: string,
  slug: string,
) {
  const capability = await authority.capability();
  return {
    operation_id: `op-bind-${slug}-${itemId}`,
    step_id: `step-bind-${slug}-${itemId}`,
    direction: 'forward' as const,
    authority_route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    idempotency_key: `idem-bind-${slug}-${itemId}`,
    request_digest: digestKnowledgeProjectLinksValue({
      action: 'bind_item',
      collection_id: collectionId,
      item_id: itemId,
    }),
    precondition_digest: digestKnowledgeProjectLinksValue({
      collection_id: collectionId,
      item_id: itemId,
      expected: 'unbound_or_exact_membership',
    }),
    collection_id: collectionId,
    item_id: itemId,
  };
}

function panelLocalAuthority(items = new Map<string, KnowledgeItem>()) {
  const root = panelTempRoot();
  const authority = createLocalKnowledgeProjectLinksAuthority({
    databasePath: join(root, 'knowledge.db'),
    itemStore: panelMapItemStore(items),
    options: {
      packageVersion: '9.9.9',
      authorityId: 'knowledge-test',
      tenantId: 'tenant-test',
      corpusId: 'corpus-test',
      now: panelFixedNow,
    },
  });
  panelLocalAuthorities.push(authority);
  return { root, items, authority };
}

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
  // surfaced through the HTTP API where the shared corpus carries such URLs. The panel
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
      env: knowledgeTestEnv(),
      maxBuffer: 16 * 1024 * 1024,
    });

    expect(result.status).toBe(0);
    const panel = JSON.parse(result.stdout.toString());
    expect(panel.schema).toBe('hasna.project_panel.v1');
    expect(panel.projectId).toBe('swiss-bank-account');
    expect(panel.provider.kind).toBe('knowledge');
    expect(panel.metrics.some((metric: { id: string; value: number }) => metric.id === 'active_items' && metric.value === 1)).toBe(true);
  });

  // Regression for the project-panel home-is-cwd-derived defect (BUG KNO-00030):
  // a project with a registered knowledge collection must surface ITS bound
  // items via the project-links authority, never the cwd-derived local store or
  // the global fallback. Before the fix, createKnowledgeProjectPanel ignored
  // the registered collection and showed the global inventory.
  test('surfaces the project\'s registered collection and bound items instead of the cwd-derived inventory', async () => {
    const boundA = panelItem('k_bound_alpha', 'Bound Alpha Item', ['alpha', 'convention']);
    const boundB = panelItem('k_bound_beta', 'Bound Beta Item', ['alpha']);
    const harness = panelLocalAuthority(new Map([
      [boundA.id, boundA],
      [boundB.id, boundB],
    ]));

    const registration = await harness.authority.registerCollection(
      await panelRegistrationRequest(harness.authority, 'wks_project_registered', 'registered', 'Registered Project'),
    );
    expect(registration.outcome).toBe('accepted');
    const collectionId = registration.collection_id!;

    for (const item of [boundA, boundB]) {
      const binding = await harness.authority.bindItem(
        await panelBindingRequest(harness.authority, collectionId, item.id, 'registered'),
      );
      expect(binding.outcome).toBe('accepted');
    }

    // Build a panel with the authority wired in. There is no local JSON store at
    // any cwd-derived path, so before the fix this fell back to the global
    // inventory (empty here) and never surfaced the bound items.
    const panel = await createKnowledgeProjectPanel('wks_project_registered', {
      projectLinksAuthority: harness.authority,
      limit: 10,
    });

    expect(panel.schema).toBe('hasna.project_panel.v1');
    expect(panel.projectId).toBe('wks-project-registered');
    expect(panel.state).toBe('ready');
    const titles = panel.items.map((item) => item.title);
    expect(titles).toContain('Bound Alpha Item');
    expect(titles).toContain('Bound Beta Item');
    expect(panel.metrics.find((metric) => metric.id === 'active_items')?.value).toBe(2);
    expect(panel.metadata).toMatchObject({
      project_links: 'registered',
      collection_id: collectionId,
      collection_slug: 'registered-knowledge',
    });
    // The panel home must be collection-derived, not a cwd-derived local path.
    expect(panel.metadata.home).toBe(`knowledge:collection:${collectionId}`);
    expect(panel.provider.externalId).toBe(`knowledge:collection:${collectionId}`);
  });

  // Negative control: an unregistered project with no authority still keeps the
  // legacy cwd-derived inventory path (the local store item is surfaced).
  test('falls back to the legacy inventory path when the project is not registered', async () => {
    const harness = panelLocalAuthority();
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-project-panel-unreg-'));
    panelTempRoots.push(dir);
    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    service.paths();
    saveStore(service.jsonStorePath(), {
      items: [panelItem('k_local_item', 'Local Unregistered Item', ['local'])],
    });

    const panel = await createKnowledgeProjectPanel('Unregistered Project', {
      service,
      projectLinksAuthority: harness.authority,
      limit: 10,
    });

    expect(panel.schema).toBe('hasna.project_panel.v1');
    expect(panel.state).toBe('ready');
    expect(panel.items.some((item) => item.title === 'Local Unregistered Item')).toBe(true);
    expect(panel.metadata.project_links).toBeUndefined();
  });
});
