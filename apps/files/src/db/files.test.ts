import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-files-"));
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

describe("file sync versioning", () => {
  test("freshly upserted files are included in peer sync from floor 0", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile, getMaxSyncVersion, getFilesSince } = await import("./files.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "sync-version-test",
      type: "local",
      path: "/tmp/sync-version-test",
      machine_id: machine.id,
    });

    for (const p of ["p1", "p2", "p3"]) {
      upsertFile({
        source_id: source.id,
        machine_id: machine.id,
        path: `docs/${p}.md`,
        name: `${p}.md`,
        ext: "md",
        size: 10,
        mime: "text/markdown",
        status: "active",
        hash: `${p}-hash`,
        modified_at: "2026-08-22T12:00:00Z",
      });
    }

    // A created row is revision 1: the max watermark must advance past the
    // client floor (`last_sync_version ?? 0`), and getFilesSince(0) — the
    // first peer sync — must return every fresh file.
    expect(getMaxSyncVersion()).toBe(1);
    const since = getFilesSince(0).map((f) => f.path).sort();
    expect(since).toEqual(["docs/p1.md", "docs/p2.md", "docs/p3.md"]);
  });
});
