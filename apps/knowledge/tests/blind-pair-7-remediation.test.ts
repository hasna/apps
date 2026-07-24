import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sourceRoot from '../src/index.ts';
import * as builtRoot from '../dist/index.js';
import * as sourceStorage from '../src/storage.ts';
import * as builtStorage from '../dist/storage.js';
import { LocalArtifactStore } from '../src/artifact-store.ts';
import { assertContainedSourceGraph, assertClassifiedSourceReference } from '../src/public-guard.ts';
import { buildServer } from '../src/mcp.js';
import { createAppWikiScope, createKnowledgeClient } from '../src/sdk.ts';
import { assertWebSearchAllowed } from '../src/safety.ts';
import { MAX_KNOWLEDGE_DIAGNOSTIC_BYTES } from '../src/runtime-role.ts';
import {
  createOperatorWebSearchCapability,
  runOperatorWebSearch,
} from '../scripts/private/operator-web-search.ts';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env.ts';
import instanceReflection from './fixtures/public-instance-reflection-e1eed58.json' with { type: 'json' };

const root = join(import.meta.dir, '..');

async function expectContained(operation: () => unknown | Promise<unknown>): Promise<unknown> {
  try {
    await operation();
    throw new Error('expected Stage-A containment');
  } catch (error) {
    expect(error).toMatchObject({ name: 'KnowledgeContainmentError', status: 503 });
    return error;
  }
}

function hostile(reads: { count: number }): object {
  return new Proxy({}, {
    get() { reads.count += 1; throw new Error('getter tripwire'); },
    ownKeys() { reads.count += 1; throw new Error('enumeration tripwire'); },
    getOwnPropertyDescriptor() { reads.count += 1; throw new Error('descriptor tripwire'); },
  });
}

function descriptorShape(value: object, key: string) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? {
    value: descriptor.value ?? null,
    value_kind: typeof descriptor.value,
    enumerable: descriptor.enumerable,
    configurable: descriptor.configurable,
    writable: descriptor.writable,
  } : descriptor;
}

