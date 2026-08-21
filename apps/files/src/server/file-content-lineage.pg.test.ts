import { afterAll, describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { Pool, type PoolClient } from "pg";
import { FILE_CONTENT_TENANCY_MIGRATIONS } from "../db/cloud-migrations.js";
import { wrapExecutor } from "../generated/storage-kit/query.js";
import { createV1Handler } from "./v1.js";

const DATABASE_URL = process.env.HASNA_FILES_TEST_POSTGRES_URL;
const TEST_SIGNING_MATERIAL = Buffer.alloc(32, 7).toString("hex");
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const PRIVATE_BYTES = Buffer.from("PG_LINEAGE_PRIVATE_BYTES\n", "utf8");
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, max: 4 }) : null;
let fixtureSequence = 0;

afterAll(async () => {
  await pool?.end();
});

function apiToken(kid: string): string {
  return mintApiKey({
    app: "files",
    kid,
    scopes: ["files:read"],
    signingSecret: TEST_SIGNING_MATERIAL,
  }).token;
}

async function withPgFixture(run: (client: PoolClient) => Promise<void>): Promise<void> {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const schema = `files_pr39_${process.pid}_${++fixtureSequence}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path = ${schema}`);
    await createFixtureSchema(client);
    await run(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function createFixtureSchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE tenants (
      id UUID PRIMARY KEY
    );
    CREATE TABLE sources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      bucket TEXT,
      prefix TEXT,
      region TEXT,
      tenant_id UUID
    );
    CREATE TABLE files (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      size BIGINT NOT NULL,
      mime TEXT NOT NULL,
      status TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      tenant_id UUID
    );
    CREATE TABLE google_drive_imported_objects (
      source_id TEXT NOT NULL,
      drive_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      storage_type TEXT,
      storage_key TEXT,
      destination_source_id TEXT,
      canonical_bucket TEXT,
      canonical_key TEXT,
      canonical_sha256 TEXT,
      file_record_id TEXT NOT NULL,
      deleted BOOLEAN NOT NULL DEFAULT FALSE,
      tenant_id UUID,
      PRIMARY KEY (source_id, drive_id, file_id)
    );
    CREATE TABLE file_versions (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      content_hash_algorithm TEXT NOT NULL DEFAULT 'unknown',
      content_hash TEXT,
      size BIGINT NOT NULL,
      mime TEXT NOT NULL,
      storage_provider TEXT NOT NULL,
      bucket TEXT,
      region TEXT,
      object_key TEXT,
      state TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      s3_object_id TEXT,
      tenant_id UUID
    );
    CREATE TABLE s3_objects (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      identity TEXT NOT NULL UNIQUE,
      bucket TEXT NOT NULL,
      region TEXT,
      object_key TEXT NOT NULL,
      version_id TEXT,
      etag TEXT,
      checksum_sha256 TEXT,
      size BIGINT NOT NULL DEFAULT 0,
      content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      storage_class TEXT,
      server_side_encryption TEXT,
      sse_kms_key_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      org_id TEXT,
      company_id TEXT,
      project_id TEXT,
      app TEXT,
      discovered_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT NOW()::text,
      updated_at TEXT NOT NULL DEFAULT NOW()::text,
      tenant_id UUID
    );
    CREATE TABLE api_keys (
      kid TEXT PRIMARY KEY,
      app TEXT NOT NULL,
      revoked_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ
    );
    CREATE TABLE api_key_tenants (
      kid TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const triggerMigration = FILE_CONTENT_TENANCY_MIGRATIONS.find(
    ({ id }) => id === "files-content-tenant-0004-bind-future-single-tenant-keys",
  );
  expect(triggerMigration, "legacy key-binding trigger must be registered").toBeDefined();
  await client.query(triggerMigration!.sql);
}

