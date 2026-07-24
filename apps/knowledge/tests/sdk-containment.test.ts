import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAppWikiScope,
  createKnowledgeClient,
  createKnowledgeProjectPanel,
} from '../src/index.ts';
import { KnowledgeContainmentError } from '../src/runtime-role.ts';

async function expectContained(call: () => unknown): Promise<void> {
  try {
    await Promise.resolve().then(call);
    throw new Error('expected containment');
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeContainmentError);
    expect((error as KnowledgeContainmentError).status).toBe(503);
  }
}

describe('SDK per-operation runtime revalidation', () => {
  test('a local client denies every representative I/O family after env flips hosted', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'knowledge-sdk-flip-'));
    const env: Record<string, string | undefined> = {};
    const client = createKnowledgeClient({ scope: 'project', cwd, env } as never);
    env.HASNA_KNOWLEDGE_STORAGE_MODE = 'hosted';
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      throw new Error('network tripwire');
    }) as unknown as typeof fetch;

    const operations: Array<() => unknown> = [
      () => client.paths(),
      () => client.inventory(),
      () => client.db.init(),
      () => client.storage.status(),
      () => client.sync.status(),
      () => client.sync.remotePeer({ machine: 'synthetic.invalid', peerWorkspace: '/synthetic' }),
      () => client.appWiki.notes.list(),
      () => client.search({ query: 'synthetic' }),
      () => client.retrieveContext({ query: 'synthetic' }),
      () => client.context.pack({ query: 'synthetic' }),
      () => client.providers.status({}),
      () => client.embeddings.status(),
      () => client.ingest.source('file:///synthetic', 'knowledge_index'),
      () => client.sources.resolve('file:///synthetic'),
      () => client.reindex.health(),
      () => client.ask('synthetic'),
      () => client.web.search({ query: 'synthetic' }),
      () => client.unstable_service.inventory(),
    ];

    try {
      for (const operation of operations) await expectContained(operation);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalls).toBe(0);
    expect(existsSync(join(cwd, '.hasna'))).toBe(false);
  });

  test('mutable env can flip to invalid partial intent and remains zero-I/O', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'knowledge-sdk-invalid-flip-'));
    const env: Record<string, string | undefined> = {};
    const client = createKnowledgeClient({ scope: 'project', cwd, env } as never);
    env.HASNA_KNOWLEDGE_API_KEY = 'synthetic-stage-a-key';

    await expectContained(() => client.inventory());
    expect(existsSync(join(cwd, '.hasna'))).toBe(false);
  });

  test('app-wiki scope revalidates after local-to-hosted transition', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'knowledge-app-wiki-flip-'));
    const env: Record<string, string | undefined> = {};
    const wiki = createAppWikiScope({ scope: 'project', cwd, env } as never);
    env.HASNA_KNOWLEDGE_API_URL = 'https://knowledge.invalid.test';

    await expectContained(() => wiki.notes.list());
    expect(existsSync(join(cwd, '.hasna'))).toBe(false);
  });

  test('project-panel revalidates an injected preexisting service', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'knowledge-project-panel-flip-'));
    const env: Record<string, string | undefined> = {};
    const client = createKnowledgeClient({ scope: 'project', cwd, env } as never);
    env.HASNA_KNOWLEDGE_STORAGE_MODE = 'hosted';

    await expectContained(() => createKnowledgeProjectPanel('synthetic-project', {
      service: client.unstable_service,
    }));
    expect(existsSync(join(cwd, '.hasna'))).toBe(false);
  });

  test('a local client re-reads role config and denies a later hosted flip', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'knowledge-sdk-config-flip-'));
    const client = createKnowledgeClient({ scope: 'project', cwd, env: {} } as never);
    const home = join(cwd, '.hasna', 'knowledge');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'config.json'), JSON.stringify({
      version: 1,
      mode: 'hosted',
      storage: { type: 'local', artifacts_root: 'artifacts' },
    }));

    await expectContained(() => client.inventory());
    expect(existsSync(join(home, 'db.json'))).toBe(false);
    expect(existsSync(join(home, 'knowledge.db'))).toBe(false);
  });
});
