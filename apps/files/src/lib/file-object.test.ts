import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ENV_KEYS = [
  "HASNA_FILES_DATA_DIR",
  "HASNA_FILES_DB_PATH",
  "HASNA_FILES_AWS_PROFILE",
  "HASNA_FILES_AWS_REGION",
] as const;

const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(async () => {
  testDir = mkdtempSync(join(tmpdir(), "files-object-resolver-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
  process.env.HASNA_FILES_AWS_PROFILE = "test-aws-profile";
  process.env.HASNA_FILES_AWS_REGION = "us-east-1";
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("file object resolver", () => {
  test("rejects unsafe local object paths before callers can join them", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { resolveFileObject } = await import("./file-object.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Local source",
      type: "local",
      path: join(testDir!, "source"),
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_unsafeLocal",
      source_id: source.id,
      machine_id: machine.id,
      path: "../outside.txt",
      name: "outside.txt",
      ext: ".txt",
      size: 10,
      mime: "text/plain",
      hash: "a".repeat(64),
      status: "active",
      modified_at: "2026-06-08T00:00:00.000Z",
    });

    expect(() => resolveFileObject(file.id)).toThrow("unsafe path segments");
  });

  test("resolves imported Google Drive files to canonical S3 objects", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { upsertGoogleDriveImportedObject } = await import("../db/google-drive.js");
    const { resolveFileObject, resolvedFileObjectSummary } = await import("./file-object.js");

    const machine = getCurrentMachine();
    const driveSource = createSource({
      name: "Google Drive (test)",
      type: "google_drive",
      config: {
        profile: "test",
        include_my_drive: true,
        include_all_shared_drives: true,
      },
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_driveCanonical",
      source_id: driveSource.id,
      machine_id: machine.id,
      path: "google-drive/test/report.txt",
      name: "report.txt",
      ext: ".txt",
      size: 70,
      mime: "text/plain",
      hash: "legacy-md5",
      status: "active",
      modified_at: "2026-06-08T00:00:00.000Z",
    });

    upsertGoogleDriveImportedObject({
      source_id: driveSource.id,
      drive_id: "drive",
      file_id: "drive-file-id",
      path: "test/report.txt",
      name: "report.txt",
      mime: "text/plain",
      size: 70,
      hash: "legacy-md5",
      storage_type: "s3",
      storage_key: "objects/sha256/ab/cd/abcdef",
      s3_key: "google-drive/test/report.txt",
      raw_bucket: "example-files-bucket-archive",
      raw_key: "google-drive/test/report.txt",
      canonical_bucket: "example-files-bucket",
      canonical_key: "objects/sha256/ab/cd/abcdef",
      canonical_sha256: "abcdef",
      promotion_action: "promoted",
      promotion_status: "mapped",
      file_record_id: file.id,
      deleted: false,
      last_imported_at: "2026-06-08T00:00:00.000Z",
    });

    const resolved = resolveFileObject(file.id);
    expect(resolved.storageKind).toBe("google_drive_canonical_s3");
    expect(resolved.storageSource.bucket).toBe("example-files-bucket");
    expect(resolved.storageSource.region).toBe("us-east-1");
    expect(resolved.storageSource.config).toEqual({ profile: "test-aws-profile" });
    expect(resolved.objectKey).toBe("objects/sha256/ab/cd/abcdef");
    expect(resolved.canonical).toMatchObject({
      bucket: "example-files-bucket",
      key: "objects/sha256/ab/cd/abcdef",
      sha256: "abcdef",
    });

    const summary = resolvedFileObjectSummary(resolved);
    expect(summary).toMatchObject({
      storage: {
        kind: "google_drive_canonical_s3",
        provider: "s3",
        bucket: "example-files-bucket",
        key: "objects/sha256/ab/cd/abcdef",
      },
    });
  });

  test("prefers canonical Drive mapping when the file row still points at a legacy S3 source", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { upsertGoogleDriveImportedObject } = await import("../db/google-drive.js");
    const { resolveFileObject } = await import("./file-object.js");

    const machine = getCurrentMachine();
    const legacySource = createSource({
      name: "prod-emails-drive",
      type: "s3",
      bucket: "example-files-bucket-legacy-emails",
      prefix: "drive",
      region: "us-west-2",
      config: { profile: "test-aws-profile" },
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_legacyS3Drive",
      source_id: legacySource.id,
      machine_id: machine.id,
      path: "google-drive/raw-only-in-legacy-layout.txt",
      name: "raw-only-in-legacy-layout.txt",
      ext: ".txt",
      size: 70,
      mime: "text/plain",
      hash: "legacy-md5",
      status: "active",
      modified_at: "2026-06-08T00:00:00.000Z",
    });

    upsertGoogleDriveImportedObject({
      source_id: legacySource.id,
      drive_id: "drive",
      file_id: "drive-file-id",
      path: "raw-only-in-legacy-layout.txt",
      name: "raw-only-in-legacy-layout.txt",
      mime: "text/plain",
      size: 70,
      storage_type: "s3",
      storage_key: "objects/sha256/12/34/1234",
      s3_key: "google-drive/raw-only-in-legacy-layout.txt",
      raw_bucket: "example-files-bucket-archive",
      raw_key: "google-drive/raw-only-in-legacy-layout.txt",
      canonical_bucket: "example-files-bucket",
      canonical_key: "objects/sha256/12/34/1234",
      canonical_sha256: "1234",
      promotion_action: "already_present",
      promotion_status: "mapped",
      file_record_id: file.id,
      deleted: false,
      last_imported_at: "2026-06-08T00:00:00.000Z",
    });

    const resolved = resolveFileObject(file.id);
    expect(resolved.storageKind).toBe("google_drive_canonical_s3");
    expect(resolved.source.id).toBe(legacySource.id);
    expect(resolved.storageSource.bucket).toBe("example-files-bucket");
    expect(resolved.storageSource.region).toBe("us-east-1");
    expect(resolved.objectKey).toBe("objects/sha256/12/34/1234");
  });
});
