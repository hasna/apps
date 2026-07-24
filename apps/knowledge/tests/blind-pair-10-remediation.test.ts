import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  LocalArtifactStore,
} from '../src/artifact-store.ts';
import {
  assertAppWikiWriteAllowed,
  listAppWikiNotes,
  writeAppWikiNote,
} from '../src/app-wiki.ts';
import { createKnowledgeProjectPanel } from '../src/project-panel.ts';
import { createKnowledgeService, KnowledgeService } from '../src/service.ts';
import {
  resolveScopedWorkspace,
  workspaceForHome,
} from '../src/workspace.ts';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env.ts';

const root = join(import.meta.dir, '..');

describe('blind pair 10 scope and release remediation', () => {
  test('openGlobalWiki requires an explicit own data allowGlobal=true before workspace access', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-10-global-opt-in-'));
    const missing = join(fixture, 'must-not-be-resolved');
    const sdkUrl = pathToFileURL(join(root, 'src', 'sdk.ts')).href;
    const builtSdkUrl = pathToFileURL(join(root, 'dist', 'index.js')).href;
    const script = `
      const missing = ${JSON.stringify(missing)};
      let rejected = 0;
      for (const url of ${JSON.stringify([sdkUrl, builtSdkUrl])}) {
        const { openGlobalWiki } = await import(url);
        const inherited = Object.create({ allowGlobal: true });
        inherited.cwd = missing;
        const accessor = Object.defineProperty({ cwd: missing }, 'allowGlobal', {
          enumerable: true,
          get() { throw new Error('allowGlobal accessor invoked'); },
        });
        const invalid = [
          undefined, null, {},
          { cwd: missing, allowGlobal: undefined },
          { cwd: missing, allowGlobal: null },
          { cwd: missing, allowGlobal: false },
          { cwd: missing, allowGlobal: 'true' },
          inherited, accessor,
        ];
        for (const options of invalid) {
          try { openGlobalWiki(options); }
          catch (error) {
            if (!String(error).match(/own allowGlobal=true/i)) throw error;
            rejected += 1;
            continue;
          }
          throw new Error('invalid global authority unexpectedly succeeded');
        }
        openGlobalWiki({ cwd: process.cwd(), env: {}, allowGlobal: true });
      }
      process.stdout.write(JSON.stringify({ rejected }));
    `;
    try {
      const result = Bun.spawnSync(['bun', '--eval', script], {
        cwd: fixture,
        env: sanitizedLocalTestEnv(),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
      expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({ rejected: 18 });
      expect(existsSync(missing)).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('exported services preserve explicit-own global authority on direct calls', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-10-global-service-'));
    const serviceUrls = [
      pathToFileURL(join(root, 'src', 'service.ts')).href,
      pathToFileURL(join(root, 'dist', 'index.js')).href,
    ];
    const script = `
      let rejected = 0;
      for (const url of ${JSON.stringify(serviceUrls)}) {
        const { createKnowledgeService } = await import(url);
        const service = createKnowledgeService({ scope: 'global', env: {} });
        const inherited = Object.create({ allowGlobal: true });
        const accessor = Object.defineProperty({}, 'allowGlobal', {
          enumerable: true,
          get() { throw new Error('allowGlobal accessor invoked'); },
        });
        const invalid = [
          undefined, null, {},
          { allowGlobal: undefined },
          { allowGlobal: null },
          { allowGlobal: false },
          { allowGlobal: 'true' },
          inherited, accessor,
        ];
        for (const options of invalid) {
          for (const invoke of [
            () => service.listAppWikiNotes(options),
            () => service.initAppWiki(options),
          ]) {
            try { await invoke(); }
            catch {
              rejected += 1;
              continue;
            }
            throw new Error('invalid direct global authority unexpectedly succeeded');
          }
        }
        if (service.listAppWikiNotes({ allowGlobal: true }).length !== 0) {
          throw new Error('unexpected global notes in isolated fixture');
        }
      }
      process.stdout.write(JSON.stringify({ rejected }));
    `;
    try {
      const result = Bun.spawnSync(['bun', '--eval', script], {
        cwd: fixture,
        env: {
          ...sanitizedLocalTestEnv(),
          HOME: fixture,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
      expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({ rejected: 36 });
      expect(existsSync(join(fixture, '.hasna'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('app-wiki rejects cloned, cross-scope, aliased, and mismatched workspace identities', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-10-workspace-identity-'));
    const projectA = join(fixture, 'project-a');
    const projectB = join(fixture, 'project-b');
    const projectSwap = join(fixture, 'project-swap');
    const aliasA = join(fixture, 'project-a-alias');
    mkdirSync(projectA);
    mkdirSync(projectB);
    mkdirSync(projectSwap);
    const workspaceA = resolveScopedWorkspace('project', projectA);
    const workspaceB = resolveScopedWorkspace('project', projectB);
    const swappedWorkspace = resolveScopedWorkspace('project', projectSwap);
    const cloneA = { ...workspaceA };
    symlinkSync(projectA, aliasA, 'dir');
    try {
      expect(() => assertAppWikiWriteAllowed({ scope: 'project', workspace: workspaceA }))
        .not.toThrow();
      expect(() => assertAppWikiWriteAllowed({ scope: 'project', workspace: cloneA }))
        .toThrow(/trusted workspace identity/i);
      expect(() => assertAppWikiWriteAllowed({
        scope: 'global',
        workspace: workspaceA,
        allowGlobal: true,
      })).toThrow(/workspace.*scope|scope.*workspace/i);
      expect(() => resolveScopedWorkspace('project', aliasA)).toThrow(/canonical|alias|symlink/i);
      expect(() => workspaceForHome(join(fixture, 'e\u0301', '.hasna', 'knowledge')))
        .toThrow(/unicode|canonical/i);
      mkdirSync(swappedWorkspace.home, { recursive: true });
      expect(() => assertAppWikiWriteAllowed({ scope: 'project', workspace: swappedWorkspace }))
        .not.toThrow();
      renameSync(projectSwap, `${projectSwap}-moved`);
      mkdirSync(projectSwap);
      expect(() => assertAppWikiWriteAllowed({ scope: 'project', workspace: swappedWorkspace }))
        .toThrow(/root identity|directory identity|canonical parent identity/i);
      expect(() => listAppWikiNotes({
        scope: 'project',
        workspace: workspaceA,
        dbPath: workspaceB.knowledgeDbPath,
      } as never)).toThrow(/database path|workspace identity/i);
      const swappingOptions = {
        scope: 'project',
        dbPath: workspaceA.knowledgeDbPath,
      } as Record<string, unknown>;
      Object.defineProperty(swappingOptions, 'workspace', {
        enumerable: true,
        get() { return workspaceA; },
      });
      expect(() => listAppWikiNotes(swappingOptions as never))
        .toThrow(/runtime intent|unsupported accessor|read safely|public option/i);
      expect(existsSync(workspaceA.knowledgeDbPath)).toBe(false);
      mkdirSync(workspaceA.home, { recursive: true });
      const outsideDb = join(fixture, 'outside.db');
      writeFileSync(outsideDb, 'not-a-database');
      symlinkSync(outsideDb, workspaceA.knowledgeDbPath);
      expect(() => listAppWikiNotes({
        scope: 'project',
        workspace: workspaceA,
        dbPath: workspaceA.knowledgeDbPath,
      })).toThrow(/canonical regular file|database identity/i);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('app-wiki rejects structural, proxied, and cross-project stores before invocation', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-10-store-identity-'));
    const projectA = join(fixture, 'project-a');
    const projectB = join(fixture, 'project-b');
    mkdirSync(projectA);
    mkdirSync(projectB);
    const serviceA = createKnowledgeService({ scope: 'project', cwd: projectA, env: {} } as never);
    const serviceB = createKnowledgeService({ scope: 'project', cwd: projectB, env: {} } as never);
    let structuralCalls = 0;
    const structuralStore = {
      type: 'local' as const,
      canRead: true,
      canWrite: true,
      async put() { structuralCalls += 1; throw new Error('structural store invoked'); },
      async getText() { structuralCalls += 1; throw new Error('structural store invoked'); },
      async exists() { structuralCalls += 1; return false; },
    };
    try {
      serviceA.setup({ mode: 'local' });
      serviceB.setup({ mode: 'local' });
      const storeA = serviceA.artifactStore();
      const storeB = serviceB.artifactStore();
      const base = {
        scope: 'project',
        workspace: serviceA.workspace,
        title: 'Pair 10 identity',
        content: 'Identity-bound content.',
      };
      for (const store of [structuralStore, new Proxy(storeA, {}), storeB]) {
        await expect(writeAppWikiNote({ ...base, store } as never))
          .rejects.toThrow(/trusted artifact store|workspace identity/i);
      }
      expect(structuralCalls).toBe(0);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('project-panel accepts only immutable services owned by the matching runtime', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-10-panel-service-'));
    const projectA = join(fixture, 'project-a');
    const projectB = join(fixture, 'project-b');
    mkdirSync(projectA);
    mkdirSync(projectB);
    let fakeCalls = 0;
    const fake = {
      inventory() {
        fakeCalls += 1;
        throw new Error('structural inventory invoked');
      },
    };
    try {
      expect(() => createKnowledgeProjectPanel('pair-10', {
        scope: 'project',
        cwd: projectA,
        service: fake as never,
      })).toThrow(/owning runtime|trusted knowledge service/i);
      expect(fakeCalls).toBe(0);

      const serviceA = createKnowledgeService({ scope: 'project', cwd: projectA, env: {} } as never);
      const serviceB = createKnowledgeService({ scope: 'project', cwd: projectB, env: {} } as never);
      expect(() => createKnowledgeProjectPanel('pair-10', {
        scope: 'project',
        cwd: projectA,
        service: new Proxy(serviceA, {}),
      })).toThrow(/owning runtime|trusted knowledge service/i);
      expect(() => createKnowledgeProjectPanel('pair-10', {
        scope: 'project',
        cwd: projectA,
        service: serviceB,
      })).toThrow(/project|workspace identity/i);
      class ForgedKnowledgeService extends KnowledgeService {
        override inventory(): never {
          fakeCalls += 1;
          throw new Error('forged subclass inventory invoked');
        }
      }
      expect(() => new ForgedKnowledgeService({ scope: 'project', cwd: projectA }))
        .toThrow(/owning runtime constructor/i);
      expect(Reflect.defineProperty(KnowledgeService.prototype, 'inventory', {
        value() { fakeCalls += 1; },
      })).toBe(false);
      expect(Reflect.defineProperty(LocalArtifactStore.prototype, 'put', {
        value() { fakeCalls += 1; },
      })).toBe(false);
      expect(Reflect.defineProperty(serviceA, 'scope', {
        value: 'global',
        configurable: true,
      })).toBe(false);
      expect(() => createKnowledgeProjectPanel('pair-10', {
        scope: 'project',
        cwd: projectA,
        service: serviceA,
        limit: 1,
      })).not.toThrow();
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('release metadata is local-only and every executable provenance ref is immutable', () => {
    const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    const actionRefs = Array.from(ci.matchAll(/\buses:\s*([^\s#]+)/g), (match) => match[1]);
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const ref of actionRefs) expect(ref).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);

    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    const images = Array.from(
      dockerfile.matchAll(/^FROM(?:\s+--platform=\S+)?\s+(\S+)/gm),
      (match) => match[1],
    );
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      if (image !== 'scratch') expect(image).toMatch(/@sha256:[0-9a-f]{64}$/);
    }

    const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
    expect(compose).not.toMatch(/\bpostgres\b|storage_mode:\s*cloud|database_url|apply-cloud-migrations|migration/i);
    expect(compose).not.toMatch(/^\s*image:\s*[^\s]+(?<!@sha256:[0-9a-f]{64})\s*$/m);

    const contract = JSON.parse(readFileSync(join(root, 'hasna.contract.json'), 'utf8'));
    expect(JSON.stringify(contract)).not.toMatch(/migrationCommand|databaseUrlSecretRef|ownerDatabaseUrlSecretRef|PURE REMOTE/i);
    expect(contract.metadata.cloud).toEqual({ state: 'contained', executable: false });

    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['migrate:cloud']).toBeUndefined();
    const releaseDocs = [
      readFileSync(join(root, 'README.md'), 'utf8'),
      readFileSync(join(root, 'docker-compose.yml'), 'utf8'),
    ].join('\n');
    expect(releaseDocs).not.toMatch(/migrate:cloud|apply-cloud-migrations|knowledge-migrate/i);
  });
});
