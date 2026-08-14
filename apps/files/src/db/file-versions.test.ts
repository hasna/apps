import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-versions-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
});

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

describe("file versions", () => {
  test("creates immutable local file revisions and reuses the same content identity", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { markFileDeletedById, upsertFile } = await import("./files.js");
    const { getLatestFileVersion, listFileVersions } = await import("./file-versions.js");
    const { parseOpenFilesSourceRef } = await import("../lib/source-ref.js");

    const sourceRoot = join(testDir!, "source");
    mkdirSync(sourceRoot, { recursive: true });
    const machine = getCurrentMachine();
    const source = createSource({
      name: "Local source",
      type: "local",
      path: sourceRoot,
      machine_id: machine.id,
    });

    const file = upsertFile({
      id: "f_localVersion",
      source_id: source.id,
      machine_id: machine.id,
      path: "docs/report.md",
      name: "report.md",
      ext: ".md",
      size: 12,
      mime: "text/markdown",
      hash: "a".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });

    expect(listFileVersions(file.id)).toHaveLength(1);
    const first = getLatestFileVersion(file.id)!;
    expect(parseOpenFilesSourceRef(first.source_ref)).toMatchObject({
      kind: "file",
      file_id: file.id,
      revision_id: first.id,
    });
    expect(first).toMatchObject({
      file_id: file.id,
      source_id: source.id,
      content_hash_algorithm: "blake3",
      content_hash: "a".repeat(64),
      storage_provider: "local",
      local_path: join(sourceRoot, "docs/report.md"),
      source_path: "docs/report.md",
      state: "active",
    });

    upsertFile({
      id: file.id,
      source_id: source.id,
      machine_id: machine.id,
      path: "docs/report.md",
      name: "report.md",
      ext: ".md",
      size: 12,
      mime: "text/markdown",
      hash: "a".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });
    expect(listFileVersions(file.id)).toHaveLength(1);

    upsertFile({
      id: file.id,
      source_id: source.id,
      machine_id: machine.id,
      path: "docs/report.md",
      name: "report.md",
      ext: ".md",
      size: 13,
      mime: "text/markdown",
      hash: "b".repeat(64),
      status: "active",
      modified_at: "2026-06-09T01:00:00.000Z",
    });
    expect(listFileVersions(file.id)).toHaveLength(2);
    expect(listFileVersions(file.id).map((version) => version.content_hash)).toContain("b".repeat(64));

    expect(markFileDeletedById(file.id)).toBe(true);
    const versions = listFileVersions(file.id);
    expect(versions).toHaveLength(3);
    expect(versions.map((version) => version.state)).toContain("deleted");
  });

  test("captures canonical S3 identity for imported Google Drive revisions", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile } = await import("./files.js");
    const { upsertGoogleDriveImportedObject } = await import("./google-drive.js");
    const { listFileVersions, upsertCurrentFileVersion } = await import("./file-versions.js");

    const machine = getCurrentMachine();
    const driveSource = createSource({
      name: "Google Drive",
      type: "google_drive",
      config: {
        profile: "work",
        include_my_drive: true,
        include_all_shared_drives: true,
      },
      machine_id: machine.id,
    });
    const destination = createSource({
      name: "Canonical files bucket",
      type: "s3",
      bucket: "example-files-bucket",
      prefix: "imports/google-drive/live",
      region: "us-east-1",
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_driveVersion",
      source_id: driveSource.id,
      machine_id: machine.id,
      path: "google-drive/work/report.pdf",
      name: "report.pdf",
      ext: ".pdf",
      size: 70,
      mime: "application/pdf",
      hash: "legacy-drive-hash",
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });

    upsertGoogleDriveImportedObject({
      source_id: driveSource.id,
      drive_id: "drive",
      file_id: "drive-file-id",
      path: "work/report.pdf",
      name: "report.pdf",
      mime: "application/pdf",
      size: 70,
      hash: "legacy-drive-hash",
      storage_type: "s3",
      storage_key: "imports/google-drive/live/report.pdf",
      destination_source_id: destination.id,
      s3_key: "google-drive/work/report.pdf",
      raw_bucket: "example-files-bucket-archive",
      raw_key: "google-drive/work/report.pdf",
      canonical_bucket: "example-files-bucket",
      canonical_key: "objects/sha256/ab/cd/abcdef",
      canonical_sha256: "abcdef",
      promotion_action: "promoted",
      promotion_status: "mapped",
      file_record_id: file.id,
      deleted: false,
      last_imported_at: "2026-06-09T00:00:00.000Z",
    });

    const canonical = upsertCurrentFileVersion(file.id)!;
    expect(canonical).toMatchObject({
      content_hash_algorithm: "sha256",
      content_hash: "abcdef",
      storage_provider: "s3",
      bucket: "example-files-bucket",
      region: "us-east-1",
      object_key: "objects/sha256/ab/cd/abcdef",
    });
    expect(canonical.source_provenance).toMatchObject({
      google_drive_file_id: "drive-file-id",
      raw_bucket: "example-files-bucket-archive",
      promotion_status: "mapped",
    });
    const algorithms = listFileVersions(file.id).map((version) => version.content_hash_algorithm);
    expect(algorithms).toContain("source");
    expect(algorithms).toContain("sha256");
  });
});
