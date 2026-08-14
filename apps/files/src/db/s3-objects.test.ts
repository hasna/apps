import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-s3-objects-"));
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

describe("S3 object records", () => {
  test("stores immutable S3 object identity and returns a read-only resolver contract", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const {
      buildS3ObjectResolverContract,
      findS3ObjectRecordForStorage,
      listS3ObjectRecords,
      upsertS3ObjectRecord,
    } = await import("./s3-objects.js");

    const source = createSource({
      name: "Canonical files bucket",
      type: "s3",
      bucket: "example-files-bucket",
      prefix: "objects/sha256",
      region: "us-east-1",
      machine_id: getCurrentMachine().id,
    });

    const object = upsertS3ObjectRecord({
      source_id: source.id,
      bucket: "example-files-bucket",
      region: "us-east-1",
      object_key: "objects/sha256/ab/cd/abcdef",
      version_id: "3HL4kqtJlcpXroDTDmJ+rmSpXd3dIbrHY",
      etag: "\"etag-value\"",
      checksum_sha256: Buffer.from("a".repeat(64), "hex").toString("base64"),
      size: 70,
      content_type: "text/plain",
      storage_class: "STANDARD",
      server_side_encryption: "AES256",
      metadata: { source: "test" },
      org_id: "hasna-xyz",
      app: "files",
      discovered_at: "2026-06-09T00:00:00.000Z",
    });

    expect(object).toMatchObject({
      source_id: source.id,
      bucket: "example-files-bucket",
      object_key: "objects/sha256/ab/cd/abcdef",
      version_id: "3HL4kqtJlcpXroDTDmJ+rmSpXd3dIbrHY",
      etag: "etag-value",
      checksum_sha256: "a".repeat(64),
      size: 70,
      content_type: "text/plain",
      server_side_encryption: "AES256",
      org_id: "hasna-xyz",
      app: "files",
    });

    expect(findS3ObjectRecordForStorage({
      source_id: source.id,
      bucket: object.bucket,
      object_key: object.object_key,
      version_id: object.version_id,
    })?.id).toBe(object.id);
    expect(listS3ObjectRecords({ bucket: object.bucket, prefix: "objects/sha256/" })).toHaveLength(1);

    const contract = buildS3ObjectResolverContract(object);
    expect(contract).toMatchObject({
      object_id: object.id,
      storage: {
        provider: "s3",
        bucket: object.bucket,
        key: object.object_key,
        region: "us-east-1",
        version_id: object.version_id,
      },
      object: {
        size: 70,
        content_type: "text/plain",
        etag: "etag-value",
        checksum_sha256: "a".repeat(64),
        encryption: { mode: "AES256" },
      },
      permissions: { mode: "read_only" },
    });
    expect(JSON.stringify(contract)).not.toContain("accessKey");
  });

  test("links S3 source file revisions to object records by bucket, key, and etag", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile } = await import("./files.js");
    const { listFileVersions } = await import("./file-versions.js");
    const { upsertS3ObjectRecord } = await import("./s3-objects.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "S3 source",
      type: "s3",
      bucket: "example-files-bucket",
      prefix: "objects/sha256",
      region: "us-east-1",
      machine_id: machine.id,
    });
    const object = upsertS3ObjectRecord({
      source_id: source.id,
      bucket: "example-files-bucket",
      region: "us-east-1",
      object_key: "objects/sha256/ab/cd/abcdef",
      etag: "etag-value",
      size: 70,
      content_type: "text/plain",
      discovered_at: "2026-06-09T00:00:00.000Z",
    });

    const file = upsertFile({
      id: "f_s3ObjectVersion",
      source_id: source.id,
      machine_id: machine.id,
      path: "objects/sha256/ab/cd/abcdef",
      name: "abcdef",
      ext: "",
      size: 70,
      mime: "text/plain",
      hash: "etag-value",
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });

    const version = listFileVersions(file.id)[0]!;
    expect(version).toMatchObject({
      s3_object_id: object.id,
      content_hash_algorithm: "etag",
      content_hash: "etag-value",
      storage_provider: "s3",
      bucket: "example-files-bucket",
      object_key: "objects/sha256/ab/cd/abcdef",
    });
    expect(version.source_provenance).toMatchObject({
      s3_object_id: object.id,
      s3_etag: "etag-value",
    });
  });
});
