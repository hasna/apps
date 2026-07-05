import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ENV_KEYS = [
  "HASNA_FILES_STORAGE_MODE",
  "FILES_STORAGE_MODE",
  "HASNA_FILES_DATABASE_URL",
  "FILES_DATABASE_URL",
  "HASNA_FILES_S3_BUCKET",
  "HASNA_FILES_S3_PREFIX",
  "HASNA_FILES_AWS_REGION",
  "HASNA_FILES_S3_ENDPOINT",
  "HASNA_FILES_S3_FORCE_PATH_STYLE",
  "HASNA_FILES_EVIDENCE_BUCKET",
  "HASNA_FILES_EVIDENCE_PREFIX",
  "HASNA_FILES_EVIDENCE_REGION",
  "HASNA_FILES_EVIDENCE_S3_ENDPOINT",
  "HASNA_FILES_EVIDENCE_S3_FORCE_PATH_STYLE",
  "HASNA_FILES_DATA_DIR",
  "HASNA_FILES_DB_PATH",
] as const;

const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

afterEach(async () => {
  const { closeDb } = await import("./database.js");
  closeDb();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("files storage config", () => {
  test("uses explicit files env vars for remote metadata storage", async () => {
    process.env.HASNA_FILES_STORAGE_MODE = "remote";
    process.env.HASNA_FILES_DATABASE_URL = "postgres://files_user:secret@example.test:5432/files";

    const { getStorageConfig, getStorageConnectionString, getStorageDatabaseUrlEnvName } = await import("./storage-config.js");

    expect(getStorageConfig().mode).toBe("remote");
    expect(getStorageDatabaseUrlEnvName()).toBe("HASNA_FILES_DATABASE_URL");
    expect(getStorageConnectionString()).toBe("postgres://files_user:secret@example.test:5432/files");
  });

  test("reports canonical S3 aliases in storage status", async () => {
    testDir = mkdtempSync(join(tmpdir(), "files-storage-status-"));
    process.env.HASNA_FILES_DATA_DIR = testDir;
    process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
    process.env.HASNA_FILES_DATABASE_URL = "postgres://files_user:secret@example.test:5432/files";
    process.env.HASNA_FILES_S3_BUCKET = "hasna-xyz-opensource-files-prod";
    process.env.HASNA_FILES_S3_PREFIX = "objects";
    process.env.HASNA_FILES_AWS_REGION = "us-east-1";
    process.env.HASNA_FILES_S3_FORCE_PATH_STYLE = "1";

    const { getStorageStatus } = await import("./storage-sync.js");

    const status = getStorageStatus();
    expect(status.mode).toBe("hybrid");
    expect(status.remote_configured).toBe(true);
    expect(status.database_url_env).toBe("HASNA_FILES_DATABASE_URL");
    expect(status.object_storage).toMatchObject({
      provider: "s3",
      configured: true,
      bucket: "hasna-xyz-opensource-files-prod",
      prefix: "objects",
      region: "us-east-1",
      force_path_style: true,
      credential_source: "default_provider_chain",
      credential_status: "not_checked",
    });
    expect(status.runtime).toMatchObject({
      local_index: {
        provider: "sqlite",
        role: "local_metadata_index",
        writes: "local_sqlite",
      },
      remote_metadata: {
        provider: "postgres",
        configured: true,
        enabled: true,
        database_url_env: "HASNA_FILES_DATABASE_URL",
        sync: "explicit_migrate_push_pull_sync",
        writes: "explicit_postgres_sync_commands",
      },
      object_bytes: {
        provider: "s3",
        configured: true,
        role: "durable_object_bytes",
        bucket: "hasna-xyz-opensource-files-prod",
        prefix: "objects",
        credential_source: "default_provider_chain",
        credential_status: "not_checked",
        force_path_style: true,
        writes: "explicit_object_store_apis",
      },
      boundary: {
        storage_status_mutates_remote: false,
        metadata_sync_moves_object_bytes: false,
        local_sqlite_replaced_by_remote: false,
      },
    });
  });

  test("validates requested storage table names", async () => {
    const { parseStorageTables } = await import("./storage-sync.js");

    expect(parseStorageTables("machines,files")).toEqual(["machines", "files"]);
    expect(() => parseStorageTables("files,files_fts")).toThrow("Unknown storage table");
  });

  test("exports metadata and object storage helpers from the storage subpath source", async () => {
    const storage = await import("../storage.js");

    expect(storage.STORAGE_TABLES).toContain("files");
    expect(storage.STORAGE_TABLES).toContain("s3_objects");
    expect(storage.STORAGE_TABLES).toContain("file_versions");
    expect(storage.STORAGE_TABLES).toContain("file_search_documents");
    expect(typeof storage.getStorageStatus).toBe("function");
    expect(typeof storage.pushStorageChanges).toBe("function");
    expect(typeof storage.pullStorageChanges).toBe("function");
    expect(typeof storage.syncStorageChanges).toBe("function");
    expect(typeof storage.PgAdapterAsync).toBe("function");
    expect(typeof storage.upsertS3ObjectRecord).toBe("function");
    expect(typeof storage.buildS3ObjectResolverContract).toBe("function");
    expect(typeof storage.listFileVersions).toBe("function");
    expect(typeof storage.extractTextFromFile).toBe("function");
    expect(typeof storage.extractTextSnapshotFromFile).toBe("function");
    expect(typeof storage.getEvidenceStorageOptions).toBe("function");
  });
});
