import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// --- indexS3Source deleted-object sweep (O15-00404) ---

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createS3ClientConfig, describeS3ClientConfig, setS3CredentialProviderFactoryForTests } from "./s3.js";
import type { Source } from "../types/index.js";

afterEach(() => {
  setS3CredentialProviderFactoryForTests();
});

describe("S3 client configuration", () => {
  test("uses an AWS named profile when S3 source config specifies one", async () => {
    let requestedProfile: string | undefined;
    setS3CredentialProviderFactoryForTests(((options: { profile?: string }) => {
      requestedProfile = options.profile;
      return async () => ({ accessKeyId: "profile-access", secretAccessKey: "profile-secret" });
    }) as typeof import("@aws-sdk/credential-providers").fromIni);

    const config = createS3ClientConfig(s3Source({ config: { profile: "files-sync" } }));

    expect(requestedProfile).toBe("files-sync");
    expect(typeof config.credentials).toBe("function");
    await expect((config.credentials as () => Promise<unknown>)()).resolves.toMatchObject({
      accessKeyId: "profile-access",
      secretAccessKey: "profile-secret",
    });
  });

  test("prefers explicit S3 credentials over an AWS profile", () => {
    let requestedProfile: string | undefined;
    setS3CredentialProviderFactoryForTests(((options: { profile?: string }) => {
      requestedProfile = options.profile;
      return async () => ({ accessKeyId: "profile-access", secretAccessKey: "profile-secret" });
    }) as typeof import("@aws-sdk/credential-providers").fromIni);

    const config = createS3ClientConfig(s3Source({
      config: {
        accessKeyId: "static-access",
        secretAccessKey: "static-secret",
        profile: "files-sync",
      },
    }));

    expect(requestedProfile).toBeUndefined();
    expect(config.credentials).toMatchObject({
      accessKeyId: "static-access",
      secretAccessKey: "static-secret",
    });
  });

  test("reports no-secret diagnostics for cloud runtime configuration", () => {
    const diagnostics = describeS3ClientConfig(s3Source({
      config: {
        profile: "files-sync",
        endpoint: "https://s3-compatible.example.test",
        forcePathStyle: true,
      },
    }));

    expect(diagnostics).toEqual({
      region: "us-west-2",
      endpoint_configured: true,
      force_path_style: true,
      credential_source: "aws_profile",
      profile_configured: true,
      static_access_key_configured: false,
      session_token_configured: false,
    });
    expect(JSON.stringify(diagnostics)).not.toContain("files-sync");
  });

  test("passes path-style config and rejects partial static credentials", () => {
    const config = createS3ClientConfig(s3Source({ config: { forcePathStyle: true } }));

    expect(config.forcePathStyle).toBe(true);
    expect(() =>
      createS3ClientConfig(s3Source({ config: { accessKeyId: "static-access" } })),
    ).toThrow("require both accessKeyId and secretAccessKey");
    expect(() =>
      createS3ClientConfig(s3Source({ config: { secretAccessKey: "static-secret" } })),
    ).toThrow("require both accessKeyId and secretAccessKey");
  });
});

function s3Source(overrides: Partial<Source> = {}): Source {
  return {
    id: "src_test",
    name: "S3",
    type: "s3",
    bucket: "example-prod-emails",
    region: "us-west-2",
    config: {},
    machine_id: "machine",
    enabled: true,
    file_count: 0,
    created_at: "2026-05-26T00:00:00.000Z",
    updated_at: "2026-05-26T00:00:00.000Z",
    ...overrides,
  };
}

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-s3-sweep-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
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

class FakeS3Client {
  private keys: string[];
  constructor(keys: string[]) {
    this.keys = keys;
  }
  async send(command: { constructor: { name: string } }): Promise<unknown> {
    if (command.constructor.name !== "ListObjectsV2Command") {
      throw new Error(`unexpected command: ${command.constructor.name}`);
    }
    return {
      Contents: this.keys.map((key) => ({
        Key: key,
        Size: 42,
        LastModified: new Date("2026-08-01T00:00:00Z"),
        ETag: `"etag-${key}"`,
        StorageClass: "STANDARD",
      })),
      IsTruncated: false,
    };
  }
}

describe("indexS3Source deleted-object sweep", () => {
  test("marks every active row whose key is absent from the bucket as deleted, even past the 50-row listFiles default", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { getDb } = await import("../db/database.js");
    const { indexS3Source, setS3ClientFactoryForTests } = await import("./s3.js");
    const { S3Client } = await import("@aws-sdk/client-s3");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "sweep",
      type: "s3",
      bucket: "sweep-bucket",
      region: "us-east-1",
      config: { profile: "files-sweep" },
      machine_id: machine.id,
    });

    // 40 keys still present in the bucket; 20 keys removed from the bucket.
    const presentKeys = Array.from({ length: 40 }, (_, i) => `present-${i}.txt`);
    const removedKeys = Array.from({ length: 20 }, (_, i) => `removed-${i}.txt`);

    for (const key of [...presentKeys, ...removedKeys]) {
      upsertFile({
        source_id: source.id,
        machine_id: machine.id,
        path: key,
        name: key,
        ext: ".txt",
        size: 42,
        mime: "text/plain",
        hash: undefined,
        status: "active",
        modified_at: "2026-08-01T00:00:00.000Z",
      });
    }

    // Force deterministic ordering: rows whose objects were removed from the
    // bucket keep an OLD indexed_at, so they sort past the 50-row default limit
    // (present rows get their indexed_at refreshed by the re-index anyway).
    const db = getDb();
    db.run(
      "UPDATE files SET indexed_at='2026-01-02 00:00:00' WHERE path LIKE 'present-%'"
    );
    db.run(
      "UPDATE files SET indexed_at='2026-01-01 00:00:00' WHERE path LIKE 'removed-%'"
    );

    setS3ClientFactoryForTests(
      (() => new FakeS3Client(presentKeys)) as unknown as (s: unknown) => S3Client
    );

    try {
      const stats = await indexS3Source(source, machine.id);

      // created_at/indexed_at compare at second granularity, so added vs
      // updated is timing-dependent; the invariant is that every listed
      // object was upserted and nothing errored.
      expect(stats.added + stats.updated).toBe(40);
      expect(stats.errors).toBe(0);
      // The sweep must examine ALL active rows, not the 50 freshest.
      expect(stats.deleted).toBe(20);

      const deletedRows = db
        .query<{ path: string; status: string }, [string]>(
          "SELECT path, status FROM files WHERE source_id=? AND status='deleted'"
        )
        .all(source.id);
      expect(deletedRows.length).toBe(20);
      const deletedPaths = new Set(deletedRows.map((r) => r.path));
      for (const key of removedKeys) expect(deletedPaths.has(key)).toBe(true);
    } finally {
      setS3ClientFactoryForTests();
    }
  });
});
