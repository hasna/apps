import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createKnowledgeService } from '../src/service';

/**
 * Cloud (self_hosted / api) mode `inventory` must route through the cloud item
 * transport and report the shared corpus — NOT read the local db.json and NOT
 * open the local sqlite catalog (which would throw the local-catalog guard on a
 * flipped fleet machine that still has a leftover knowledge.db). This proves the
 * command routes to the cloud like every other item command.
 */
const now = new Date().toISOString();
const NOTES = [
  { id: 'k_one', short_id: 'one', title: 'Alpha', content: 'first', url: null, tags: ['a'], metadata: {}, archived: false, created_at: now, updated_at: now },
  { id: 'k_two', short_id: 'two', title: 'Beta', content: 'second', url: null, tags: ['b'], metadata: {}, archived: false, created_at: now, updated_at: now },
  { id: 'k_arch', short_id: 'arc', title: 'Gone', content: 'archived', url: null, tags: ['a'], metadata: {}, archived: true, created_at: now, updated_at: now },
];

let server: { port: number; stop: () => void };
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/v1/notes' && req.method === 'GET') {
        const includeArchived = url.searchParams.get('includeArchived') === 'true';
        const items = includeArchived ? NOTES : NOTES.filter((n) => !n.archived);
        return new Response(JSON.stringify({ items, total: items.length }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    },
  });
  for (const k of ['HASNA_KNOWLEDGE_API_URL', 'HASNA_KNOWLEDGE_API_KEY', 'HASNA_KNOWLEDGE_STORAGE_MODE']) savedEnv[k] = process.env[k];
  process.env.HASNA_KNOWLEDGE_API_URL = `http://127.0.0.1:${server.port}`;
  process.env.HASNA_KNOWLEDGE_API_KEY = 'k_fake_test_key';
  // Explicit, because presence of the URL + key no longer selects a backend.
  // The endpoint is 127.0.0.1, so the outbound guard permits these requests —
  // this test doubles as the positive control that hermetic cloud-mode traffic
  // still flows while the guard is armed.
  process.env.HASNA_KNOWLEDGE_STORAGE_MODE = 'cloud';
});

afterAll(() => {
  server.stop();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('cloud-mode inventory over the shared item corpus', () => {
  test('cloudInventory reports cloud items with empty local catalog sections', async () => {
    const service = createKnowledgeService({ scope: 'global' });
    const inv = await service.cloudInventory({});
    expect(inv.ok).toBe(true);
    // legacy_items is the total corpus (incl archived), matching local semantics;
    // the visible `items` list is active-only unless includeArchived is set.
    expect(inv.summary.legacy_items).toBe(3);
    expect(inv.summary.active_items).toBe(2);
    expect(inv.summary.archived_items).toBe(1);
    expect(inv.items.map((i) => i.id).sort()).toEqual(['k_one', 'k_two']);
    // The RAG catalog has no cloud counterpart — those sections are empty.
    expect(inv.sources).toEqual([]);
    expect(inv.chunks).toEqual([]);
    expect(inv.wiki_pages).toEqual([]);
    // The `paths` block reports the real on-box workspace layout and MUST agree
    // with the `paths` command even in cloud mode — it is NOT the item transport
    // location. The cloud source is surfaced via `legacy_store` instead.
    const paths = service.paths();
    expect(inv.paths.json_store_path).toBe(paths.json_store_path);
    expect(inv.paths.json_store_exists).toBe(paths.json_store_exists);
    expect(inv.paths.knowledge_db_path).toBe(paths.knowledge_db_path);
    expect(inv.paths.knowledge_db_exists).toBe(paths.knowledge_db_exists);
    expect(inv.paths.json_store_path).not.toContain('/v1');
    // The cloud transport URL is reported on legacy_store, not the paths block.
    expect(inv.legacy_store.path).toContain('/v1');
  });

  test('cloudInventory includes archived items when requested', async () => {
    const service = createKnowledgeService({ scope: 'global' });
    const inv = await service.cloudInventory({ includeArchived: true });
    expect(inv.summary.legacy_items).toBe(3);
    expect(inv.summary.archived_items).toBe(1);
    expect(inv.items.map((i) => i.id)).toContain('k_arch');
  });
});