async function seedLegacyDrive(
  client: PoolClient,
  options: {
    fileId?: string;
    kid?: string;
    sourceTenant?: string;
    fileTenant?: string;
    importTenant?: string;
    versionTenant?: string;
    state?: string;
  } = {},
): Promise<void> {
  const fileId = options.fileId ?? "f_legacy";
  const kid = options.kid ?? "kid-a";
  const sourceTenant = options.sourceTenant ?? TENANT_A;
  const fileTenant = options.fileTenant ?? TENANT_A;
  const importTenant = options.importTenant ?? TENANT_A;
  const versionTenant = options.versionTenant ?? TENANT_A;
  await client.query(
    `INSERT INTO tenants (id)
     VALUES ($1), ($2), ($3), ($4)
     ON CONFLICT (id) DO NOTHING`,
    [sourceTenant, fileTenant, importTenant, versionTenant],
  );
  await client.query(
    `INSERT INTO sources (id, type, bucket, prefix, region, tenant_id)
     VALUES ($1, 's3', 'private-files-bucket', 'imports/google-drive/live', 'eu-west-1', $2)`,
    [`src-${fileId}`, sourceTenant],
  );
  await client.query(
    `INSERT INTO files (id, source_id, path, size, mime, status, indexed_at, tenant_id)
     VALUES ($1, $2, 'google-drive/work/book.txt', $3, 'text/plain', 'active', '2026-08-08T20:00:00Z', $4)`,
    [fileId, `src-${fileId}`, PRIVATE_BYTES.byteLength, fileTenant],
  );
  await client.query(
    `INSERT INTO google_drive_imported_objects (
       source_id, drive_id, file_id, storage_type, storage_key,
       destination_source_id, file_record_id, deleted, tenant_id
     ) VALUES ($1, 'drive', $2, 's3', 'google-drive/work/book.txt', $1, $3, FALSE, $4)`,
    [`src-${fileId}`, `drive-${fileId}`, fileId, importTenant],
  );
  await client.query(
    `INSERT INTO file_versions (
       id, file_id, source_ref, size, mime, storage_provider, bucket, region,
       object_key, state, indexed_at, created_at, s3_object_id, tenant_id
     ) VALUES ($1, $2, $3, $4, 'text/plain', 's3', 'private-files-bucket', 'eu-west-1',
       'google-drive/work/book.txt', $5, '2026-08-08T20:00:00Z', '2026-08-08T20:00:00Z', NULL, $6)`,
    [`rev-${fileId}`, fileId, `open-files://file/${fileId}/revision/rev-${fileId}`, PRIVATE_BYTES.byteLength, options.state ?? "active", versionTenant],
  );
  await client.query(
    `INSERT INTO api_keys (kid, app) VALUES ($1, 'files') ON CONFLICT (kid) DO NOTHING`,
    [kid],
  );
}

async function applyLegacyLineageMigration(client: PoolClient): Promise<void> {
  const lineageMigration = FILE_CONTENT_TENANCY_MIGRATIONS.find(
    ({ id }) => id === "files-content-tenant-0005-materialize-legacy-s3-lineage",
  );
  const repairMigration = FILE_CONTENT_TENANCY_MIGRATIONS.find(
    ({ id }) => id === "files-content-tenant-0006-quarantine-ambiguous-lineage",
  );
  expect(lineageMigration, "legacy S3 lineage migration must be registered").toBeDefined();
  expect(repairMigration, "append-only lineage repair must be registered").toBeDefined();
  await client.query(lineageMigration!.sql);
  await client.query(repairMigration!.sql);
}

