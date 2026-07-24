import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeService } from '../src/service';
import { KnowledgeContainmentError } from '../src/runtime-role';
import {
  defaultKnowledgeConfig,
  workspaceForHome,
  writeKnowledgeConfig,
} from '../src/workspace';

describe('Stage-A hosted configuration containment', () => {
  test('hosted setup is rejected before workspace or config creation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-hosted-setup-contained-'));
    const env: Record<string, string | undefined> = {};
    const service = createKnowledgeService({ scope: 'project', cwd: dir, env } as never);

    expect(() => service.setup({
      mode: 'hosted',
      apiUrl: 'https://knowledge.invalid.test',
    })).toThrow('KNOWLEDGE_HOSTED_CONTAINED');
    expect(existsSync(join(dir, '.hasna'))).toBe(false);
  });

  test('hosted env is rejected during service construction with zero workspace I/O', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-hosted-env-contained-'));
    expect(() => createKnowledgeService({
      scope: 'project',
      cwd: dir,
      env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted' },
    } as never)).toThrow('KNOWLEDGE_HOSTED_CONTAINED');
    expect(existsSync(join(dir, '.hasna'))).toBe(false);
  });

  test('an existing hosted role config denies before JSON or SQLite construction', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-hosted-config-contained-'));
    const home = join(dir, '.hasna', 'knowledge');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'config.json'), JSON.stringify({
      ...defaultKnowledgeConfig(),
      mode: 'hosted',
    }));

    expect(() => createKnowledgeService({ scope: 'project', cwd: dir, env: {} } as never))
      .toThrow('KNOWLEDGE_HOSTED_CONTAINED');
    expect(existsSync(join(home, 'db.json'))).toBe(false);
    expect(existsSync(join(home, 'knowledge.db'))).toBe(false);
  });

  test('explicit local setup remains available', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-local-setup-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir, env: {} } as never);
    const result = service.setup({ mode: 'local', canonicalExample: false });
    expect(result.mode).toBe('local');
    expect(existsSync(join(dir, '.hasna', 'knowledge', 'config.json'))).toBe(true);
  });

  test('canonical S3 setup is hosted even when the caller also says local', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-local-canonical-contained-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir, env: {} } as never);
    expect(() => service.setup({ mode: 'local', canonicalExample: true }))
      .toThrow('KNOWLEDGE_RUNTIME_INTENT_INVALID');
    expect(existsSync(join(dir, '.hasna'))).toBe(false);
  });

  test('direct S3 config writing is contained before changing an existing target', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-s3-config-write-'));
    const workspace = workspaceForHome(join(dir, '.hasna', 'knowledge'));
    mkdirSync(workspace.home, { recursive: true });
    const original = `${JSON.stringify(defaultKnowledgeConfig(), null, 2)}\n`;
    writeFileSync(workspace.configPath, original);
    const s3 = defaultKnowledgeConfig();
    s3.storage = {
      type: 's3',
      artifacts_root: 'artifacts',
      s3: { bucket: 'synthetic-bucket' },
    };

    expect(() => writeKnowledgeConfig(workspace.configPath, s3))
      .toThrow('KNOWLEDGE_CONFIG_INVALID');
    expect(readFileSync(workspace.configPath, 'utf8')).toBe(original);
    expect(existsSync(workspace.artifactsDir)).toBe(false);
  });

  for (const [name, modeMutation] of [
    ['missing', (config: Record<string, unknown>) => { delete config.mode; }],
    ['null', (config: Record<string, unknown>) => { config.mode = null; }],
    ['blank', (config: Record<string, unknown>) => { config.mode = '   '; }],
  ] as const) {
    test(`${name} persisted mode is structurally invalid before artifact directory creation`, () => {
      const dir = mkdtempSync(join(tmpdir(), `knowledge-invalid-${name}-`));
      const workspace = workspaceForHome(join(dir, '.hasna', 'knowledge'));
      mkdirSync(workspace.home, { recursive: true });
      const malformed = defaultKnowledgeConfig() as unknown as Record<string, unknown>;
      modeMutation(malformed);
      const original = `${JSON.stringify(malformed)}\n`;
      writeFileSync(workspace.configPath, original);

      let error: unknown;
      try {
        createKnowledgeService({ scope: 'project', cwd: dir, env: {} } as never);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(KnowledgeContainmentError);
      expect(error).toMatchObject({ code: 'KNOWLEDGE_CONFIG_INVALID', status: 503 });
      expect(readFileSync(workspace.configPath, 'utf8')).toBe(original);
      expect(readdirSync(workspace.home).sort()).toEqual(['config.json']);
    });
  }

  test('invalid nested config fields are rejected before any workspace side effect', () => {
    const mutations: Array<(config: Record<string, any>) => void> = [
      (config) => { config.storage.artifacts_root = '../outside'; },
      (config) => { config.embeddings.dimensions = 0; },
      (config) => { config.providers.aliases.fast = 42; },
      (config) => { config.safety.network.s3_reads_enabled = 'yes'; },
    ];
    for (const mutate of mutations) {
      const dir = mkdtempSync(join(tmpdir(), 'knowledge-invalid-nested-'));
      const workspace = workspaceForHome(join(dir, '.hasna', 'knowledge'));
      mkdirSync(workspace.home, { recursive: true });
      const malformed = defaultKnowledgeConfig() as unknown as Record<string, any>;
      mutate(malformed);
      const original = `${JSON.stringify(malformed)}\n`;
      writeFileSync(workspace.configPath, original);

      expect(() => createKnowledgeService({ scope: 'project', cwd: dir, env: {} } as never))
        .toThrow('KNOWLEDGE_CONFIG_INVALID');
      expect(readFileSync(workspace.configPath, 'utf8')).toBe(original);
      expect(readdirSync(workspace.home).sort()).toEqual(['config.json']);
    }
  });

  test('symlinked and non-regular config paths fail closed without following or clobbering', () => {
    for (const kind of ['symlink', 'broken-symlink', 'directory'] as const) {
      const dir = mkdtempSync(join(tmpdir(), `knowledge-config-${kind}-`));
      const workspace = workspaceForHome(join(dir, '.hasna', 'knowledge'));
      mkdirSync(workspace.home, { recursive: true });
      const target = join(dir, 'outside.json');
      const original = `${JSON.stringify(defaultKnowledgeConfig())}\n`;
      if (kind === 'symlink') {
        writeFileSync(target, original);
        symlinkSync(target, workspace.configPath);
      } else if (kind === 'broken-symlink') {
        symlinkSync(target, workspace.configPath);
      } else {
        mkdirSync(workspace.configPath);
      }

      let error: unknown;
      try {
        createKnowledgeService({ scope: 'project', cwd: dir, env: {} } as never);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(KnowledgeContainmentError);
      expect(error).toMatchObject({ code: 'KNOWLEDGE_CONFIG_INVALID', status: 503 });
      if (kind === 'symlink') expect(readFileSync(target, 'utf8')).toBe(original);
      if (kind === 'broken-symlink') expect(existsSync(target)).toBe(false);
      expect(existsSync(workspace.artifactsDir)).toBe(false);
    }
  });

  test('a symlinked Knowledge workspace parent is rejected before following its config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-config-parent-symlink-'));
    const outside = join(dir, 'outside');
    const hasna = join(dir, '.hasna');
    const linkedHome = join(hasna, 'knowledge');
    mkdirSync(outside, { recursive: true });
    mkdirSync(hasna, { recursive: true });
    const original = `${JSON.stringify(defaultKnowledgeConfig())}\n`;
    writeFileSync(join(outside, 'config.json'), original);
    symlinkSync(outside, linkedHome);

    let error: unknown;
    try {
      createKnowledgeService({ scope: 'project', cwd: dir, env: {} } as never);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(KnowledgeContainmentError);
    expect(error).toMatchObject({ code: 'KNOWLEDGE_CONFIG_INVALID', status: 503 });
    expect(readFileSync(join(outside, 'config.json'), 'utf8')).toBe(original);
    expect(existsSync(join(outside, 'artifacts'))).toBe(false);
  });

  test('config writes reject traversal and untrusted destinations without clobbering', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-config-traversal-'));
    const victimDir = join(dir, '.hasna', 'victim');
    const victim = join(victimDir, 'config.json');
    mkdirSync(victimDir, { recursive: true });
    writeFileSync(victim, 'unchanged\n');
    const traversal = join(dir, '.hasna', 'knowledge', '..', 'victim', 'config.json');

    let error: unknown;
    try {
      writeKnowledgeConfig(traversal, defaultKnowledgeConfig());
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(KnowledgeContainmentError);
    expect(error).toMatchObject({ code: 'KNOWLEDGE_CONFIG_INVALID', status: 503 });
    expect(readFileSync(victim, 'utf8')).toBe('unchanged\n');
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);
  });

  test('auth-file operations are contained even from a local service', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-auth-contained-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir, env: {} } as never);
    expect(() => service.authStatus({})).toThrow('KNOWLEDGE_HOSTED_CONTAINED');
    expect(existsSync(join(dir, '.hasna'))).toBe(false);
  });
});
