import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as sourceRoot from '../src/index.ts';
import * as builtRoot from '../dist/index.js';
import { consumeOpenFilesOutbox } from '../src/outbox-consume';
import {
  MAX_NORMALIZED_MANIFEST_AGGREGATE_BYTES,
  MAX_NORMALIZED_MANIFEST_ITEM_BYTES,
  ingestOpenFilesManifest,
  ingestOpenFilesManifestItems,
  normalizedManifestItemUtf8Bytes,
} from '../src/manifest-ingest';
import {
  MAX_INGEST_BATCH_ITEMS,
  MAX_INGEST_BODY_BYTES,
  assertBoundedJsonText,
  cloneBoundedDataGraph,
} from '../src/input-limits';
import { assertValidKnowledgeConfig, readValidatedKnowledgeConfig } from '../src/runtime-role';
import { defaultKnowledgeConfig } from '../src/workspace';

async function expectBounded(operation: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await operation();
    throw new Error('expected aggregate containment');
  } catch (error) {
    expect(error).toMatchObject({
      name: 'KnowledgeContainmentError',
      code: 'KNOWLEDGE_RUNTIME_INTENT_INVALID',
      status: 503,
    });
  }
}

function exactNormalizedManifestItem(
  id: string,
  targetBytes: number,
  character = 'x',
): Record<string, unknown> {
  for (let markerBytes = 0; markerBytes < 32; markerBytes += 1) {
    const base = {
      source_ref: `open-files://file/${id}/revision/rev`,
      padding: '',
      permissions: { marker: 'y'.repeat(markerBytes) },
    };
    const baseBytes = normalizedManifestItemUtf8Bytes(base);
    const step = normalizedManifestItemUtf8Bytes({ ...base, padding: character }) - baseBytes;
    const remainder = targetBytes - baseBytes;
    if (remainder >= 0 && remainder % step === 0) {
      const item = { ...base, padding: character.repeat(remainder / step) };
      expect(normalizedManifestItemUtf8Bytes(item)).toBe(targetBytes);
      return item;
    }
  }
  throw new Error(`Could not construct exact ${targetBytes}-byte normalized manifest item.`);
}