describe('blind-pair-7 accepted remediation', () => {
  test('base inert reflection is preserved for repo, ledger, and kit constant', () => {
    expect(instanceReflection).toMatchObject({
      version: 1,
      base_commit: 'e1eed58db9157f150eefc4d2a29810199ecc9b46',
    });
    for (const rootSurface of [sourceRoot, builtRoot]) {
      const reads = { count: 0 };
      const repo = new rootSurface.NoteRepo(hostile(reads) as never);
      expect(reads.count).toBe(0);
      const pinned = instanceReflection.instances['root.NoteRepo'];
      expect(Object.getOwnPropertyNames(repo).sort()).toEqual(pinned.own_keys);
      expect(descriptorShape(repo, 'client')).toEqual(pinned.descriptors.client);
    }

    for (const storageSurface of [sourceStorage, builtStorage]) {
      const reads = { count: 0 };
      const ledger = new storageSurface.MigrationLedger(
        hostile(reads) as never,
        hostile(reads) as never,
      );
      expect(reads.count).toBe(0);
      expect(storageSurface.KIT_VERSION).toBe(instanceReflection.constants['storage.KIT_VERSION']);
      const pinned = instanceReflection.instances['storage.MigrationLedger'];
      expect(Object.getOwnPropertyNames(ledger).sort()).toEqual(pinned.own_keys);
      for (const key of pinned.own_keys) {
        expect(descriptorShape(ledger, key)).toEqual(
          pinned.descriptors[key as keyof typeof pinned.descriptors],
        );
      }
    }
  });

  test('web MCP tools retain base schemas while explicitly unavailable', () => {
    const tools = (buildServer({ cwd: root, env: {} }) as unknown as {
      _registeredTools: Record<string, {
        description: string;
        inputSchema: { shape: Record<string, unknown>; safeParse(input: unknown): { success: boolean } };
      }>;
    })._registeredTools;
    for (const name of ['knowledge_web_search', 'ok_web_search']) {
      const tool = tools[name];
      expect(Object.keys(tool.inputSchema.shape).sort()).toEqual([
        'domains', 'fake', 'file_results', 'limit', 'model', 'provider', 'query', 'scope',
      ]);
      expect(tool.inputSchema.safeParse({ query: 'synthetic' }).success).toBe(true);
      expect(tool.inputSchema.safeParse({}).success).toBe(false);
      expect(tool.description.toLowerCase()).toContain('unavailable');
      expect(tool.description.toLowerCase()).toContain('fake');
    }
  });

  test('web metadata help remains dependency-light under hosted intent', () => {
    for (const entry of ['src/cli.ts', 'bin/knowledge.js']) {
      for (const args of [['web', '--help'], ['help', 'web']]) {
        const fixture = mkdtempSync(join(tmpdir(), 'knowledge-web-help-'));
        const home = join(fixture, 'home');
        try {
          const result = Bun.spawnSync(['bun', join(root, entry), ...args], {
            cwd: fixture,
            env: sanitizedLocalTestEnv({
              HOME: home,
              USERPROFILE: home,
              HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted',
              BUN_CONFIG_INSTALL_AUTO: 'disable',
            }),
            stdout: 'pipe',
            stderr: 'pipe',
          });
          const output = `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;
          expect(result.exitCode, `${entry}:${args.join(' ')}:${output}`).toBe(0);
          expect(output).toContain('Usage: knowledge web search');
          expect(output.toLowerCase()).toContain('unavailable during stage a');
          expect(existsSync(join(fixture, '.hasna'))).toBe(false);
          expect(existsSync(join(home, '.hasna'))).toBe(false);
        } finally {
          rmSync(fixture, { recursive: true, force: true });
        }
      }
    }
  });

  test('the private web-search alternate path is typed containment with zero argument reads', async () => {
    const reads = { count: 0 };
    await expectContained(() => createOperatorWebSearchCapability());
    await expectContained(() => runOperatorWebSearch(
      hostile(reads) as never,
      hostile(reads) as never,
    ));
    await expectContained(() => assertWebSearchAllowed(hostile(reads) as never));
    expect(reads.count).toBe(0);
  });

  test('encoded, case, acronym, and separator aliases are contained without leaking labels', async () => {
    const aliases = [
      'SOURCEURL',
      'SoUrCeUrL',
      'source%5Furl',
      'source%55rl',
      'mystery%5Fref',
      'serviceURI',
      'arbitrary-ref',
      'endpoint.dsn',
      'remote_host',
      'nested-domain',
      'source path',
      'databaseDSN',
      'originHost',
      'source%255Furl',
      'source%ZZurl',
    ];
    for (const alias of aliases) {
      const marker = `marker-${alias}-must-not-leak`;
      const error = await expectContained(() => assertContainedSourceGraph({
        nested: { [alias]: `https://${marker}.invalid/path` },
      }));
      const serialized = JSON.stringify((error as { toJSON?: () => unknown }).toJSON?.() ?? error);
      expect(serialized).not.toContain(marker);
      expect(serialized).not.toContain(alias);
      expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(
        MAX_KNOWLEDGE_DIAGNOSTIC_BYTES,
      );
    }
  });

  test('source diagnostics are bounded and accessor labels are never invoked or echoed', async () => {
    const marker = 'diagnostic-marker-must-not-leak';
    const scheme = `x${marker.repeat(700)}`;
    const error = await expectContained(() => assertClassifiedSourceReference(`${scheme}:value`));
    const serialized = JSON.stringify((error as { toJSON?: () => unknown }).toJSON?.() ?? error);
    expect(serialized).not.toContain(marker);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(
      MAX_KNOWLEDGE_DIAGNOSTIC_BYTES,
    );

    let getterCalls = 0;
    const accessor = Object.defineProperty({}, marker, {
      enumerable: true,
      get() { getterCalls += 1; return 'https://remote.invalid'; },
    });
    const accessorError = await expectContained(() => assertContainedSourceGraph(accessor));
    expect(getterCalls).toBe(0);
    expect(JSON.stringify((accessorError as { toJSON?: () => unknown }).toJSON?.() ?? accessorError))
      .not.toContain(marker);
  });

  test('ambient authority is decided before local-store and SDK caller options', async () => {
    const previous = process.env.HASNA_KNOWLEDGE_STORAGE_MODE;
    const reads = { count: 0 };
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-authority-first-'));
    try {
      process.env.HASNA_KNOWLEDGE_STORAGE_MODE = 'hosted';
      await expectContained(() => new (LocalArtifactStore as unknown as {
        new(root: string, options: object): LocalArtifactStore;
      })(join(fixture, 'artifacts'), hostile(reads)));
      expect(reads.count).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.HASNA_KNOWLEDGE_STORAGE_MODE;
      else process.env.HASNA_KNOWLEDGE_STORAGE_MODE = previous;
      rmSync(fixture, { recursive: true, force: true });
    }

    const env: Record<string, string | undefined> = {};
    const client = createKnowledgeClient({ scope: 'project', cwd: root, env } as never);
    env.HASNA_KNOWLEDGE_STORAGE_MODE = 'hosted';
    for (const operation of [
      () => client.ask('synthetic', hostile(reads) as never),
      () => client.build('synthetic', hostile(reads) as never),
    ]) await expectContained(operation);
    expect(reads.count).toBe(0);
  });

  test('MCP sourceGraph and app-wiki defaults are untouched before authority disposition', async () => {
    const previous = process.env.HASNA_KNOWLEDGE_STORAGE_MODE;
    const reads = { count: 0 };
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-authority-source-graph-'));
    try {
      delete process.env.HASNA_KNOWLEDGE_STORAGE_MODE;
      const wiki = createAppWikiScope({ scope: 'project', cwd: fixture, env: {} } as never);
      process.env.HASNA_KNOWLEDGE_STORAGE_MODE = 'hosted';
      await expectContained(() => wiki.sources.add(hostile(reads) as never));
      expect(reads.count).toBe(0);

      const tools = (buildServer({ cwd: fixture, env: {} }) as unknown as {
        _registeredTools: Record<string, {
          handler(input: unknown): Promise<{ content?: Array<{ text?: string }>; isError?: boolean }>;
        }>;
      })._registeredTools;
      const result = await tools.knowledge_resolve_source.handler(hostile(reads));
      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain('KNOWLEDGE_HOSTED_CONTAINED');
      expect(reads.count).toBe(0);
      expect(existsSync(join(fixture, '.hasna'))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.HASNA_KNOWLEDGE_STORAGE_MODE;
      else process.env.HASNA_KNOWLEDGE_STORAGE_MODE = previous;
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
