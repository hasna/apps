import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openKnowledgeDb } from '../src/knowledge-db';
import { ingestOpenFilesManifest } from '../src/manifest-ingest';
import { consumeOpenFilesOutbox } from '../src/outbox-consume';
import { resolveOpenFilesSource } from '../src/source-resolver';

const here = dirname(fileURLToPath(import.meta.url));
const contractPath = join(here, 'fixtures', 'open-files-knowledge-contract-v1.json');

interface ContractFixture {
  contract_version: number;
  producer: string;
  consumer: string;
  optional_sibling_policy: string;
  manifest_required_fields: string[];
  outbox_required_fields: string[];
  raw_sentinel: string;
  manifest_items: Array<Record<string, unknown>>;
  outbox_events: Array<Record<string, unknown>>;
}

function loadContract(): ContractFixture {
  return JSON.parse(readFileSync(contractPath, 'utf8')) as ContractFixture;
}

describe('versioned open-files to knowledge contract', () => {
  test('the required in-repo contract is versioned and structurally complete', () => {
    const contract = loadContract();
    expect(contract.contract_version).toBe(1);
    expect(contract.producer).toBe('open-files');
    expect(contract.consumer).toBe('@hasna/knowledge');
    expect(contract.optional_sibling_policy).toContain('must not skip');
    for (const field of contract.manifest_required_fields) {
      expect(contract.manifest_items.every((item) => field in item)).toBe(true);
    }
    for (const field of contract.outbox_required_fields) {
      expect(contract.outbox_events.every((event) => field in event)).toBe(true);
    }
  });

  test('ingests and invalidates the required contract without retaining raw bytes', async () => {
    const contract = loadContract();
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-open-files-contract-'));
    const dbPath = join(dir, 'knowledge.db');
    const manifestPath = join(dir, 'manifest.jsonl');
    const outboxPath = join(dir, 'outbox.jsonl');
    try {
      writeFileSync(
        manifestPath,
        `${contract.manifest_items.map((item) => JSON.stringify(item)).join('\n')}\n`,
      );
      const ingested = await ingestOpenFilesManifest({ dbPath, input: manifestPath });
      expect(ingested.items_seen).toBe(contract.manifest_items.length);
      expect(ingested.chunks_inserted).toBe(1);

      const sourceRef = String(contract.manifest_items[0]?.source_ref);
      const resolved = await resolveOpenFilesSource({
        dbPath,
        sourceRef,
        purpose: 'knowledge_index',
      });
      expect(resolved.resolved).toBe(true);
      expect(resolved.chunks).toHaveLength(1);
      expect(JSON.stringify(resolved)).not.toContain(contract.raw_sentinel);

      const db = openKnowledgeDb(dbPath);
      try {
        const persisted = [
          ...db.query<{ text: string }, []>('SELECT text FROM chunks').all().map((row) => row.text),
          ...db.query<{ metadata_json: string }, []>('SELECT metadata_json FROM sources').all()
            .map((row) => row.metadata_json),
          ...db.query<{ metadata_json: string }, []>('SELECT metadata_json FROM source_revisions').all()
            .map((row) => row.metadata_json),
        ].join('\n');
        expect(persisted).not.toContain(contract.raw_sentinel);
      } finally {
        db.close();
      }

      writeFileSync(
        outboxPath,
        `${contract.outbox_events.map((event) => JSON.stringify(event)).join('\n')}\n`,
      );
      const invalidated = await consumeOpenFilesOutbox({ dbPath, input: outboxPath });
      expect(invalidated.events_seen).toBe(contract.outbox_events.length);
      expect(invalidated.chunks_deleted).toBe(1);
      expect(invalidated.deleted_sources).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a deliberately incompatible sibling checkout cannot affect the required contract', () => {
    const contract = loadContract();
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-incompatible-sibling-'));
    try {
      const sibling = join(fixture, 'open-files', 'src', 'lib');
      mkdirSync(sibling, { recursive: true });
      writeFileSync(
        join(sibling, 'knowledge-sync-fixtures.ts'),
        "throw new Error('incompatible sibling must never be imported');\n",
      );
      process.env.KNOWLEDGE_OPEN_FILES_SIBLING = join(fixture, 'open-files');
      expect(loadContract()).toEqual(contract);
      expect(contract.optional_sibling_policy).toBe(
        'informational-only; sibling absence must not skip required contract tests',
      );
      const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
      const forbiddenSiblingTraversal = ['..', '..', 'open-files'].join('/');
      expect(source).not.toContain(forbiddenSiblingTraversal);
      expect(source).not.toContain(['path', 'ToFile', 'URL'].join(''));
    } finally {
      delete process.env.KNOWLEDGE_OPEN_FILES_SIBLING;
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
