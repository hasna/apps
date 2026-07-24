import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env.ts';

const repositoryRoot = join(import.meta.dir, '..');
const buildLockName = '.knowledge-build-lock';
const transactionMarkerName = '.knowledge-build-transaction.json';

const expectedTools = [
  'knowledge_app_wiki_init',
  'knowledge_app_wiki_note_add',
  'knowledge_app_wiki_query',
  'knowledge_app_wiki_search',
  'knowledge_app_wiki_source_add',
  'knowledge_ask',
  'knowledge_build',
  'knowledge_context_pack',
  'knowledge_get',
  'knowledge_ingest',
  'knowledge_inventory',
  'knowledge_lint',
  'knowledge_machines_preflight',
  'knowledge_machines_topology',
  'knowledge_resolve_source',
  'knowledge_run_status',
  'knowledge_search',
  'knowledge_storage',
  'knowledge_sync_conflict_get',
  'knowledge_sync_conflict_propose',
  'knowledge_sync_conflict_resolve',
  'knowledge_sync_conflicts',
  'knowledge_sync_doctor',
  'knowledge_sync_peer',
  'knowledge_sync_snapshot',
  'knowledge_sync_status',
  'knowledge_web_search',
  'ok_add',
  'ok_archive',
  'ok_batch',
  'ok_bulk_delete',
  'ok_dedupe',
  'ok_delete',
  'ok_embeddings_index',
  'ok_embeddings_status',
  'ok_export',
  'ok_get',
  'ok_import',
  'ok_list',
  'ok_parse_source_ref',
  'ok_paths',
  'ok_provider_models',
  'ok_provider_status',
  'ok_prune',
  'ok_reindex_embeddings',
  'ok_reindex_enqueue',
  'ok_reindex_status',
  'ok_resolve_source',
  'ok_restore',
  'ok_search',
  'ok_semantic_search',
  'ok_stats',
  'ok_storage_status',
  'ok_untag',
  'ok_update',
  'ok_upsert',
  'ok_web_search',
  'storage_pull',
  'storage_push',
  'storage_status',
  'storage_sync',
] as const;

const expectedResources = [
  'knowledge-project-config',
  'knowledge-project-decisions',
  'knowledge-project-indexes',
  'knowledge-project-inventory',
  'knowledge-project-machines',
  'knowledge-project-open-files',
  'knowledge-project-runs',
  'knowledge-project-schema',
  'knowledge-project-sources',
  'knowledge-project-storage',
  'knowledge-project-sync',
  'knowledge-project-wiki-pages',
] as const;

const expectedTemplates = [
  'knowledge-project-decision',
  'knowledge-project-index',
  'knowledge-project-items',
  'knowledge-project-run',
  'knowledge-project-source',
  'knowledge-project-wiki-page',
] as const;

type McpInventoryEntry = {
  kind: 'tool' | 'resource' | 'template';
  name: string;
  classification: 'read' | 'write' | 'metadata/path' | 'project-bound resource';
  scope_access: 'dispatch' | 'none' | 'project';
  stores: readonly string[];
  services: readonly string[];
};

type McpModule = {
  MCP_REGISTRATION_INVENTORY: readonly McpInventoryEntry[];
  resolveMcpDispatchAuthority: (
    name: string,
    input: unknown,
    startupScope: 'project' | 'local' | 'global',
  ) => { name: string; scope: 'project' | 'local' | 'global' | null; allowGlobal: boolean };
  buildServer: (options: Record<string, unknown>) => any;
};

function moduleEntries(): Array<[string, URL]> {
  return [
    ['source', new URL('../src/mcp.js', import.meta.url)],
    ['built', new URL('../dist/mcp-payload.js', import.meta.url)],
  ];
}

function localEnv(home: string, overrides: Record<string, string | undefined> = {}) {
  return sanitizedLocalTestEnv({
    HOME: home,
    USERPROFILE: home,
    BUN_CONFIG_INSTALL_AUTO: 'disable',
    ...overrides,
  });
}

