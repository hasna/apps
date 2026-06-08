import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearKnowledgeAuth, knowledgeAuthStatus, normalizeKnowledgeApiOrigin } from '../src/auth';
import { normalizeRemoteKnowledgeRunContract, REMOTE_KNOWLEDGE_CONTRACT_VERSION } from '../src/remote-client';
import { createKnowledgeService } from '../src/service';

describe('hosted-aware config and remote contracts', () => {
  test('normalizes hosted setup without requiring a hosted account for local use', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hosted-config-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir });

    const setup = service.setup({
      mode: 'remote',
      apiUrl: 'https://knowledge.example.com/api/v1',
    });
    expect(setup.mode).toBe('hosted');
    expect(setup.api_url).toBe('https://knowledge.example.com');
    expect(setup.storage_type).toBe('local');
    expect(setup.canonical_hasna_xyz.active).toBe(false);
    expect(setup.next).toContain('open-knowledge auth login --api-key <key>');

    const config = JSON.parse(readFileSync(join(dir, '.hasna', 'apps', 'knowledge', 'config.json'), 'utf8'));
    expect(config.mode).toBe('hosted');
    expect(config.hosted.api_url).toBe('https://knowledge.example.com');

    const storage = service.storageContract();
    expect(storage.hosted).toMatchObject({
      enabled: true,
      api_url: 'https://knowledge.example.com',
      api_url_env: 'KNOWLEDGE_API_URL',
      api_key_env: 'KNOWLEDGE_API_KEY',
      requires_hosted_account_for_local_use: false,
    });

    const local = service.setup({ mode: 'local' });
    expect(local.mode).toBe('local');
    expect(service.config().mode).toBe('local');
  });

  test('can opt into canonical Hasna XYZ S3 artifact storage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hosted-canonical-storage-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir });

    const setup = service.setup({
      mode: 'hosted',
      canonicalHasnaXyz: true,
    });

    expect(setup.mode).toBe('hosted');
    expect(setup.storage_type).toBe('s3');
    expect(setup.artifact_uri_prefix).toBe('s3://hasna-xyz-opensource-knowledge-prod/.hasna/apps/knowledge/');
    expect(setup.canonical_hasna_xyz.active).toBe(true);

    const config = JSON.parse(readFileSync(join(dir, '.hasna', 'apps', 'knowledge', 'config.json'), 'utf8'));
    expect(config.storage).toMatchObject({
      type: 's3',
      artifacts_root: 'artifacts',
      s3: {
        bucket: 'hasna-xyz-opensource-knowledge-prod',
        prefix: '.hasna/apps/knowledge',
        region: 'us-east-1',
        profile: 'hasna-xyz-infra',
        server_side_encryption: 'AES256',
      },
    });

    const storage = service.storageContract();
    expect(storage.canonical_hasna_xyz.secrets.s3).toBe('hasna/xyz/opensource/knowledge/prod/s3');
    expect(storage.source_ownership.owner).toBe('open-files');
  });

  test('stores auth locally, lets env credentials win, and clears credentials', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hosted-auth-'));
    const authDir = join(dir, 'auth');
    const env = { HASNA_KNOWLEDGE_AUTH_DIR: authDir };
    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    service.setup({ mode: 'hosted', apiUrl: 'https://knowledge.example.com/api' });

    expect(knowledgeAuthStatus(service.config(), env).authenticated).toBe(false);
    const auth = service.saveAuth({
      apiKey: 'kh_test',
      email: 'agent@example.com',
      orgSlug: 'hasna',
      orgId: 'org_123',
      userId: 'user_123',
    }, env);
    expect(auth.api_url).toBe('https://knowledge.example.com');
    expect(existsSync(join(authDir, 'auth.json'))).toBe(true);

    const status = service.authStatus(env);
    expect(status).toMatchObject({
      authenticated: true,
      source: 'file',
      email: 'agent@example.com',
      org_slug: 'hasna',
      api_url: 'https://knowledge.example.com',
    });

    const envStatus = service.authStatus({ ...env, KNOWLEDGE_API_KEY: 'kh_env', KNOWLEDGE_API_URL: 'https://env.example.com/api/v1' });
    expect(envStatus).toMatchObject({
      authenticated: true,
      source: 'env',
      email: null,
      api_url: 'https://env.example.com',
    });

    expect(service.clearAuth(env)).toBe(true);
    expect(clearKnowledgeAuth(env)).toBe(false);
    expect(service.authStatus(env).authenticated).toBe(false);
  });

  test('exposes typed remote contracts and normalized run payloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-remote-contract-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    const contract = service.remoteContract();

    expect(contract.contract_version).toBe(REMOTE_KNOWLEDGE_CONTRACT_VERSION);
    expect(contract.endpoints.search).toBe('/api/v1/knowledge/search');
    expect(contract.capabilities).toContain('open-files-source-refs');
    expect(contract.source_contract).toMatchObject({
      owner: 'open-files',
      preferred_ref: 'open-files',
      raw_source_bytes_stored_in_open_knowledge: false,
    });
    expect(contract.artifact_contract.generated_only).toBe(true);

    const run = normalizeRemoteKnowledgeRunContract({
      id: 'run_remote',
      status: 'completed',
      output_preview: 'answer',
      citations: [{ source_uri: 'open-files://file/f_1' }],
      duration_ms: 12,
    }, { type: 'ask', prompt: 'What is known?' });
    expect(run).toMatchObject({
      contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
      id: 'run_remote',
      type: 'ask',
      status: 'completed',
      prompt: 'What is known?',
      duration_ms: 12,
    });

    expect(normalizeKnowledgeApiOrigin('https://knowledge.example.com/api/v1')).toBe('https://knowledge.example.com');
    expect(() => normalizeKnowledgeApiOrigin('ftp://knowledge.example.com')).toThrow('http or https');
  });
});
