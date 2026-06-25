import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateKnowledgeDb, openKnowledgeDb } from '../src/knowledge-db';
import { provenanceStatusFor } from '../src/provenance-validate';
import { recordStorageObjects, resolveStorageContract } from '../src/storage-contract';
import { defaultKnowledgeConfig, workspaceForHome } from '../src/workspace';

function localStorage(dir: string) {
  return resolveStorageContract(defaultKnowledgeConfig(), workspaceForHome(dir), 'project');
}

describe('knowledge provenance validator', () => {
  test('accepts wiki catalog rows backed by storage_objects provenance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-provenance-valid-'));
    const dbPath = join(dir, 'knowledge.db');
    const storage = localStorage(dir);
    const artifactUri = `${storage.artifact_store.uri_prefix}wiki/README.md`;
    migrateKnowledgeDb(dbPath);

    const db = openKnowledgeDb(dbPath);
    try {
      recordStorageObjects(db, [{
        key: 'wiki/README.md',
        uri: artifactUri,
        kind: 'wiki_page',
        content_type: 'text/markdown',
        hash: 'sha256:readme',
        size_bytes: 128,
        metadata: {
          provenance: {
            generated_from: 'wiki_layout_init',
            artifact_key: 'wiki/README.md',
          },
        },
      }]);
      db.run(
        `INSERT INTO wiki_pages (
          id, path, title, artifact_uri, content_hash, status, metadata_json,
          valid_from, valid_to, supersedes, superseded_by, confidence, last_verified_at,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'wiki_readme',
        'wiki/README.md',
        'Wiki',
        artifactUri,
        'sha256:readme',
        'active',
        JSON.stringify({
          artifact_key: 'wiki/README.md',
          provenance: {
            generated_from: 'wiki_layout_init',
            artifact_key: 'wiki/README.md',
          },
        }),
        '2026-06-08T00:00:00.000Z',
        null,
        null,
        null,
        0.8,
        '2026-06-08T00:00:00.000Z',
        '2026-06-08T00:00:00.000Z',
        '2026-06-08T00:00:00.000Z',
      );
    } finally {
      db.close();
    }

    const status = provenanceStatusFor(dbPath, storage);
    expect(status.ok).toBe(true);
    expect(status.counts.storage_objects).toBe(1);
    expect(status.counts.wiki_pages).toBe(1);
    expect(status.counts.errors).toBe(0);
  });

  test('rejects active wiki pages that bypass storage_objects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-provenance-missing-storage-'));
    const dbPath = join(dir, 'knowledge.db');
    const storage = localStorage(dir);
    migrateKnowledgeDb(dbPath);

    const db = openKnowledgeDb(dbPath);
    try {
      db.run(
        `INSERT INTO wiki_pages (
          id, path, title, artifact_uri, content_hash, status, metadata_json,
          valid_from, valid_to, supersedes, superseded_by, confidence, last_verified_at,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'wiki_direct',
        'wiki/direct.md',
        'Direct',
        `${storage.artifact_store.uri_prefix}wiki/direct.md`,
        'sha256:direct',
        'active',
        JSON.stringify({ artifact_key: 'wiki/direct.md' }),
        '2026-06-08T00:00:00.000Z',
        null,
        null,
        null,
        0.8,
        '2026-06-08T00:00:00.000Z',
        '2026-06-08T00:00:00.000Z',
        '2026-06-08T00:00:00.000Z',
      );
    } finally {
      db.close();
    }

    const status = provenanceStatusFor(dbPath, storage);
    expect(status.ok).toBe(false);
    expect(status.issues.some((issue) => issue.code === 'wiki_page_missing_storage_object')).toBe(true);
  });

  test('rejects wiki page artifact key mismatches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-provenance-key-mismatch-'));
    const dbPath = join(dir, 'knowledge.db');
    const storage = localStorage(dir);
    const artifactUri = `${storage.artifact_store.uri_prefix}wiki/right.md`;
    migrateKnowledgeDb(dbPath);

    const db = openKnowledgeDb(dbPath);
    try {
      recordStorageObjects(db, [{
        key: 'wiki/wrong-storage.md',
        uri: artifactUri,
        kind: 'wiki_page',
        content_type: 'text/markdown',
        hash: 'sha256:right',
        size_bytes: 128,
        metadata: {
          provenance: {
            generated_from: 'test',
            artifact_key: 'wiki/wrong-storage.md',
          },
        },
      }]);
      db.run(
        `INSERT INTO wiki_pages (
          id, path, title, artifact_uri, content_hash, status, metadata_json,
          valid_from, valid_to, supersedes, superseded_by, confidence, last_verified_at,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'wiki_key_mismatch',
        'wiki/right.md',
        'Right',
        artifactUri,
        'sha256:right',
        'active',
        JSON.stringify({ artifact_key: 'wiki/wrong-page.md' }),
        '2026-06-08T00:00:00.000Z',
        null,
        null,
        null,
        0.8,
        '2026-06-08T00:00:00.000Z',
        '2026-06-08T00:00:00.000Z',
        '2026-06-08T00:00:00.000Z',
      );
    } finally {
      db.close();
    }

    const status = provenanceStatusFor(dbPath, storage);
    expect(status.ok).toBe(false);
    expect(status.issues.some((issue) => issue.code === 'wiki_page_artifact_key_mismatch')).toBe(true);
    expect(status.issues.some((issue) => issue.code === 'wiki_page_storage_key_mismatch')).toBe(true);
  });
});
