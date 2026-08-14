import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrateKnowledgeDb, openKnowledgeDb } from '../src/knowledge-db';
import {
  artifactKindForKey,
  hashArtifactBody,
  recordStorageObjects,
  resolveStorageContract,
  validateStorageConfig,
} from '../src/storage-contract';
import { canonicalExampleKnowledgeStorage, defaultKnowledgeConfig, workspaceForHome } from '../src/workspace';

describe('knowledge storage contract', () => {
  test('describes local .hasna/knowledge ownership and generated artifact classes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-storage-contract-'));
    const workspace = workspaceForHome(join(dir, '.hasna', 'knowledge'));
    const config = defaultKnowledgeConfig();

    const contract = resolveStorageContract(config, workspace, 'project');
    const validation = validateStorageConfig(config, workspace);

    expect(validation.ok).toBe(true);
    expect(contract.scope).toBe('project');
    expect(contract.local_layout.app_path).toBe(join('.hasna', 'knowledge'));
    expect(contract.local_layout.knowledge_db_path).toBe(join(workspace.home, 'knowledge.db'));
    expect(contract.artifact_store.type).toBe('local');
    expect(contract.artifact_store.uri_prefix).toBe(pathToFileURL(`${workspace.artifactsDir}/`).href);
    expect(contract.source_ownership.owner).toBe('open-files');
    expect(contract.source_ownership.raw_source_bytes_stored_in_open_knowledge).toBe(false);
    expect(contract.private_fleet_boundary).toMatchObject({
      manifest_authority: 'open-machines',
      source_ref_authority: 'open-files',
      secret_ref_authority: 'open-secrets',
      raw_private_manifest_bytes_stored_in_open_knowledge: false,
      example_manifest_ref: 'open-files://source/private-fleet-manifest/path/machines.json',
    });
    expect(contract.private_fleet_boundary.accepted_source_ref_schemes).toContain('open-files');
    expect(contract.private_fleet_boundary.does_not_store).toContain('machine serial numbers');
    expect(contract.private_fleet_boundary.does_not_store).toContain('secret values');
    expect(contract.generated_artifacts.map((entry) => entry.prefix)).toContain('wiki/');
    expect(contract.scalability.indexes).toContain('not one giant index.md');
    expect(contract.canonical_example.active).toBe(false);
    expect(contract.canonical_example.local_path).toBe(join('.hasna', 'knowledge'));
    expect(contract.canonical_example.s3).toMatchObject({
      bucket: 'example-knowledge-prod',
      region: 'us-east-1',
      prefix: '.hasna/knowledge',
      uri_prefix: 's3://example-knowledge-prod/.hasna/knowledge/',
    });
    expect(contract.canonical_example.secrets).toMatchObject({
      env: 'example/knowledge/prod/env',
      aws: 'example/knowledge/prod/aws',
      s3: 'example/knowledge/prod/s3',
      rds: null,
      future_rds: 'example/knowledge/prod/rds',
    });
  });

  test('describes S3 artifact storage without changing open-files source ownership', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-storage-s3-'));
    const workspace = workspaceForHome(join(dir, '.hasna', 'knowledge'));
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

  test('activates canonical example S3 storage when configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-storage-hasna-s3-'));
    const workspace = workspaceForHome(join(dir, '.hasna', 'knowledge'));
    const config = defaultKnowledgeConfig();
    config.mode = 'hosted';
    config.storage = canonicalExampleKnowledgeStorage();

    const contract = resolveStorageContract(config, workspace, 'project');
    const validation = validateStorageConfig(config, workspace);

    expect(validation.ok).toBe(true);
    expect(contract.canonical_example.active).toBe(true);
    expect(contract.artifact_store.type).toBe('s3');
    expect(contract.artifact_store.uri_prefix).toBe('s3://example-knowledge-prod/.hasna/knowledge/');
    expect(contract.artifact_store.s3).toMatchObject({
      bucket: 'example-knowledge-prod',
      prefix: '.hasna/knowledge',
      region: 'us-east-1',
      profile: 'example-infra',
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
