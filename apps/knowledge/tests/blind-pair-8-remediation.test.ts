import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as sourceRoot from '../src/index.ts';
import * as builtRoot from '../dist/index.js';
import {
  MAX_INGEST_BATCH_ITEMS,
  MAX_INGEST_BODY_BYTES,
  cloneBoundedDataGraph,
} from '../src/input-limits.ts';
import { saveStore as saveSourceStore } from '../src/store.ts';

const root = join(import.meta.dir, '..');

type CloneBounded = <Value>(
  value: Value,
  options?: { readonly label?: string; readonly maxBytes?: number },
) => Value;
type SaveStore = (path: string, store: { items: unknown[] }) => void;

let builtInternalsPromise: Promise<{
  clone: CloneBounded;
  saveStore: SaveStore;
}> | undefined;

function builtInternals(): Promise<{ clone: CloneBounded; saveStore: SaveStore }> {
  builtInternalsPromise ??= (async () => {
    const temporary = mkdtempSync(join(root, '.knowledge-built-internals-'));
    const modulePath = join(temporary, 'index-with-test-exports.mjs');
    try {
      const bundled = readFileSync(join(root, 'dist', 'index.js'), 'utf8');
      writeFileSync(
        modulePath,
        `${bundled}\nexport { cloneBoundedDataGraph as __cloneBoundedDataGraph, saveStore as __saveStore };\n`,
      );
      const loaded = await import(`${pathToFileURL(modulePath).href}?blind-pair-8`);
      return {
        clone: loaded.__cloneBoundedDataGraph as CloneBounded,
        saveStore: loaded.__saveStore as SaveStore,
      };
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  })();
  return builtInternalsPromise;
}

function interfaceMembers(text: string, name: string): string[] {
  const match = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(text);
  if (!match) throw new Error(`missing ${name}`);
  return [...match[1].matchAll(/^\s+(?:readonly\s+)?([A-Za-z_$][\w$]*)\??:/gm)]
    .map((entry) => entry[1]);
}

async function expectStageAContained(
  operation: () => unknown | Promise<unknown>,
  label = 'source data',
): Promise<void> {
  try {
    await operation();
    throw new Error('expected Stage-A source containment');
  } catch (error) {
    expect(error, label).toMatchObject({
      name: 'KnowledgeContainmentError',
      code: 'KNOWLEDGE_HOSTED_CONTAINED',
      status: 503,
    });
  }
}

function expectNoDatabaseOrWorkspace(fixture: string, dbPath: string): void {
  expect(existsSync(dbPath)).toBe(false);
  expect(existsSync(`${dbPath}-wal`)).toBe(false);
  expect(existsSync(`${dbPath}-shm`)).toBe(false);
  expect(existsSync(join(fixture, '.hasna'))).toBe(false);
}

function encodedBytes(value: unknown, space?: number): number {
  return Buffer.byteLength(JSON.stringify(value, null, space));
}

function exactEncodedStore(bytes: number): { items: unknown[]; padding: string } {
  const empty = { items: [], padding: '' };
  const padding = bytes - encodedBytes(empty, 2);
  if (padding < 0) throw new Error('requested store boundary is too small');
  const store = { items: [], padding: 'x'.repeat(padding) };
  if (encodedBytes(store, 2) !== bytes) throw new Error('store boundary fixture drifted');
  return store;
}

function invalidJsonDataCases(): Array<[string, () => unknown]> {
  return [
    ['root undefined', () => undefined],
    ['object undefined', () => ({ value: undefined })],
    ['array undefined', () => [undefined]],
    ['array hole', () => {
      const value = Array(2);
      value[0] = 'present';
      return value;
    }],
    ['array leading-zero key', () => {
      const value = ['present'];
      Object.defineProperty(value, '01', {
        value: 'must-not-overwrite', enumerable: true, writable: true, configurable: true,
      });
      return value;
    }],
    ['array out-of-range numeric-like key', () => {
      const value = ['present'];
      Object.defineProperty(value, '4294967295', {
        value: 'must-not-drop', enumerable: true, writable: true, configurable: true,
      });
      return value;
    }],
    ['array string key', () => {
      const value = ['present'];
      Object.defineProperty(value, 'extra', {
        value: 'must-not-drop', enumerable: true, writable: true, configurable: true,
      });
      return value;
    }],
    ['array symbol key', () => {
      const value = ['present'];
      Object.defineProperty(value, Symbol('extra'), {
        value: 'must-not-drop', enumerable: true, writable: true, configurable: true,
      });
      return value;
    }],
    ['array index descriptor anomaly', () => {
      const value = ['present'];
      Object.defineProperty(value, '0', {
        value: 'present', enumerable: false, writable: true, configurable: true,
      });
      return value;
    }],
    ['array length descriptor anomaly', () => {
      const value = ['present'];
      Object.defineProperty(value, 'length', { writable: false });
      return value;
    }],
    ['array accessor', () => {
      const value = ['present'];
      Object.defineProperty(value, '0', {
        enumerable: true, configurable: true, get() { return 'must-not-read'; },
      });
      return value;
    }],
  ];
}

describe('blind-pair-8 remediation contracts', () => {
  test('outbox options retain only the exact base-compatible five-member surface', () => {
    const expected = ['dbPath', 'input', 'config', 'safetyPolicy', 'now'];
    const source = readFileSync(join(root, 'src', 'outbox-consume.ts'), 'utf8');
    const committed = readFileSync(join(root, 'dist', 'outbox-consume.d.ts'), 'utf8');
    expect(interfaceMembers(source, 'OutboxConsumeOptions')).toEqual(expected);
    expect(interfaceMembers(committed, 'OutboxConsumeOptions')).toEqual(expected);
    expect(readFileSync(join(root, 'src', 'index.ts'), 'utf8'))
      .toContain("export type { OutboxConsumeOptions, OutboxConsumeResult } from './outbox-consume.js';");
    expect(readFileSync(join(root, 'dist', 'index.d.ts'), 'utf8'))
      .toContain("export type { OutboxConsumeOptions, OutboxConsumeResult } from './outbox-consume.js';");
  });

  test('outbox runtime ignores legacy limit knobs and applies the fixed event ceiling', async () => {
    for (const [surface, api] of [
      ['source', sourceRoot],
      ['committed', builtRoot],
    ] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-outbox-fixed-${surface}-`));
      const dbPath = join(fixture, 'knowledge.db');
      const input = join(fixture, 'outbox.json');
      const event = {
        event: 'changed',
        source_ref: 'open-files://file/blind-pair-8-fixed-limit',
      };
      writeFileSync(input, JSON.stringify(
        Array.from({ length: MAX_INGEST_BATCH_ITEMS + 1 }, () => event),
      ));
      try {
        try {
          await api.consumeOpenFilesOutbox({
            dbPath,
            input,
            maxEvents: MAX_INGEST_BATCH_ITEMS + 100,
            maxInputBytes: MAX_INGEST_BODY_BYTES + 100,
          } as never);
          throw new Error('expected fixed outbox hard limit');
        } catch (error) {
          expect(String(error)).toContain(String(MAX_INGEST_BATCH_ITEMS));
          expect(String(error)).not.toContain('maxEvents');
          expect(String(error)).not.toContain('maxInputBytes');
        }
        expectNoDatabaseOrWorkspace(fixture, dbPath);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  test('manifest and outbox source data traverse nested runtime-named containers before mutation', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('fetch tripwire');
    }) as unknown as typeof fetch;
    try {
      const containers = ['config', 'env', 'store', 'workspace'];
      const aliases = ['SourceURL', 'source-url', 'source%5Fref', 'remote%5Fhost'];
      for (const [surface, api] of [
        ['source', sourceRoot],
        ['committed', builtRoot],
      ] as const) {
        for (const container of containers) {
          for (const alias of aliases) {
            const fixture = mkdtempSync(join(tmpdir(), `knowledge-source-graph-${surface}-`));
            const dbPath = join(fixture, 'knowledge.db');
            const input = join(fixture, 'outbox.json');
            const nested = {
              [container]: [{ deeper: [{ [alias]: 'https://remote.invalid/blocked' }] }],
            };
            const sourceRef = 'open-files://file/blind-pair-8-source-graph';
            writeFileSync(input, JSON.stringify([{
              event: 'changed',
              source_ref: sourceRef,
              ...nested,
            }]));
            try {
              await expectStageAContained(() => api.ingestOpenFilesManifestItems({
                dbPath,
                sourceLabel: 'blind-pair-8-source-data',
                items: [{ source_ref: sourceRef, extracted_text: 'local text', ...nested }],
              } as never), `${surface}:manifest:${container}:${alias}`);
              expectNoDatabaseOrWorkspace(fixture, dbPath);
              await expectStageAContained(
                () => api.consumeOpenFilesOutbox({ dbPath, input }),
                `${surface}:outbox:${container}:${alias}`,
              );
              expectNoDatabaseOrWorkspace(fixture, dbPath);
            } finally {
              rmSync(fixture, { recursive: true, force: true });
            }
          }
        }
      }
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('source and committed graph clones charge exact expanded DAG bytes and preserve identity', async () => {
    const built = await builtInternals();
    for (const [surface, clone] of [
      ['source', cloneBoundedDataGraph as CloneBounded],
      ['committed', built.clone],
    ] as const) {
      const exactString = 'x'.repeat(126);
      expect(encodedBytes(exactString)).toBe(128);
      expect(clone(exactString, { maxBytes: 128 })).toBe(exactString);
      expect(() => clone(`${exactString}x`, { maxBytes: 128 }), surface)
        .toThrow('byte hard limit');

      const shared = { value: 'small-shared-value' };
      const graph = { left: shared, right: shared };
      const exact = encodedBytes(graph);
      const cloned = clone(graph, { maxBytes: exact });
      expect(cloned.left).toBe(cloned.right);
      expect(() => clone(graph, { maxBytes: exact - 1 }), surface)
        .toThrow('byte hard limit');

      const repeatedItem = { text: 'x'.repeat(16_384), tags: ['a', 'b'] };
      const repeated = { items: Array.from({ length: 64 }, () => repeatedItem) };
      expect(() => clone(repeated, { maxBytes: encodedBytes(repeated) - 1 }), surface)
        .toThrow('byte hard limit');

      const sharedArray = [shared, { value: 'array-member' }];
      const sharedArrayGraph = { left: sharedArray, right: sharedArray };
      const clonedArrayGraph = clone(sharedArrayGraph, {
        maxBytes: encodedBytes(sharedArrayGraph),
      });
      expect(clonedArrayGraph.left).toBe(clonedArrayGraph.right);
      expect(clonedArrayGraph.left[0]).toBe(clonedArrayGraph.right[0]);
      expect(() => clone(sharedArrayGraph, {
        maxBytes: encodedBytes(sharedArrayGraph) - 1,
      }), surface).toThrow('byte hard limit');

      const nestedShared = [{ rows: [shared, shared] }, { rows: [shared] }];
      const nested = clone(nestedShared, { maxBytes: encodedBytes(nestedShared) });
      expect(nested[0].rows[0]).toBe(nested[0].rows[1]);
      expect(nested[0].rows[0]).toBe(nested[1].rows[0]);
      expect(() => clone(nestedShared, { maxBytes: encodedBytes(nestedShared) - 1 }), surface)
        .toThrow('byte hard limit');

      const cycle: { self?: unknown } = {};
      cycle.self = cycle;
      expect(() => clone(cycle), surface).toThrow('cyclic graphs are unsupported');
    }
  });

  test('source and committed clones enforce strict JSON values and canonical dense arrays', async () => {
    const built = await builtInternals();
    for (const [surface, clone] of [
      ['source', cloneBoundedDataGraph as CloneBounded],
      ['committed', built.clone],
    ] as const) {
      for (const [name, create] of invalidJsonDataCases()) {
        expect(() => clone(create()), `${surface}: ${name}`).toThrow();
      }
      const shared = { value: 'preserved' };
      const dense = clone([shared, shared]);
      expect(dense).toEqual([{ value: 'preserved' }, { value: 'preserved' }]);
      expect(dense[0]).toBe(dense[1]);
    }
  });

  test('source and committed saveStore reject lossy data and cap final encoded bytes', async () => {
    const built = await builtInternals();
    for (const [surface, saveStore] of [
      ['source', saveSourceStore as unknown as SaveStore],
      ['committed', built.saveStore],
    ] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-save-store-${surface}-`));
      try {
        for (const [name, create] of invalidJsonDataCases()) {
          const path = join(fixture, `${name.replace(/[^a-z0-9]+/gi, '-')}.json`);
          expect(
            () => saveStore(path, { items: [], payload: create() } as never),
            `${surface}: ${name}`,
          ).toThrow();
          expect(existsSync(path)).toBe(false);
        }

        const exactPath = join(fixture, 'exact.json');
        saveStore(exactPath, exactEncodedStore(MAX_INGEST_BODY_BYTES) as never);
        expect(statSync(exactPath).size).toBe(MAX_INGEST_BODY_BYTES);

        const overflowPath = join(fixture, 'overflow.json');
        writeFileSync(overflowPath, 'unchanged');
        expect(() => saveStore(
          overflowPath,
          exactEncodedStore(MAX_INGEST_BODY_BYTES + 1) as never,
        )).toThrow('byte hard limit');
        expect(readFileSync(overflowPath, 'utf8')).toBe('unchanged');
        expect(readdirSync(fixture).some((name) => name.includes('.tmp.'))).toBe(false);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  }, 30_000);

  test('package and CI contracts require production declaration types and pinned offline typechecks', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const extraction = readFileSync(join(root, 'scripts', 'check-package-extraction.mjs'), 'utf8');
    const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    const compatibility = readFileSync(
      join(root, 'scripts', 'check-declaration-compatibility.mjs'),
      'utf8',
    );

    expect(pkg.dependencies['@types/pg']).toBe(pkg.devDependencies['@types/pg'] ?? '^8.15.6');
    expect(pkg.devDependencies['@types/pg']).toBeUndefined();
    expect(pkg.dependencies['@hasna/contracts']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies['@hasna/contracts']).toBeUndefined();
    expect(extraction).not.toContain('symlinkSync');
    expect(extraction).toContain("'--production'");
    expect(extraction).toContain("'--offline'");
    expect(extraction).toContain("'--frozen-lockfile'");
    expect(extraction).toContain('strict: true');
    expect(extraction).toContain('skipLibCheck: false');
    expect(extraction).toContain('runExpectFailure');
    expect(extraction).toContain('withheld-types-pg');
    expect(extraction).toContain('missing pg types');
    expect(extraction).toContain('withheld-hasna-contracts');
    expect(extraction).toContain('missing @hasna/contracts');
    expect(extraction).not.toMatch(/["']@hasna\/contracts(?:\/auth)?["']\s*:/);
    expect(extraction).not.toMatch(/["']@hasna\/knowledge(?:\/storage)?["']\s*:/);

    expect(ci).not.toMatch(/\bbunx\b/);
    expect(ci).not.toMatch(/BUN_CONFIG_INSTALL_AUTO:\s*(?:enable|true|1)/i);
    expect(ci.match(/BUN_CONFIG_INSTALL_AUTO:\s*disable/g)).toHaveLength(2);
    expect(ci).toContain('bun install --frozen-lockfile');
    expect(ci).toContain('BUN_CONFIG_INSTALL_AUTO: disable');
    expect(ci).toContain('bun node_modules/typescript/bin/tsc --noEmit');
    expect(ci).toContain('bun scripts/check-declaration-compatibility.mjs');
    expect(compatibility).toContain("node_modules', 'typescript', 'bin', 'tsc");
    expect(compatibility).toContain('noEmit: true');
    expect(compatibility).toContain("BUN_CONFIG_INSTALL_AUTO: 'disable'");
  });
});
