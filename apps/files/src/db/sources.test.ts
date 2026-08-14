import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-sources-"));
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

describe("source config persistence", () => {
  test("rejects static S3 credentials at create and update boundaries", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource, updateSource } = await import("./sources.js");

    const machine = getCurrentMachine();
    expect(() => createSource({
      name: "S3 with static credentials",
      type: "s3",
      bucket: "hasna-xyz-opensource-files-test",
      region: "us-east-1",
      config: {
        accessKeyId: "static-access",
        secretAccessKey: "static-secret",
      },
      machine_id: machine.id,
    })).toThrow("must not contain static credentials");

    const source = createSource({
      name: "S3 with profile",
      type: "s3",
      bucket: "hasna-xyz-opensource-files-test",
      region: "us-east-1",
      config: { profile: "files-sync" },
      machine_id: machine.id,
    });

    expect(() => updateSource(source.id, {
      config: {
        profile: "files-sync",
        sessionToken: "static-session-token",
      },
    })).toThrow("must not contain static credentials");
  });

  test("sanitizes legacy source config secrets on read", async () => {
    const { getDb } = await import("./database.js");
    const { getCurrentMachine } = await import("./machines.js");
    const { listSources } = await import("./sources.js");

    const machine = getCurrentMachine();
    getDb().run(
      `INSERT INTO sources (id, name, type, bucket, region, config, machine_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "src_legacy_secret",
        "Legacy S3",
        "s3",
        "hasna-xyz-opensource-files-test",
        "us-east-1",
        JSON.stringify({
          accessKeyId: "legacy-access",
          secretAccessKey: "legacy-secret",
          sessionToken: "legacy-session",
          profile: "files-sync",
          endpoint: "https://s3-compatible.example.test",
        }),
        machine.id,
      ],
    );

    const source = listSources().find((item) => item.id === "src_legacy_secret")!;
    expect(source.config).toEqual({
      profile: "files-sync",
      endpoint: "https://s3-compatible.example.test",
    });
  });
});