test("preserves the landed migration and appends a bounded repair with no handler fallback", () => {
  const lineageMigration = FILE_CONTENT_TENANCY_MIGRATIONS.find(
    ({ id }) => id === "files-content-tenant-0005-materialize-legacy-s3-lineage",
  );
  const repairMigration = FILE_CONTENT_TENANCY_MIGRATIONS.find(
    ({ id }) => id === "files-content-tenant-0006-quarantine-ambiguous-lineage",
  );
  expect(lineageMigration).toBeDefined();
  expect(repairMigration).toBeDefined();
  expect(lineageMigration!.sql).toContain("fv.s3_object_id IS NULL");
  expect(lineageMigration!.sql).toContain("fv.state = 'active'");
  expect(lineageMigration!.sql).toContain("f.status = 'active'");
  expect(lineageMigration!.sql).toContain("fv.tenant_id = f.tenant_id");
  expect(lineageMigration!.sql).toContain("s.tenant_id = f.tenant_id");
  expect(lineageMigration!.sql).toContain("COUNT(DISTINCT tenant_id) = 1");
  expect(lineageMigration!.sql).toContain("left(relative_key, length(object_prefix) + 1)");
  expect(lineageMigration!.sql).toContain("ON CONFLICT (kid) DO NOTHING");
  expect(lineageMigration!.sql).not.toContain("SET org_id =");
  expect(lineageMigration!.sql).not.toContain("UPDATE files ");
  expect(repairMigration!.sql).toContain("ROW_NUMBER() OVER");
  expect(repairMigration!.sql).toContain("ORDER BY fv.created_at DESC, fv.id DESC");
  expect(repairMigration!.sql).toContain("FROM tenants");
  expect(repairMigration!.sql).toContain("CREATE OR REPLACE FUNCTION files_bind_single_tenant_api_key()");
  expect(repairMigration!.sql).toContain("api_key_tenant_quarantine");
  expect(repairMigration!.sql).toContain("file_version_lineage_quarantine");
});

