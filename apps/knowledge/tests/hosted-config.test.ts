import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearKnowledgeAuth, knowledgeAuthStatus, normalizeKnowledgeApiOrigin } from '../src/auth';
import { createKnowledgeService } from '../src/service';

describe('hosted-aware config and remote contracts', () => {
  test('normalizes hosted setup without requiring a hosted account for local use', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hosted-config-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir });

    const setup = service.setup({
      // 'remote' is retired vocabulary; the setup axis is hosted | local.
      mode: 'hosted',
      apiUrl: 'https://knowledge.example.com/api/v1',
    });
    expect(setup.mode).toBe('hosted');
    expect(setup.api_url).toBe('https://knowledge.example.com');
    expect(setup.storage_type).toBe('local');
    expect(setup.canonical_example.active).toBe(false);
    expect(setup.next).toContain('knowledge auth login --api-key <key>');

    const config = JSON.parse(readFileSync(join(dir, '.hasna', 'knowledge', 'config.json'), 'utf8'));
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

  test('can opt into canonical example S3 artifact storage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hosted-canonical-storage-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir });

    const setup = service.setup({
      mode: 'hosted',
      canonicalExample: true,
    });

    expect(setup.mode).toBe('hosted');
    expect(setup.storage_type).toBe('s3');
    expect(setup.artifact_uri_prefix).toBe('s3://example-knowledge-prod/.hasna/knowledge/');
    expect(setup.canonical_example.active).toBe(true);

    const config = JSON.parse(readFileSync(join(dir, '.hasna', 'knowledge', 'config.json'), 'utf8'));
    expect(config.storage).toMatchObject({
      type: 's3',
      artifacts_root: 'artifacts',
      s3: {
        bucket: 'example-knowledge-prod',
        prefix: '.hasna/knowledge',
        region: 'us-east-1',
        profile: 'example-infra',
        server_side_encryption: 'AES256',
      },
    });

    const storage = service.storageContract();
    expect(storage.canonical_example.secrets.s3).toBe('example/knowledge/prod/s3');
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

  test('normalizes hosted api origins to the bare https origin', () => {
    expect(normalizeKnowledgeApiOrigin('https://knowledge.example.com/api/v1')).toBe('https://knowledge.example.com');
    expect(() => normalizeKnowledgeApiOrigin('ftp://knowledge.example.com')).toThrow('http or https');
  });
});
