import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearKnowledgeAuth,
  knowledgeAuthStatus,
  normalizeKnowledgeApiOrigin,
  resolveKnowledgeApiUrl,
} from '../src/auth';
import { createKnowledgeService } from '../src/service';
import { defaultKnowledgeConfig, projectKnowledgeHome, writeKnowledgeConfig } from '../src/workspace';

describe('API environment and server contracts', () => {
  test('workspace setup persists neither a selector nor client API placement', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hosted-config-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-hosted-config-home-'));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    try {
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      const service = createKnowledgeService({ scope: 'project', cwd: dir });

      const setup = service.setup();
      expect(setup.storage_type).toBe('local');
      expect(setup.canonical_example.active).toBe(false);
      expect(setup.next).toContain('knowledge transport --json');

      const config = JSON.parse(readFileSync(join(projectKnowledgeHome(dir, home), 'config.json'), 'utf8'));
      expect(config.mode).toBeUndefined();
      expect(config.hosted).toBeUndefined();

      const storage = service.storageContract();
      expect((storage as unknown as Record<string, unknown>).hosted).toBeUndefined();
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('config writes scrub retired placement fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-config-scrub-'));
    const configPath = join(dir, 'config.json');
    writeKnowledgeConfig(configPath, {
      ...defaultKnowledgeConfig(),
      mode: 'hosted',
      hosted: { api_url: 'https://ignored.example.test' },
    } as never);
    const stored = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(stored.mode).toBeUndefined();
    expect(stored.hosted).toBeUndefined();
  });

  test('can opt into canonical example S3 artifact storage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hosted-canonical-storage-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-hosted-canonical-storage-home-'));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    try {
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      const service = createKnowledgeService({ scope: 'project', cwd: dir });

      const setup = service.setup({
        canonicalExample: true,
      });

      expect(setup.storage_type).toBe('s3');
      expect(setup.artifact_uri_prefix).toBe('s3://example-knowledge-prod/.hasna/knowledge/');
      expect(setup.canonical_example.active).toBe(true);

      const config = JSON.parse(readFileSync(join(projectKnowledgeHome(dir, home), 'config.json'), 'utf8'));
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
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('stores auth locally, lets env credentials win, and clears credentials', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hosted-auth-'));
    const authDir = join(dir, 'auth');
    const env = { HASNA_KNOWLEDGE_AUTH_DIR: authDir };
    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    service.setup();

    expect(knowledgeAuthStatus(env).authenticated).toBe(false);
    const auth = service.saveAuth({
      apiKey: 'kh_test',
      apiUrl: 'https://knowledge.example.com/api',
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

    const envStatus = service.authStatus({ ...env, HASNA_KNOWLEDGE_API_KEY: 'kh_env', HASNA_KNOWLEDGE_API_URL: 'https://env.example.com/api/v1' });
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

  test('normalizes API origins to the bare https origin', () => {
    expect(normalizeKnowledgeApiOrigin('https://knowledge.example.com/api/v1')).toBe('https://knowledge.example.com');
    expect(() => normalizeKnowledgeApiOrigin('ftp://knowledge.example.com')).toThrow('http or https');
  });

  test('the canonical HASNA API URL wins; the alias is the documented fallback; the gateway is the default', () => {
    expect(resolveKnowledgeApiUrl({
        HASNA_KNOWLEDGE_API_URL: 'https://canonical.example.com/api/v1',
        KNOWLEDGE_API_URL: 'https://alias.example.com/api/v1',
    })).toBe('https://canonical.example.com');

    // The unprefixed alias is the fleet-wide fallback tier, accepted below the
    // canonical name rather than ignored.
    expect(resolveKnowledgeApiUrl({
      KNOWLEDGE_API_URL: 'https://alias.example.com/api/v1',
    })).toBe('https://alias.example.com');

    // Nothing configured: the fleet gateway, path-prefixed by app.
    expect(resolveKnowledgeApiUrl({})).toBe('https://api.hasna.com/knowledge');

    expect(knowledgeAuthStatus({
      HASNA_KNOWLEDGE_API_URL: 'https://canonical.example.com/api',
      HASNA_KNOWLEDGE_API_KEY: 'present-but-never-emitted',
      HASNA_KNOWLEDGE_AUTH_DIR: join(mkdtempSync(join(tmpdir(), 'ok-hosted-env-')), 'auth'),
    })).toMatchObject({
      authenticated: true,
      source: 'env',
      api_url: 'https://canonical.example.com',
    });
  });

  test('reports the resolved /v1 authority for the api.hasna.com gateway form (issue #1588)', () => {
    expect(knowledgeAuthStatus({
      HASNA_KNOWLEDGE_API_URL: 'https://api.hasna.com/knowledge',
      HASNA_KNOWLEDGE_API_KEY: 'present-but-never-emitted',
      HASNA_KNOWLEDGE_AUTH_DIR: join(mkdtempSync(join(tmpdir(), 'ok-hosted-gateway-')), 'auth'),
    })).toMatchObject({
      authenticated: true,
      source: 'env',
      api_url: 'https://api.hasna.com/knowledge/v1',
    });
  });
});
