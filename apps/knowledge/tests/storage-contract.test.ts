import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateKnowledgeDb, openKnowledgeDb } from '../src/knowledge-db';
import {
  artifactKindForKey,
  hashArtifactBody,
  recordStorageObjects,
  resolveStorageContract,
  validateStorageConfig,
} from '../src/storage-contract';
import { canonicalHasnaXyzKnowledgeStorage, defaultKnowledgeConfig, workspaceForHome } from '../src/workspace';

describe('knowledge storage contract', () => {
  test('describes local .hasna/apps/knowledge ownership and generated artifact classes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-storage-contract-'));
    const workspace = workspaceForHome(join(dir, '.hasna', 'apps', 'knowledge'));
    const config = defaultKnowledgeConfig();

    const contract = resolveStorageContract(config, workspace, 'project');
    const validation = validateStorageConfig(config, workspace);

    expect(validation.ok).toBe(true);
    expect(contract.scope).toBe('project');
    expect(contract.local_layout.app_path).toBe(join('.hasna', 'apps', 'knowledge'));
    expect(contract.local_layout.knowledge_db_path).toBe(join(workspace.home, 'knowledge.db'));
    expect(contract.artifact_store.type).toBe('local');
    expect(contract.artifact_store.uri_prefix).toBe(`file://${workspace.artifactsDir}/`);
    expect(contract.source_ownership.owner).toBe('open-files');
    expect(contract.source_ownership.raw_source_bytes_stored_in_open_knowledge).toBe(false);
    expect(contract.generated_artifacts.map((entry) => entry.prefix)).toContain('wiki/');
    expect(contract.scalability.indexes).toContain('not one giant index.md');
    expect(contract.canonical_hasna_xyz.active).toBe(false);
    expect(contract.canonical_hasna_xyz.local_path).toBe(join('.hasna', 'apps', 'knowledge'));
    expect(contract.canonical_hasna_xyz.s3).toMatchObject({
      bucket: 'hasna-xyz-opensource-knowledge-prod',
      region: 'us-east-1',
      prefix: '.hasna/apps/knowledge',
      uri_prefix: 's3://hasna-xyz-opensource-knowledge-prod/.hasna/apps/knowledge/',
    });
    expect(contract.canonical_hasna_xyz.secrets).toMatchObject({
      env: 'hasna/xyz/opensource/knowledge/prod/env',
      aws: 'hasna/xyz/opensource/knowledge/prod/aws',
      s3: 'hasna/xyz/opensource/knowledge/prod/s3',
      rds: null,
      future_rds: 'hasna/xyz/opensource/knowledge/prod/rds',
    });
  });

  test('describes S3 artifact storage without changing open-files source ownership', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-storage-s3-'));
    const workspace = workspaceForHome(join(dir, '.hasna', 'apps', 'knowledge'));
    const config = defaultKnowledgeConfig();
    config.mode = 'hosted';
    config.storage = {
      type: 's3',
      artifacts_root: 'artifacts',
      s3: {
        bucket: 'knowledge-bucket',
        prefix: 'org/project/knowledge',
        region: 'us-east-1',
        server_side_encryption: 'aws:kms',
        kms_key_id: 'kms-key',
      },
    };

    const contract = resolveStorageContract(config, workspace, 'project');
    const validation = validateStorageConfig(config, workspace);

    expect(validation.ok).toBe(true);
    expect(contract.artifact_store.uri_prefix).toBe('s3://knowledge-bucket/org/project/knowledge/');
    expect(contract.artifact_store.s3).toMatchObject({
      bucket: 'knowledge-bucket',
      prefix: 'org/project/knowledge',
      region: 'us-east-1',
      server_side_encryption: 'aws:kms',
      kms_key_configured: true,
    });
    expect(contract.source_ownership.does_not_store).toContain('raw open-files bytes');
  });

  test('activates canonical Hasna XYZ S3 storage when configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-storage-hasna-s3-'));
    const workspace = workspaceForHome(join(dir, '.hasna', 'apps', 'knowledge'));
    const config = defaultKnowledgeConfig();
    config.mode = 'hosted';
    config.storage = canonicalHasnaXyzKnowledgeStorage();

    const contract = resolveStorageContract(config, workspace, 'project');
    const validation = validateStorageConfig(config, workspace);

    expect(validation.ok).toBe(true);
    expect(contract.canonical_hasna_xyz.active).toBe(true);
    expect(contract.artifact_store.type).toBe('s3');
    expect(contract.artifact_store.uri_prefix).toBe('s3://hasna-xyz-opensource-knowledge-prod/.hasna/apps/knowledge/');
    expect(contract.artifact_store.s3).toMatchObject({
      bucket: 'hasna-xyz-opensource-knowledge-prod',
      prefix: '.hasna/apps/knowledge',
      region: 'us-east-1',
      profile: 'hasna-xyz-infra',
      server_side_encryption: 'AES256',
    });
  });

  test('hashes and records generated artifacts in storage_objects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-storage-db-'));
    const dbPath = join(dir, 'knowledge.db');
    migrateKnowledgeDb(dbPath);
    const db = openKnowledgeDb(dbPath);
    try {
      const body = '# Wiki\n';
      const hashed = hashArtifactBody(body);
      expect(hashed.hash).toStartWith('sha256:');
      expect(hashed.size_bytes).toBe(Buffer.byteLength(body));
      expect(artifactKindForKey('wiki/README.md')).toBe('wiki_page');

      recordStorageObjects(db, [{
        key: 'wiki/README.md',
        uri: 'file:///tmp/wiki/README.md',
        kind: 'wiki_page',
        content_type: 'text/markdown',
        modified_at: '2026-06-08T00:00:00.000Z',
        metadata: {
          provenance: {
            generated_from: 'test',
            artifact_key: 'wiki/README.md',
          },
        },
        ...hashed,
      }], new Date('2026-06-08T00:00:00.000Z'));

      const row = db.query<{
        kind: string;
        content_type: string;
        hash: string;
        size_bytes: number;
        metadata_json: string;
      }, []>('SELECT kind, content_type, hash, size_bytes, metadata_json FROM storage_objects').get();

      expect(row?.kind).toBe('wiki_page');
      expect(row?.content_type).toBe('text/markdown');
      expect(row?.hash).toBe(hashed.hash);
      expect(row?.size_bytes).toBe(hashed.size_bytes);
      const metadata = JSON.parse(row?.metadata_json ?? '{}');
      expect(metadata.key).toBe('wiki/README.md');
      expect(metadata.artifact_modified_at).toBe('2026-06-08T00:00:00.000Z');
      expect(metadata.provenance).toMatchObject({
        generated_from: 'test',
        artifact_key: 'wiki/README.md',
      });
    } finally {
      db.close();
    }
  });
});
