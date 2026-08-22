import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-hash-skip-"));
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

const HASH_HEX_64 = /^[0-9a-f]{64}$/;

async function readStoredHash(source_id: string, path: string): Promise<string | null> {
  const { getDb } = await import("../db/database.js");
  const row = getDb()
    .query<{ hash: string | null }, [string, string]>("SELECT hash FROM files WHERE source_id = ? AND path = ?")
    .get(source_id, path);
  return row?.hash ?? null;
}

describe("hash_skip_bytes threading", () => {
  test("hash_skip_bytes=1 stores a NULL hash for a file larger than the threshold", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { indexLocalSource } = await import("./indexer.js");

    const sourceRoot = join(testDir!, "source");
    mkdirSync(sourceRoot, { recursive: true });
    // 4096 bytes > hash_skip_bytes: 1, so hashing must be skipped entirely.
    writeFileSync(join(sourceRoot, "big.bin"), Buffer.alloc(4096, 0x61));
    writeFileSync(join(testDir!, "config.json"), JSON.stringify({ hash_skip_bytes: 1 }));

    const machine = getCurrentMachine();
    const source = createSource({ name: "test", type: "local", path: sourceRoot, machine_id: machine.id });
    const stats = await indexLocalSource(source, machine.id);

    expect(stats.added).toBe(1);
    expect(stats.errors).toBe(0);
    expect(await readStoredHash(source.id, "big.bin")).toBeNull();
  });

  test("default config (absent key) stores the full 64-hex blake3 hash", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { indexLocalSource } = await import("./indexer.js");

    const sourceRoot = join(testDir!, "source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "big.bin"), Buffer.alloc(4096, 0x61));
    // No config.json — loadConfig() returns defaults, hash_skip_bytes = 0.

    const machine = getCurrentMachine();
    const source = createSource({ name: "test", type: "local", path: sourceRoot, machine_id: machine.id });
    const stats = await indexLocalSource(source, machine.id);

    expect(stats.added).toBe(1);
    expect(stats.errors).toBe(0);
    expect(await readStoredHash(source.id, "big.bin")).toMatch(HASH_HEX_64);
  });
});