describe.skipIf(!DATABASE_URL)("PostgreSQL legacy file-content lineage", () => {
  test("prefixes legacy Drive keys, links the active revision, binds one tenant, and serves exact bytes", async () => {
    await withPgFixture(async (client) => {
      await seedLegacyDrive(client);
      await applyLegacyLineageMigration(client);

      const object = (await client.query<{ bucket: string; object_key: string; org_id: string }>(
        `SELECT o.bucket, o.object_key, o.org_id
         FROM file_versions fv JOIN s3_objects o ON o.id = fv.s3_object_id
         WHERE fv.id = 'rev-f_legacy'`,
      )).rows[0];
      expect(object).toEqual({
        bucket: "private-files-bucket",
        object_key: "imports/google-drive/live/google-drive/work/book.txt",
        org_id: TENANT_A,
      });

      let reads = 0;
      const store = wrapExecutor(client);
      const handler = createV1Handler({
        getClient: () => store,
        verifier: verifyApiKey({
          app: "files",
          signingSecret: TEST_SIGNING_MATERIAL,
          keyStatus: async () => "active",
        }),
        readObject: async (locator) => {
          reads++;
          expect(locator.bucket).toBe("private-files-bucket");
          expect(locator.object_key).toBe("imports/google-drive/live/google-drive/work/book.txt");
          return new Response(PRIVATE_BYTES);
        },
      });
      const request = new Request("https://files.example.test/v1/files/f_legacy/content", {
        headers: { "x-api-key": apiToken("kid-a") },
      });
      const response = await handler.handle(request, new URL(request.url));

      expect(response?.status).toBe(200);
      expect(Buffer.from(await response!.arrayBuffer())).toEqual(PRIVATE_BYTES);
      expect(reads).toBe(1);

      await client.query(`INSERT INTO api_keys (kid, app) VALUES ('kid-future', 'files')`);
      const futureBinding = (await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM api_key_tenants WHERE kid = 'kid-future'`,
      )).rows[0];
      expect(futureBinding).toEqual({ tenant_id: TENANT_A });
    });
  });

  test("is idempotent and does not update mismatched, inactive, or unsupported lineage", async () => {
    await withPgFixture(async (client) => {
      await seedLegacyDrive(client);
      await seedLegacyDrive(client, {
        fileId: "f_mismatch",
        kid: "kid-mismatch",
        fileTenant: TENANT_B,
      });
      await seedLegacyDrive(client, {
        fileId: "f_inactive",
        kid: "kid-inactive",
        state: "deleted",
      });
      await client.query(
        `INSERT INTO sources (id, type, tenant_id) VALUES ('src-unsupported', 'google_drive', $1)`,
        [TENANT_A],
      );
      await client.query(
        `INSERT INTO files (id, source_id, path, size, mime, status, indexed_at, tenant_id)
         VALUES ('f_unsupported', 'src-unsupported', 'google-drive/work/unsupported.txt', 1,
           'text/plain', 'active', '2026-08-08T20:00:00Z', $1)`,
        [TENANT_A],
      );
      await client.query(
        `INSERT INTO file_versions (
           id, file_id, source_ref, size, mime, storage_provider, state,
           indexed_at, created_at, tenant_id
         ) VALUES ('rev-unsupported', 'f_unsupported',
           'open-files://file/f_unsupported/revision/rev-unsupported', 1, 'text/plain',
           'unknown', 'active', '2026-08-08T20:00:00Z', '2026-08-08T20:00:00Z', $1)`,
        [TENANT_A],
      );

      await applyLegacyLineageMigration(client);
      const first = (await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM s3_objects) AS objects,
           (SELECT COUNT(*)::int FROM file_versions WHERE s3_object_id IS NOT NULL) AS linked,
           (SELECT COUNT(*)::int FROM api_key_tenants) AS key_bindings`,
      )).rows[0];
      await applyLegacyLineageMigration(client);
      const second = (await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM s3_objects) AS objects,
           (SELECT COUNT(*)::int FROM file_versions WHERE s3_object_id IS NOT NULL) AS linked,
           (SELECT COUNT(*)::int FROM api_key_tenants) AS key_bindings`,
      )).rows[0];

      expect(second).toEqual(first);
      expect(first).toEqual({ objects: 1, linked: 1, key_bindings: 0 });
      const untouched = await client.query<{ id: string }>(
        `SELECT id FROM file_versions
         WHERE id IN ('rev-f_mismatch', 'rev-f_inactive', 'rev-unsupported')
           AND s3_object_id IS NULL
         ORDER BY id`,
      );
      expect(untouched.rows.map(({ id }) => id)).toEqual([
        "rev-f_inactive",
        "rev-f_mismatch",
        "rev-unsupported",
      ]);
    });
  });

  test("keeps wrong-key tenants and missing objects on a generic 404 without request-time mutation", async () => {
    await withPgFixture(async (client) => {
      await seedLegacyDrive(client);
      await client.query(
        `INSERT INTO api_key_tenants (kid, tenant_id) VALUES ('kid-a', $1)`,
        [TENANT_B],
      );
      await applyLegacyLineageMigration(client);
      const store = wrapExecutor(client);
      let reads = 0;
      const wrongTenantHandler = createV1Handler({
        getClient: () => store,
        verifier: verifyApiKey({
          app: "files",
          signingSecret: TEST_SIGNING_MATERIAL,
          keyStatus: async () => "active",
        }),
        readObject: async () => {
          reads++;
          return new Response(PRIVATE_BYTES);
        },
      });
      const wrongTenantRequest = new Request("https://files.example.test/v1/files/f_legacy/content", {
        headers: { "x-api-key": apiToken("kid-a") },
      });
      const wrongTenantResponse = await wrongTenantHandler.handle(wrongTenantRequest, new URL(wrongTenantRequest.url));
      expect(wrongTenantResponse?.status).toBe(404);
      expect(await wrongTenantResponse!.text()).toContain("File not found");
      expect(reads).toBe(0);

      await client.query(`UPDATE api_key_tenants SET tenant_id = $1 WHERE kid = 'kid-a'`, [TENANT_A]);
      const before = (await client.query(`SELECT COUNT(*)::int AS count FROM s3_objects`)).rows[0];
      const missingObjectHandler = createV1Handler({
        getClient: () => store,
        verifier: verifyApiKey({
          app: "files",
          signingSecret: TEST_SIGNING_MATERIAL,
          keyStatus: async () => "active",
        }),
        readObject: async () => null,
      });
      const missingRequest = new Request("https://files.example.test/v1/files/f_legacy/content", {
        headers: { "x-api-key": apiToken("kid-a") },
      });
      const missingResponse = await missingObjectHandler.handle(missingRequest, new URL(missingRequest.url));
      const after = (await client.query(`SELECT COUNT(*)::int AS count FROM s3_objects`)).rows[0];
      expect(missingResponse?.status).toBe(404);
      expect(await missingResponse!.text()).toContain("File not found");
      expect(after).toEqual(before);
    });
  });

  test("does not bind an API key when the reconstructed population has two tenants", async () => {
    await withPgFixture(async (client) => {
      await seedLegacyDrive(client, { fileId: "f_tenant_a", kid: "kid-unbound" });
      await seedLegacyDrive(client, {
        fileId: "f_tenant_b",
        kid: "kid-unbound",
        sourceTenant: TENANT_B,
        fileTenant: TENANT_B,
        importTenant: TENANT_B,
        versionTenant: TENANT_B,
      });
      await applyLegacyLineageMigration(client);

      const counts = (await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM s3_objects) AS objects,
           (SELECT COUNT(*)::int FROM file_versions WHERE s3_object_id IS NOT NULL) AS linked,
           (SELECT COUNT(*)::int FROM api_key_tenants) AS key_bindings`,
      )).rows[0];
      expect(counts).toEqual({ objects: 2, linked: 2, key_bindings: 0 });

      const store = wrapExecutor(client);
      let reads = 0;
      const handler = createV1Handler({
        getClient: () => store,
        verifier: verifyApiKey({
          app: "files",
          signingSecret: TEST_SIGNING_MATERIAL,
          keyStatus: async () => "active",
        }),
        readObject: async () => {
          reads++;
          return new Response(PRIVATE_BYTES);
        },
      });
      const request = new Request("https://files.example.test/v1/files/f_tenant_a/content", {
        headers: { "x-api-key": apiToken("kid-unbound") },
      });
      const response = await handler.handle(request, new URL(request.url));
      expect(response?.status).toBe(404);
      expect(await response!.text()).toContain("File not found");
      expect(reads).toBe(0);
    });
  });

  test("does not bind another registered tenant's key when only one tenant has reconstructed objects", async () => {
    await withPgFixture(async (client) => {
      await seedLegacyDrive(client);
      await client.query(`INSERT INTO tenants (id) VALUES ($1)`, [TENANT_B]);
      await client.query(`INSERT INTO api_keys (kid, app) VALUES ('kid-b', 'files')`);
      await applyLegacyLineageMigration(client);
      await client.query(`INSERT INTO api_keys (kid, app) VALUES ('kid-future', 'files')`);

      const bindings = await client.query<{ kid: string; tenant_id: string }>(
        `SELECT kid, tenant_id FROM api_key_tenants ORDER BY kid`,
      );
      expect(bindings.rows).toEqual([]);
      const quarantined = await client.query<{ kid: string; tenant_id: string }>(
        `SELECT kid, tenant_id FROM api_key_tenant_quarantine ORDER BY kid`,
      );
      expect(quarantined.rows).toEqual([
        { kid: "kid-a", tenant_id: TENANT_A },
        { kid: "kid-b", tenant_id: TENANT_A },
      ]);

      const store = wrapExecutor(client);
      let reads = 0;
      const handler = createV1Handler({
        getClient: () => store,
        verifier: verifyApiKey({
          app: "files",
          signingSecret: TEST_SIGNING_MATERIAL,
          keyStatus: async () => "active",
        }),
        readObject: async () => {
          reads++;
          return new Response(PRIVATE_BYTES);
        },
      });
      const request = new Request("https://files.example.test/v1/files/f_legacy/content", {
        headers: { "x-api-key": apiToken("kid-b") },
      });
      const response = await handler.handle(request, new URL(request.url));
      expect(response?.status).toBe(404);
      expect(await response!.text()).toContain("File not found");
      expect(reads).toBe(0);
    });
  });

  test("links only the latest active revision to the current object lineage", async () => {
    await withPgFixture(async (client) => {
      await seedLegacyDrive(client);
      await client.query(
        `UPDATE file_versions
         SET content_hash_algorithm = 'sha256', content_hash = $1
         WHERE id = 'rev-f_legacy'`,
        ["b".repeat(64)],
      );
      await client.query(
        `INSERT INTO file_versions (
           id, file_id, source_ref, content_hash_algorithm, content_hash,
           size, mime, storage_provider, bucket, region, object_key, state,
           indexed_at, created_at, s3_object_id, tenant_id
         ) VALUES ('rev-f_legacy-old', 'f_legacy',
           'open-files://file/f_legacy/revision/rev-f_legacy-old', 'sha256', $1,
           $2, 'text/plain', 's3', 'private-files-bucket', 'eu-west-1',
           'google-drive/work/old-book.txt', 'active', '2026-08-07T20:00:00Z',
           '2026-08-07T20:00:00Z', NULL, $3)`,
        ["a".repeat(64), PRIVATE_BYTES.byteLength, TENANT_A],
      );
      await applyLegacyLineageMigration(client);

      const revisions = await client.query<{
        id: string;
        s3_object_id: string | null;
        storage_provider: string;
        object_key: string | null;
      }>(
        `SELECT id, s3_object_id, storage_provider, object_key FROM file_versions
         WHERE file_id = 'f_legacy'
         ORDER BY created_at DESC, id DESC`,
      );
      expect(revisions.rows).toEqual([
        {
          id: "rev-f_legacy",
          s3_object_id: expect.any(String),
          storage_provider: "s3",
          object_key: "imports/google-drive/live/google-drive/work/book.txt",
        },
        {
          id: "rev-f_legacy-old",
          s3_object_id: null,
          storage_provider: "unknown",
          object_key: null,
        },
      ]);
      const quarantined = (await client.query<{
        revision_id: string;
        s3_object_id: string;
        storage_provider: string;
        object_key: string;
      }>(
        `SELECT revision_id, s3_object_id, storage_provider, object_key
         FROM file_version_lineage_quarantine`,
      )).rows[0];
      expect(quarantined).toEqual({
        revision_id: "rev-f_legacy-old",
        s3_object_id: expect.any(String),
        storage_provider: "s3",
        object_key: "imports/google-drive/live/google-drive/work/book.txt",
      });
      const object = (await client.query<{ checksum_sha256: string; metadata: string }>(
        `SELECT checksum_sha256, metadata FROM s3_objects`,
      )).rows[0];
      expect(object.checksum_sha256).toBe("b".repeat(64));
      expect(JSON.parse(object.metadata).revision_id).toBe("rev-f_legacy");
    });
  });

  test("keeps shared lineage when two revisions prove the same content identity", async () => {
    await withPgFixture(async (client) => {
      await seedLegacyDrive(client);
      await client.query(
        `UPDATE file_versions
         SET content_hash_algorithm = 'sha256', content_hash = $1
         WHERE id = 'rev-f_legacy'`,
        ["c".repeat(64)],
      );
      await client.query(
        `INSERT INTO file_versions (
           id, file_id, source_ref, content_hash_algorithm, content_hash,
           size, mime, storage_provider, bucket, region, object_key, state,
           indexed_at, created_at, s3_object_id, tenant_id
         ) VALUES ('rev-f_legacy-same', 'f_legacy',
           'open-files://file/f_legacy/revision/rev-f_legacy-same', 'sha256', $1,
           $2, 'text/plain', 's3', 'private-files-bucket', 'eu-west-1',
           'google-drive/work/book.txt', 'active', '2026-08-07T20:00:00Z',
           '2026-08-07T20:00:00Z', NULL, $3)`,
        ["c".repeat(64), PRIVATE_BYTES.byteLength, TENANT_A],
      );
      await applyLegacyLineageMigration(client);

      const revisions = await client.query<{ id: string; s3_object_id: string | null }>(
        `SELECT id, s3_object_id FROM file_versions
         WHERE file_id = 'f_legacy'
         ORDER BY created_at DESC, id DESC`,
      );
      expect(revisions.rows).toEqual([
        { id: "rev-f_legacy", s3_object_id: expect.any(String) },
        { id: "rev-f_legacy-same", s3_object_id: expect.any(String) },
      ]);
      expect(revisions.rows[0]!.s3_object_id).toBe(revisions.rows[1]!.s3_object_id);
      const quarantineCount = (await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM file_version_lineage_quarantine`,
      )).rows[0]?.count;
      expect(quarantineCount).toBe(0);
    });
  });
});