function itemStore(title: string): string {
  return `${JSON.stringify({
    items: [{
      id: `k_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      short_id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title,
      content: `${title} searchable content`,
      url: null,
      tags: [],
      archived: false,
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
    }],
  }, null, 2)}\n`;
}

function resultText(result: { content?: Array<{ text?: string }> }): string {
  return result.content?.[0]?.text ?? '';
}

function registeredNames(server: any) {
  return {
    tool: Object.keys(server._registeredTools ?? {}).sort(),
    resource: Object.values(server._registeredResources ?? {})
      .map((entry: any) => String(entry.name))
      .sort(),
    template: Object.keys(server._registeredResourceTemplates ?? {}).sort(),
  };
}

function copyRepository(destination: string): void {
  cpSync(repositoryRoot, destination, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
    verbatimSymlinks: true,
    filter(source) {
      const path = relative(repositoryRoot, source);
      if (!path) return true;
      const first = path.split(sep)[0];
      return first !== '.git'
        && first !== 'node_modules'
        && first !== buildLockName
        && !/^\.knowledge-build-[A-Za-z0-9]{6}$/.test(first);
    },
  });
  symlinkSync(realpathSync(join(repositoryRoot, 'node_modules')), join(destination, 'node_modules'), 'dir');
}

const generatedPaths = [
  'src/generated',
  'dist',
  'bin',
  'generated-artifacts.json',
  'repository-generated-artifacts.json',
];

function generatedDigest(root: string): string {
  const hash = createHash('sha256');
  const visit = (path: string) => {
    const stat = lstatSync(path);
    hash.update(relative(root, path));
    hash.update('\0');
    hash.update(String(stat.mode & 0o777));
    hash.update('\0');
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry));
    } else {
      hash.update(readFileSync(path));
      hash.update('\0');
    }
  };
  for (const path of generatedPaths) visit(join(root, path));
  return hash.digest('hex');
}

function buildStages(workspace: string): string[] {
  return readdirSync(workspace)
    .filter((entry) => /^\.knowledge-build-[A-Za-z0-9]{6}$/.test(entry))
    .sort();
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function waitForPreparingStage(workspace: string, pid: number): string {
  const deadline = performance.now() + 30_000;
  for (;;) {
    for (const entry of buildStages(workspace)) {
      const marker = join(workspace, entry, transactionMarkerName);
      if (!existsSync(marker)) continue;
      try {
        if (JSON.parse(readFileSync(marker, 'utf8')).phase === 'preparing') return entry;
      } catch {
        // The writer may still be publishing the marker. Re-read until bounded expiry.
      }
    }
    if (!processExists(pid)) throw new Error('builder exited before publishing a preparing journal');
    if (performance.now() > deadline) throw new Error('timed out waiting for preparing journal');
  }
}

function waitForStoppedProcess(pid: number): void {
  const status = `/proc/${pid}/status`;
  if (!existsSync(status)) return;
  const deadline = performance.now() + 10_000;
  while (!/^State:\s+T/m.test(readFileSync(status, 'utf8'))) {
    if (!processExists(pid)) throw new Error('builder exited before entering the stopped state');
    if (performance.now() > deadline) throw new Error('timed out waiting for stopped builder');
  }
}

function processIsStopped(pid: number): boolean {
  try {
    return /^State:\s+T/m.test(readFileSync(`/proc/${pid}/status`, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function runBuild(workspace: string, home: string) {
  return Bun.spawnSync(['bun', 'scripts/build.mjs'], {
    cwd: workspace,
    env: localEnv(home),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

describe('Stage A V8 scope and builder ownership regressions', () => {
  test('source and built MCP inventory covers every tool, resource, and template registration', async () => {
    let sourceInventory: readonly McpInventoryEntry[] | undefined;
    for (const [label, moduleUrl] of moduleEntries()) {
      const module = await import(moduleUrl.href) as unknown as McpModule;
      const inventory = module.MCP_REGISTRATION_INVENTORY;
      expect(Array.isArray(inventory), `${label} inventory export`).toBe(true);
      expect(inventory).toHaveLength(79);
      const keys = inventory.map((entry) => `${entry.kind}:${entry.name}`);
      expect(new Set(keys).size, `${label} duplicate inventory entries`).toBe(keys.length);
      expect(inventory.filter((entry) => entry.kind === 'tool').map((entry) => entry.name).sort())
        .toEqual([...expectedTools]);
      expect(inventory.filter((entry) => entry.kind === 'resource').map((entry) => entry.name).sort())
        .toEqual([...expectedResources]);
      expect(inventory.filter((entry) => entry.kind === 'template').map((entry) => entry.name).sort())
        .toEqual([...expectedTemplates]);

      for (const entry of inventory) {
        expect(['read', 'write', 'metadata/path', 'project-bound resource']).toContain(entry.classification);
        expect(['dispatch', 'none', 'project']).toContain(entry.scope_access);
        expect(entry.stores.length, `${label}/${entry.name} store inventory`).toBeGreaterThan(0);
        expect(entry.services.length, `${label}/${entry.name} service inventory`).toBeGreaterThan(0);
        if (entry.kind !== 'tool') {
          expect(entry.classification, `${label}/${entry.name}`).toBe('project-bound resource');
          expect(entry.scope_access, `${label}/${entry.name}`).toBe('project');
        }
      }

      const fixture = mkdtempSync(join(tmpdir(), `knowledge-v8-inventory-${label}-`));
      try {
        const server = module.buildServer({ scope: 'project', cwd: fixture, env: {} });
        const runtime = registeredNames(server);
        expect(runtime.tool).toEqual([...expectedTools]);
        expect(runtime.resource).toEqual([...expectedResources]);
        expect(runtime.template).toEqual([...expectedTemplates]);
        for (const entry of inventory.filter((candidate) => candidate.scope_access === 'dispatch')) {
          const schema = server._registeredTools[entry.name]?.inputSchema?.shape;
          expect(Object.hasOwn(schema ?? {}, 'scope'), `${label}/${entry.name} scope schema`).toBe(true);
          expect(Object.hasOwn(schema ?? {}, 'allow_global'), `${label}/${entry.name} authority schema`).toBe(true);
          const denied = await server._registeredTools[entry.name].handler({ scope: 'global' });
          expect(denied.isError, `${label}/${entry.name} accepted unapproved global dispatch`).toBe(true);
          expect(resultText(denied), `${label}/${entry.name} returned the wrong authority error`)
            .toMatch(/explicit own allow_global=true/i);
        }
        expect(inventory
          .filter((candidate) => candidate.kind === 'tool' && candidate.scope_access === 'none')
          .map((candidate) => candidate.name)
          .sort()).toEqual(['knowledge_web_search', 'ok_parse_source_ref', 'ok_web_search']);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }

      if (sourceInventory) expect(inventory).toEqual(sourceInventory);
      else sourceInventory = inventory;
    }
  });

  test('every scope-selectable MCP registration shares the exact-own dispatch authority matrix', async () => {
    for (const [label, moduleUrl] of moduleEntries()) {
      const module = await import(moduleUrl.href) as unknown as McpModule;
      const scoped = module.MCP_REGISTRATION_INVENTORY
        .filter((entry) => entry.kind === 'tool' && entry.scope_access === 'dispatch');
      expect(scoped).toHaveLength(58);
      for (const entry of scoped) {
        const authorize = (input: unknown, startup: 'project' | 'local' | 'global' = 'project') => (
          module.resolveMcpDispatchAuthority(entry.name, input, startup)
        );
        expect(authorize({})).toEqual({ name: entry.name, scope: 'project', allowGlobal: false });
        expect(authorize({ scope: 'project' })).toEqual({ name: entry.name, scope: 'project', allowGlobal: false });
        expect(authorize({ scope: 'local' })).toEqual({ name: entry.name, scope: 'local', allowGlobal: false });
        expect(authorize({ scope: 'project', allow_global: false })).toEqual({
          name: entry.name,
          scope: 'project',
          allowGlobal: false,
        });

        const inherited = Object.assign(Object.create({ allow_global: true }), { scope: 'global' });
        let accessorReads = 0;
        const accessor: Record<string, unknown> = { scope: 'global' };
        Object.defineProperty(accessor, 'allow_global', {
          enumerable: true,
          get() { accessorReads += 1; return true; },
        });
        for (const input of [
          { scope: 'global' },
          { scope: 'global', allow_global: false },
          inherited,
          accessor,
        ]) {
          expect(() => authorize(input), `${label}/${entry.name}`).toThrow(/explicit own allow_global=true/i);
        }
        expect(accessorReads, `${label}/${entry.name} invoked authority accessor`).toBe(0);
        expect(authorize({ scope: 'global', allow_global: true })).toEqual({
          name: entry.name,
          scope: 'global',
          allowGlobal: true,
        });

        expect(() => authorize({}, 'global'), `${label}/${entry.name} global startup`).toThrow(/explicit own allow_global=true/i);
        expect(() => authorize({ allow_global: false }, 'global')).toThrow(/explicit own allow_global=true/i);
        expect(authorize({ allow_global: true }, 'global')).toEqual({
          name: entry.name,
          scope: 'global',
          allowGlobal: true,
        });
        expect(authorize({ scope: 'project' }, 'global').scope).toBe('project');
        expect(authorize({ scope: 'local' }, 'global').scope).toBe('local');
      }

      expect(module.resolveMcpDispatchAuthority('ok_parse_source_ref', {}, 'global')).toEqual({
        name: 'ok_parse_source_ref',
        scope: null,
        allowGlobal: false,
      });
      expect(() => module.resolveMcpDispatchAuthority('missing-registration', {}, 'project'))
        .toThrow(/inventory|registration/i);
    }
  });

  test('stats, export, writes, paths, and project resources enforce runtime scope authority in source and built payloads', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v8-mcp-runtime-'));
    try {
      for (const [label, moduleUrl] of moduleEntries()) {
        const caseRoot = join(fixture, label);
        const project = join(caseRoot, 'project');
        const home = join(caseRoot, 'home');
        const projectWorkspace = join(project, '.hasna', 'knowledge');
        const globalWorkspace = join(home, '.hasna', 'knowledge');
        const deniedExportPath = join(caseRoot, 'denied-export.json');
        const allowedExportPath = join(caseRoot, 'allowed-export.json');
        mkdirSync(projectWorkspace, { recursive: true, mode: 0o700 });
        mkdirSync(globalWorkspace, { recursive: true, mode: 0o700 });
        writeFileSync(join(projectWorkspace, 'db.json'), itemStore('V8 project sentinel'), { mode: 0o600 });
        writeFileSync(join(globalWorkspace, 'db.json'), itemStore('V8 global sentinel'), { mode: 0o600 });

        // HOME must be established before node:os is imported. Run each payload in a
        // fresh process so global-scope path selection cannot inherit the test runner's
        // cached home directory.
        const script = `
          const module = await import(${JSON.stringify(moduleUrl.href)});
          const project = ${JSON.stringify(project)};
          const deniedExportPath = ${JSON.stringify(deniedExportPath)};
          const allowedExportPath = ${JSON.stringify(allowedExportPath)};
          const text = (result) => result.content?.find((entry) => entry.type === 'text')?.text ?? '';
          const assert = (condition, message) => { if (!condition) throw new Error(message); };
          const server = module.buildServer({ scope: 'project', cwd: project, env: process.env });
          const tools = server._registeredTools;

          const projectStats = await tools.ok_stats.handler({});
          assert(projectStats.isError !== true, 'project stats failed: ' + text(projectStats));
          assert(JSON.parse(text(projectStats)).total === 1, 'project stats did not use project store');
          const projectList = await tools.ok_list.handler({});
          assert(projectList.isError !== true, 'project list failed: ' + text(projectList));
          assert(JSON.parse(text(projectList)).items?.[0]?.title === 'V8 project sentinel', 'project list did not use project store');
          const projectGet = await tools.ok_get.handler({ id: 'v8-project-sentinel' });
          assert(projectGet.isError !== true, 'project get failed: ' + text(projectGet));
          assert(JSON.parse(text(projectGet)).item?.title === 'V8 project sentinel', 'project get did not use project store');

          let accessorReads = 0;
          const inherited = Object.assign(Object.create({ allow_global: true }), { scope: 'global' });
          const accessor = { scope: 'global' };
          Object.defineProperty(accessor, 'allow_global', {
            enumerable: true,
            get() { accessorReads += 1; return true; },
          });
          for (const input of [
            { scope: 'global' },
            { scope: 'global', allow_global: false },
            inherited,
            accessor,
          ]) {
            const denied = await tools.ok_stats.handler(input);
            assert(denied.isError === true, 'stats accepted unauthorized global input');
            assert(/explicit own allow_global=true/i.test(text(denied)), 'stats returned wrong authority error');
          }
          assert(accessorReads === 0, 'stats invoked authority accessor');

          const globalStats = await tools.ok_stats.handler({ scope: 'global', allow_global: true });
          assert(globalStats.isError !== true, 'authorized stats failed: ' + text(globalStats));
          assert(JSON.parse(text(globalStats)).total === 1, 'authorized stats did not use global store');

          const deniedExport = await tools.ok_export.handler({ scope: 'global', file: deniedExportPath });
          assert(deniedExport.isError === true, 'export accepted unauthorized global input');
          assert(/explicit own allow_global=true/i.test(text(deniedExport)), 'export returned wrong authority error');
          assert(!(await import('node:fs')).existsSync(deniedExportPath), 'denied export wrote a file');
          const allowedExport = await tools.ok_export.handler({
            scope: 'global',
            allow_global: true,
            file: allowedExportPath,
          });
          assert(allowedExport.isError !== true, 'authorized export failed: ' + text(allowedExport));
          assert((await Bun.file(allowedExportPath).text()).includes('V8 global sentinel'), 'export read wrong store');

          const deniedWrite = await tools.ok_add.handler({
            scope: 'global',
            title: 'Denied V8 write',
            content: 'must not persist',
          });
          assert(deniedWrite.isError === true, 'write accepted unauthorized global input');
          assert(/explicit own allow_global=true/i.test(text(deniedWrite)), 'write returned wrong authority error');
          const allowedWrite = await tools.ok_add.handler({
            scope: 'global',
            allow_global: true,
            title: 'Allowed V8 write ${label}',
            content: 'authorized synthetic write',
          });
          assert(allowedWrite.isError !== true, 'authorized write failed: ' + text(allowedWrite));

          const projectPaths = JSON.parse(text(await tools.ok_paths.handler({})));
          const localPaths = JSON.parse(text(await tools.ok_paths.handler({ scope: 'local' })));
          assert(projectPaths.scope === 'project', 'paths omitted scope was not project');
          assert(localPaths.scope === 'local', 'paths local scope was not local');
          const deniedGlobalPaths = await tools.ok_paths.handler({ scope: 'global' });
          assert(deniedGlobalPaths.isError === true, 'paths accepted unauthorized global input');
          assert(/explicit own allow_global=true/i.test(text(deniedGlobalPaths)), 'paths returned wrong authority error');
          const globalPaths = JSON.parse(text(await tools.ok_paths.handler({
            scope: 'global',
            allow_global: true,
          })));
          assert(globalPaths.scope === 'global', 'paths authorized global scope was not global');

          const projectResource = server._registeredResources['knowledge://project/inventory'];
          const resourceResult = await projectResource.readCallback(new URL('knowledge://project/inventory'));
          const resourceText = resourceResult.contents?.[0]?.text ?? '';
          assert(resourceText.includes('V8 project sentinel'), 'project resource missed project data');
          assert(!resourceText.includes('V8 global sentinel'), 'project resource leaked global data');

          const globalStartup = module.buildServer({ scope: 'global', cwd: project, env: process.env });
          const deniedDefault = await globalStartup._registeredTools.ok_stats.handler({});
          assert(deniedDefault.isError === true, 'global startup accepted omitted authority');
          assert(/explicit own allow_global=true/i.test(text(deniedDefault)), 'global startup returned wrong authority error');
          const allowedDefault = await globalStartup._registeredTools.ok_stats.handler({ allow_global: true });
          assert(allowedDefault.isError !== true, 'global startup rejected explicit authority: ' + text(allowedDefault));
          assert(JSON.parse(text(allowedDefault)).total >= 2, 'global startup did not use global store');
          const allowedBuildWrite = await globalStartup._registeredTools.knowledge_build.handler({
            allow_global: true,
            prompt: 'V8 global sentinel',
            approve_write: true,
            file_answer: true,
            fake: true,
          });
          assert(allowedBuildWrite.isError !== true, 'global build write dropped authority: ' + text(allowedBuildWrite));
          assert(JSON.parse(text(allowedBuildWrite)).wiki_file, 'global build write did not produce a wiki artifact');
        `;
        const child = Bun.spawnSync(['bun', '--eval', script], {
          cwd: project,
          env: localEnv(home),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(
          child.exitCode,
          `${label} runtime matrix failed\nstdout:\n${new TextDecoder().decode(child.stdout)}\nstderr:\n${new TextDecoder().decode(child.stderr)}`,
        ).toBe(0);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 60_000);

  test('simultaneous builders elect exactly one live owner and preserve the losing transaction', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'knowledge-v8-simultaneous-builders-'));
    const workspace = join(parent, 'workspace');
    const home = join(parent, 'home');
    copyRepository(workspace);
    const before = generatedDigest(workspace);
    const builders = [0, 1].map(() => Bun.spawn(['bun', 'scripts/build.mjs'], {
      cwd: workspace,
      env: localEnv(home, { KNOWLEDGE_BUILD_INJECT_STOP_AFTER_PREPARING: '1' }),
      stdout: 'pipe',
      stderr: 'pipe',
    }));
    try {
      const deadline = performance.now() + 30_000;
      let ownerIndex = -1;
      while (ownerIndex < 0) {
        const stopped = builders
          .map((builder, index) => processIsStopped(builder.pid) ? index : -1)
          .filter((index) => index >= 0);
        if (stopped.length > 1) throw new Error('simultaneous builders both became active owners');
        if (stopped.length === 1) ownerIndex = stopped[0];
        else if (builders.every((builder) => !processExists(builder.pid))) {
          throw new Error('simultaneous builders exited without electing an owner');
        } else if (performance.now() > deadline) {
          throw new Error('timed out waiting for simultaneous builder ownership');
        }
      }

      const loserIndex = ownerIndex === 0 ? 1 : 0;
      const loserExit = await builders[loserIndex].exited;
      const loserError = await new Response(builders[loserIndex].stderr).text();
      expect(loserExit).not.toBe(0);
      expect(loserError).toMatch(/active build|active transaction|owned by/i);
      expect(buildStages(workspace)).toHaveLength(1);
      expect(existsSync(join(workspace, buildLockName))).toBe(true);
      expect(generatedDigest(workspace)).toBe(before);

      process.kill(builders[ownerIndex].pid, 'SIGKILL');
      await builders[ownerIndex].exited;
      const recovered = runBuild(workspace, home);
      expect(recovered.exitCode, new TextDecoder().decode(recovered.stderr)).toBe(0);
      expect(generatedDigest(workspace)).toBe(before);
      expect(buildStages(workspace)).toEqual([]);
      expect(existsSync(join(workspace, buildLockName))).toBe(false);
    } finally {
      for (const builder of builders) {
        if (processExists(builder.pid)) process.kill(builder.pid, 'SIGKILL');
      }
      await Promise.all(builders.map((builder) => builder.exited));
      rmSync(parent, { recursive: true, force: true });
    }
  }, 180_000);

  test('a live preparing journal cannot be recovered, removed, or overwritten by a concurrent builder', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'knowledge-v8-active-builder-'));
    const workspace = join(parent, 'workspace');
    const home = join(parent, 'home');
    copyRepository(workspace);
    const before = generatedDigest(workspace);
    const first = Bun.spawn(['bun', 'scripts/build.mjs'], {
      cwd: workspace,
      env: localEnv(home, { KNOWLEDGE_BUILD_INJECT_STOP_AFTER_PREPARING: '1' }),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const stage = waitForPreparingStage(workspace, first.pid);
      waitForStoppedProcess(first.pid);
      expect(existsSync(join(workspace, buildLockName))).toBe(true);
      const markerPath = join(workspace, stage, transactionMarkerName);
      const markerBefore = readFileSync(markerPath);

      const second = runBuild(workspace, home);
      expect(second.exitCode).not.toBe(0);
      expect(new TextDecoder().decode(second.stderr)).toMatch(/active build|active transaction|owned by/i);
      expect(existsSync(markerPath), 'concurrent builder deleted the active journal').toBe(true);
      expect(readFileSync(markerPath)).toEqual(markerBefore);
      expect(generatedDigest(workspace)).toBe(before);

      process.kill(first.pid, 'SIGKILL');
      await first.exited;
      const recovered = runBuild(workspace, home);
      expect(recovered.exitCode, new TextDecoder().decode(recovered.stderr)).toBe(0);
      expect(generatedDigest(workspace)).toBe(before);
      expect(buildStages(workspace)).toEqual([]);
      expect(existsSync(join(workspace, buildLockName))).toBe(false);
    } finally {
      if (processExists(first.pid)) process.kill(first.pid, 'SIGKILL');
      await first.exited;
      rmSync(parent, { recursive: true, force: true });
    }
  }, 180_000);

  test('dead owners recover valid, torn, and malformed preparing journals, while malformed ownership fails closed', async () => {
    for (const journal of ['torn', 'malformed'] as const) {
      const parent = mkdtempSync(join(tmpdir(), `knowledge-v8-${journal}-journal-`));
      const workspace = join(parent, 'workspace');
      const home = join(parent, 'home');
      copyRepository(workspace);
      const before = generatedDigest(workspace);
      const builder = Bun.spawn(['bun', 'scripts/build.mjs'], {
        cwd: workspace,
        env: localEnv(home, { KNOWLEDGE_BUILD_INJECT_STOP_AFTER_PREPARING: '1' }),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      try {
        const stage = waitForPreparingStage(workspace, builder.pid);
        waitForStoppedProcess(builder.pid);
        expect(existsSync(join(workspace, buildLockName))).toBe(true);
        process.kill(builder.pid, 'SIGKILL');
        await builder.exited;
        const marker = join(workspace, stage, transactionMarkerName);
        writeFileSync(marker, journal === 'torn'
          ? '{"version":2,"phase":"preparing"'
          : `${JSON.stringify({ version: 2, phase: 'unknown', replacements: [] })}\n`);
        const recovered = runBuild(workspace, home);
        expect(recovered.exitCode, `${journal}: ${new TextDecoder().decode(recovered.stderr)}`).toBe(0);
        expect(generatedDigest(workspace), journal).toBe(before);
        expect(buildStages(workspace), journal).toEqual([]);
        expect(existsSync(join(workspace, buildLockName)), journal).toBe(false);
      } finally {
        if (processExists(builder.pid)) process.kill(builder.pid, 'SIGKILL');
        await builder.exited;
        rmSync(parent, { recursive: true, force: true });
      }
    }

    const parent = mkdtempSync(join(tmpdir(), 'knowledge-v8-malformed-owner-'));
    const workspace = join(parent, 'workspace');
    const home = join(parent, 'home');
    copyRepository(workspace);
    const before = generatedDigest(workspace);
    const lock = join(workspace, buildLockName);
    writeFileSync(lock, '{malformed-owner', { mode: 0o600 });
    try {
      const rejected = runBuild(workspace, home);
      expect(rejected.exitCode).not.toBe(0);
      expect(new TextDecoder().decode(rejected.stderr)).toMatch(/ownership.*invalid|invalid.*ownership/i);
      expect(readFileSync(lock, 'utf8')).toBe('{malformed-owner');
      expect(generatedDigest(workspace)).toBe(before);
      expect(buildStages(workspace)).toEqual([]);

      unlinkSync(lock);
      const clean = runBuild(workspace, home);
      expect(clean.exitCode, new TextDecoder().decode(clean.stderr)).toBe(0);
      expect(generatedDigest(workspace)).toBe(before);
      expect(buildStages(workspace)).toEqual([]);
      expect(existsSync(lock)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, 240_000);
});
