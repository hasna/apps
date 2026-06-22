import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createKnowledgeAppBridge,
  resolveKnowledgeAppBackend,
  type KnowledgeAppRemoteClient,
} from '../src/app-bridge';
import {
  REMOTE_KNOWLEDGE_CONTRACT_VERSION,
  type RemoteKnowledgePromptRequest,
  type RemoteKnowledgeRunContract,
  type RemoteKnowledgeSearchRequest,
} from '../src/remote-client';

class FakeRemoteClient implements KnowledgeAppRemoteClient {
  readonly calls: Array<{ method: string; request: unknown }> = [];

  async search(request: RemoteKnowledgeSearchRequest): Promise<RemoteKnowledgeRunContract> {
    this.calls.push({ method: 'search', request });
    return {
      contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
      id: 'run_cloud_search',
      type: 'search',
      status: 'completed',
      query: String(request.query),
      output_preview: { results: 1 },
    };
  }

  async ask(request: RemoteKnowledgePromptRequest): Promise<RemoteKnowledgeRunContract> {
    this.calls.push({ method: 'ask', request });
    return {
      contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
      id: 'run_cloud_ask',
      type: 'ask',
      status: 'completed',
      query: String(request.query),
      prompt: String(request.prompt),
      output_preview: 'cloud answer',
    };
  }

  async build(request: RemoteKnowledgePromptRequest): Promise<RemoteKnowledgeRunContract> {
    this.calls.push({ method: 'build', request });
    return {
      contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
      id: 'run_cloud_build',
      type: 'build',
      status: 'completed',
    };
  }

  async sync(request?: Record<string, unknown>): Promise<RemoteKnowledgeRunContract> {
    this.calls.push({ method: 'sync', request });
    return {
      contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
      id: 'run_cloud_sync',
      type: 'sync',
      status: 'queued',
    };
  }
}

describe('knowledge macOS app bridge', () => {
  test('aggregates local dashboard state without hosted credentials', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-app-dashboard-'));
    const bridge = createKnowledgeAppBridge({
      scope: 'project',
      cwd: dir,
      env: { HASNA_KNOWLEDGE_AUTH_DIR: join(dir, 'auth') },
      generatedAt: () => new Date('2026-06-22T12:00:00.000Z'),
    });

    const dashboard = bridge.dashboard();

    expect(dashboard.generated_at).toBe('2026-06-22T12:00:00.000Z');
    expect(dashboard.workspace_home).toBe(join(dir, '.hasna', 'apps', 'knowledge'));
    expect(dashboard.local.mode).toBe('local');
    expect(dashboard.local.storage_type).toBe('local');
    expect(dashboard.cloud.authenticated).toBe(false);
    expect(dashboard.cloud.client_ready).toBe(false);
    expect(dashboard.sections.storage.ok).toBe(true);
    expect(dashboard.sections.db.ok).toBe(true);
    expect(dashboard.counts.sources).toBe(0);
  });

  test('selects local, cloud, or auto backend explicitly', () => {
    expect(resolveKnowledgeAppBackend({ preference: 'local', cloudReady: true })).toBe('local');
    expect(resolveKnowledgeAppBackend({ preference: 'auto', cloudReady: true })).toBe('cloud');
    expect(resolveKnowledgeAppBackend({ preference: 'auto', cloudReady: false })).toBe('local');
    expect(resolveKnowledgeAppBackend({ preference: 'cloud', cloudReady: true })).toBe('cloud');
    expect(() => resolveKnowledgeAppBackend({ preference: 'cloud', cloudReady: false })).toThrow('Cloud mode requires hosted credentials');
  });

  test('keeps dashboard available when hosted env configuration is malformed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-app-bad-cloud-'));
    const bridge = createKnowledgeAppBridge({
      scope: 'project',
      cwd: dir,
      env: {
        HASNA_KNOWLEDGE_AUTH_DIR: join(dir, 'auth'),
        KNOWLEDGE_API_KEY: 'kh_test',
        KNOWLEDGE_API_URL: 'not-url',
      },
    });

    const dashboard = bridge.dashboard();

    expect(dashboard.ok).toBe(true);
    expect(dashboard.cloud.client_ready).toBe(false);
    expect(dashboard.sections.auth.ok).toBe(false);
    expect(dashboard.sections.remote_client.ok).toBe(false);
    expect(dashboard.sections.remote_client.error).toContain('not-url');
    expect(dashboard.sections.storage.ok).toBe(true);
  });

  test('routes cloud search and ask through the remote knowledge contract', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-app-cloud-'));
    const remote = new FakeRemoteClient();
    const bridge = createKnowledgeAppBridge({
      scope: 'project',
      cwd: dir,
      remoteClient: remote,
      env: {
        KNOWLEDGE_API_KEY: 'kh_test',
        KNOWLEDGE_API_URL: 'https://knowledge.example.com/api/v1',
      },
    });

    const dashboard = bridge.dashboard();
    expect(dashboard.cloud.client_ready).toBe(true);
    expect(dashboard.cloud.authenticated).toBe(true);
    expect(dashboard.cloud.api_url).toBe('https://knowledge.example.com');

    const search = await bridge.search({
      mode: 'cloud',
      query: 'release policy',
      semantic: true,
      limit: 3,
    });
    expect(search.backend).toBe('cloud');
    expect(search.result).toMatchObject({ id: 'run_cloud_search', type: 'search', query: 'release policy' });

    const ask = await bridge.ask({
      mode: 'cloud',
      query: 'release policy',
      prompt: 'What is the release policy?',
      generate: true,
      limit: 2,
    });
    expect(ask.backend).toBe('cloud');
    expect(ask.result).toMatchObject({ id: 'run_cloud_ask', type: 'ask', prompt: 'What is the release policy?' });
    expect(remote.calls).toEqual([
      { method: 'search', request: { query: 'release policy', limit: 3, semantic: true } },
      {
        method: 'ask',
        request: {
          query: 'release policy',
          prompt: 'What is the release policy?',
          limit: 2,
          semantic: undefined,
          generate: true,
          approve_write: undefined,
        },
      },
    ]);
  });
});