describe('hard aggregate limits before materialization or mutation', () => {
  for (const [surface, root] of [
    ['source', sourceRoot],
    ['dist', builtRoot],
  ] as const) {
    test(`${surface} public classifier bounds arrays, properties, nodes, bytes, and proxies`, async () => {
      const perObject = Object.fromEntries(
        Array.from({ length: 257 }, (_, index) => [`field_${index}`, index]),
      );
      const totalProperties = Array.from({ length: 33 }, (_, group) => Object.fromEntries(
        Array.from({ length: 256 }, (_, index) => [`field_${group}_${index}`, index]),
      ));
      const nodeFlood = Array.from({ length: 4_096 }, () => ({}));
      const byteFlood = 'x'.repeat(8_388_609);
      let proxyReads = 0;
      const proxy = new Proxy({}, {
        ownKeys() {
          proxyReads += 1;
          throw new Error('proxy enumeration tripwire');
        },
      });
      let accessorReads = 0;
      const accessor = Object.defineProperty({}, 'query', {
        enumerable: true,
        get() {
          accessorReads += 1;
          throw new Error('accessor tripwire');
        },
      });
      const sparse = Array(3);
      sparse[0] = 'first';
      sparse[2] = 'third';

      for (const options of [
        { payload: Array.from({ length: 4_097 }, () => null) },
        { payload: perObject },
        { payload: totalProperties },
        { payload: nodeFlood },
        { payload: byteFlood },
        { payload: proxy },
        { payload: sparse },
        accessor,
      ]) {
        await expectBounded(() => root.hybridSearch(options as any));
      }
      expect(proxyReads).toBe(0);
      expect(accessorReads).toBe(0);

      const fixture = mkdtempSync(join(tmpdir(), `knowledge-${surface}-opaque-graph-`));
      const dbPath = join(fixture, 'knowledge.db');
      const localRef = pathToFileURL(join(fixture, 'source.txt')).href;
      try {
        await expectBounded(() => root.ingestOpenFilesManifestItems({
          dbPath,
          sourceLabel: 'opaque-graph',
          items: [{
            source_ref: localRef,
            body: Array.from({ length: 4_097 }, () => ({})),
          }],
        } as any));
        await expect(root.ingestOpenFilesManifestItems({
          dbPath,
          sourceLabel: 'opaque-remote',
          items: [{ source_ref: localRef, body: { url: 'https://invalid.test/body' } }],
        } as any)).rejects.toMatchObject({ code: 'KNOWLEDGE_HOSTED_CONTAINED' });
        expect(existsSync(dbPath)).toBe(false);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }

  test('JSON pre-scan bounds bytes, object properties, arrays, nodes, and top-level batches', () => {
    expect(() => assertBoundedJsonText('x'.repeat(MAX_INGEST_BODY_BYTES + 1))).toThrow('byte hard limit');
    const wide = JSON.stringify(Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`field_${index}`, index]),
    ));
    expect(() => assertBoundedJsonText(wide)).toThrow('property hard limit');
    expect(() => assertBoundedJsonText(JSON.stringify(Array.from({ length: 3 }, () => 0)), 2))
      .toThrow('item hard limit');
    const nodes = JSON.stringify(Array.from({ length: 4_096 }, () => ({})));
    expect(() => assertBoundedJsonText(nodes)).toThrow('node hard limit');
    expect(() => assertBoundedJsonText('{}\n{}\n', 1, 1)).toThrow('top-level item hard limit');
  });

  test('remote response graphs are bounded and never invoke proxies or accessors', () => {
    let proxyReads = 0;
    const proxy = new Proxy({}, {
      ownKeys() {
        proxyReads += 1;
        throw new Error('remote proxy tripwire');
      },
    });
    let accessorReads = 0;
    const accessor = Object.defineProperty({}, 'sources', {
      enumerable: true,
      get() {
        accessorReads += 1;
        throw new Error('remote accessor tripwire');
      },
    });

    expect(() => cloneBoundedDataGraph(proxy, { label: 'Provider response' }))
      .toThrow('proxy inputs are unsupported');
    expect(() => cloneBoundedDataGraph(accessor, { label: 'Provider response' }))
      .toThrow('accessor properties are unsupported');
    expect(() => cloneBoundedDataGraph(
      Array.from({ length: MAX_INGEST_BATCH_ITEMS + 1 }, () => null),
      { label: 'Provider response' },
    )).toThrow('array exceeds');
    expect(() => cloneBoundedDataGraph('x'.repeat(MAX_INGEST_BODY_BYTES + 1), {
      label: 'Provider response',
    })).toThrow('byte hard limit');
    expect(proxyReads).toBe(0);
    expect(accessorReads).toBe(0);
    expect(readFileSync(join(import.meta.dir, '..', 'src', 'web-search.ts'), 'utf8'))
      .not.toContain("from './providers'");
  });

  test('bounded clones use null prototypes, reject dangerous keys/functions, and count keys', () => {
    const clone = cloneBoundedDataGraph({ nested: { value: 'safe' } });
    expect(Object.getPrototypeOf(clone)).toBeNull();
    expect(Object.getPrototypeOf((clone as any).nested)).toBeNull();
    const shared = { value: 'safe' };
    const dag = cloneBoundedDataGraph({ left: shared, right: shared }) as any;
    expect(dag.left).toEqual(dag.right);
    expect(dag.left).toBe(dag.right);
    const sparse = Array(3);
    sparse[0] = 'first';
    sparse[2] = 'third';
    expect(() => cloneBoundedDataGraph(sparse)).toThrow('sparse arrays are unsupported');
    const accessorArray = ['first'];
    Object.defineProperty(accessorArray, '0', { enumerable: true, get() { return 'blocked'; } });
    expect(() => cloneBoundedDataGraph(accessorArray)).toThrow('accessor properties are unsupported');
    for (const key of ['__proto__', 'prototype', 'constructor']) {
      const input = Object.create(null);
      Object.defineProperty(input, key, { enumerable: true, configurable: true, value: 'blocked' });
      expect(() => cloneBoundedDataGraph(input)).toThrow('dangerous key');
    }
    const customArray: unknown[] = [];
    Object.setPrototypeOf(customArray, Object.create(Array.prototype));
    expect(() => cloneBoundedDataGraph(customArray)).toThrow('custom prototypes');
    expect(() => cloneBoundedDataGraph({ callback() {} })).toThrow('unsupported non-data values');
    const hugeKey = Object.create(null);
    Object.defineProperty(hugeKey, 'k'.repeat(MAX_INGEST_BODY_BYTES + 1), {
      enumerable: true,
      value: true,
    });
    expect(() => cloneBoundedDataGraph(hugeKey)).toThrow('key byte');
  });

  test('config validation never invokes caller-owned array methods', () => {
    const config = defaultKnowledgeConfig() as any;
    let calls = 0;
    Object.defineProperty(config.sources.allowed_schemes, 'some', {
      enumerable: true,
      value() { calls += 1; return false; },
    });
    expect(() => assertValidKnowledgeConfig(config)).toThrow('KNOWLEDGE_CONFIG_INVALID');
    expect(calls).toBe(0);
  });

  test('persisted config bytes are rejected before malformed JSON parsing', () => {
    const hugeMalformed = `{"version":1,"padding":"${'x'.repeat(1_048_576)}`;
    expect(() => readValidatedKnowledgeConfig('/synthetic/config.json', {
      existsSync: () => true,
      readFileSync: () => hugeMalformed,
    })).toThrow('KNOWLEDGE_CONFIG_INVALID');
  });

  test('manifest and outbox reject raised limits, oversized batches, and remote inputs before DB creation', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-aggregate-input-'));
    const dbPath = join(fixture, 'knowledge.db');
    const manifestPath = join(fixture, 'manifest.jsonl');
    const outboxPath = join(fixture, 'outbox.jsonl');
    const oversizedOutboxPath = join(fixture, 'oversized-outbox.json');
    const manifestItem = {
      source_ref: 'open-files://file/aggregate/revision/rev-one',
      file_id: 'aggregate',
      revision_id: 'rev-one',
      hash: 'sha256:aggregate',
      status: 'active',
    };
    const outboxEvent = {
      event: 'changed',
      source_ref: manifestItem.source_ref,
      hash: manifestItem.hash,
      status: 'active',
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifestItem)}\n${JSON.stringify(manifestItem)}\n`);
    writeFileSync(outboxPath, `${JSON.stringify(outboxEvent)}\n${JSON.stringify(outboxEvent)}\n`);
    writeFileSync(oversizedOutboxPath, JSON.stringify(
      Array.from({ length: MAX_INGEST_BATCH_ITEMS + 1 }, () => outboxEvent),
    ));
    try {
      await expect(ingestOpenFilesManifest({
        dbPath,
        input: join(fixture, 'absent.jsonl'),
        maxItems: MAX_INGEST_BATCH_ITEMS + 1,
      })).rejects.toThrow('maxItems');
      await expect(consumeOpenFilesOutbox({
        dbPath,
        input: oversizedOutboxPath,
        maxEvents: MAX_INGEST_BATCH_ITEMS + 1,
      } as never)).rejects.toThrow(String(MAX_INGEST_BATCH_ITEMS));
      await expect(ingestOpenFilesManifest({ dbPath, input: manifestPath, maxItems: 1 }))
        .rejects.toThrow('top-level item hard limit');
      await expect(ingestOpenFilesManifest({ dbPath, input: 'https://invalid.test/manifest' }))
        .rejects.toMatchObject({ code: 'KNOWLEDGE_HOSTED_CONTAINED' });
      await expect(consumeOpenFilesOutbox({ dbPath, input: 's3://synthetic-bucket/outbox' }))
        .rejects.toMatchObject({ code: 'KNOWLEDGE_HOSTED_CONTAINED' });
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('post-normalization manifest bounds are exact for UTF-8 items, metadata expansion, aggregates, and shared DAGs', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-normalized-manifest-bounds-'));
    const dbPath = join(fixture, 'must-not-exist.db');
    const denyBeforePersistence = {
      mode: 'local',
      allowWriteRoots: [],
      readOnlySourceAccess: true,
      network: { webSearchEnabled: false, s3ReadsEnabled: false, allowedS3Buckets: [] },
      redaction: { enabled: true },
      approvals: { generatedWritesRequireApproval: true },
    } as const;
    try {
      const exactItem = exactNormalizedManifestItem('exact-item', MAX_NORMALIZED_MANIFEST_ITEM_BYTES);
      await expect(ingestOpenFilesManifestItems({
        dbPath,
        sourceLabel: 'exact-item',
        items: [exactItem],
        safetyPolicy: denyBeforePersistence as any,
      })).rejects.toThrow('Safety policy denied');

      const offByOneItem = exactNormalizedManifestItem(
        'off-by-one-item',
        MAX_NORMALIZED_MANIFEST_ITEM_BYTES + 1,
      );
      await expect(ingestOpenFilesManifestItems({
        dbPath,
        sourceLabel: 'off-by-one-item',
        items: [offByOneItem],
        safetyPolicy: denyBeforePersistence as any,
      })).rejects.toThrow(`item 0 exceeds the ${MAX_NORMALIZED_MANIFEST_ITEM_BYTES} byte hard limit`);

      const multibyte = exactNormalizedManifestItem(
        'multibyte-item',
        MAX_NORMALIZED_MANIFEST_ITEM_BYTES,
        'λ',
      );
      expect(Buffer.byteLength(String(multibyte.padding))).toBeGreaterThan(String(multibyte.padding).length);
      await expect(ingestOpenFilesManifestItems({
        dbPath,
        sourceLabel: 'multibyte-item',
        items: [multibyte],
        safetyPolicy: denyBeforePersistence as any,
      })).rejects.toThrow('Safety policy denied');

      const aggregateTargets = Array.from({ length: 8 }, (_, index) => (
        index < 7
          ? MAX_NORMALIZED_MANIFEST_ITEM_BYTES
          : MAX_NORMALIZED_MANIFEST_AGGREGATE_BYTES
            - 2
            - 7
            - (7 * MAX_NORMALIZED_MANIFEST_ITEM_BYTES)
      ));
      const exactAggregate = aggregateTargets.map((target, index) => (
        exactNormalizedManifestItem(`aggregate-${index}`, target)
      ));
      const exactAggregateBytes = 2
        + exactAggregate.reduce((sum, item) => sum + normalizedManifestItemUtf8Bytes(item), 0)
        + exactAggregate.length - 1;
      expect(exactAggregateBytes).toBe(MAX_NORMALIZED_MANIFEST_AGGREGATE_BYTES);
      await expect(ingestOpenFilesManifestItems({
        dbPath,
        sourceLabel: 'exact-aggregate',
        items: exactAggregate,
        safetyPolicy: denyBeforePersistence as any,
      })).rejects.toThrow('Safety policy denied');

      const aggregateOffByOne = [...exactAggregate];
      aggregateOffByOne[7] = exactNormalizedManifestItem(
        'aggregate-last-off-by-one',
        aggregateTargets[7] + 1,
      );
      await expect(ingestOpenFilesManifestItems({
        dbPath,
        sourceLabel: 'aggregate-off-by-one',
        items: aggregateOffByOne,
        safetyPolicy: denyBeforePersistence as any,
      })).rejects.toThrow(`aggregate exceeds the ${MAX_NORMALIZED_MANIFEST_AGGREGATE_BYTES} byte hard limit`);

      const expandedMetadata = {
        source_ref: 'open-files://file/expanded/revision/rev',
        details: { padding: 'm'.repeat(600_000) },
      };
      expect(Buffer.byteLength(JSON.stringify(expandedMetadata))).toBeLessThan(MAX_NORMALIZED_MANIFEST_ITEM_BYTES);
      expect(normalizedManifestItemUtf8Bytes(expandedMetadata)).toBeGreaterThan(MAX_NORMALIZED_MANIFEST_ITEM_BYTES);
      await expect(ingestOpenFilesManifestItems({
        dbPath,
        sourceLabel: 'metadata-expansion',
        items: [expandedMetadata],
      })).rejects.toThrow('Normalized manifest item');

      const shared = { padding: 's'.repeat(450_000) };
      const sharedDag = Array.from({ length: 10 }, (_, index) => ({
        source_ref: `open-files://file/shared-${index}/revision/rev`,
        details: shared,
      }));
      expect(sharedDag.every((item) => (
        normalizedManifestItemUtf8Bytes(item) < MAX_NORMALIZED_MANIFEST_ITEM_BYTES
      ))).toBe(true);
      await expect(ingestOpenFilesManifestItems({
        dbPath,
        sourceLabel: 'shared-dag',
        items: sharedDag,
      })).rejects.toThrow('Normalized manifest aggregate');
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('source and built public roots enforce the final normalized manifest item bound before persistence', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-built-normalized-manifest-bounds-'));
    const denyBeforePersistence = {
      mode: 'local',
      allowWriteRoots: [],
      readOnlySourceAccess: true,
      network: { webSearchEnabled: false, s3ReadsEnabled: false, allowedS3Buckets: [] },
      redaction: { enabled: true },
      approvals: { generatedWritesRequireApproval: true },
    } as const;
    const item = exactNormalizedManifestItem(
      'public-off-by-one-item',
      MAX_NORMALIZED_MANIFEST_ITEM_BYTES + 1,
    );
    try {
      for (const [surface, ingest] of [
        ['source', sourceRoot.ingestOpenFilesManifestItems],
        ['dist', builtRoot.ingestOpenFilesManifestItems],
      ] as const) {
        const dbPath = join(fixture, `${surface}-must-not-exist.db`);
        await expect(ingest({
          dbPath,
          sourceLabel: `${surface}-off-by-one-item`,
          items: [item],
          safetyPolicy: denyBeforePersistence as any,
        })).rejects.toThrow(`item 0 exceeds the ${MAX_NORMALIZED_MANIFEST_ITEM_BYTES} byte hard limit`);
        expect(existsSync(dbPath)).toBe(false);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
