import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { stubApiEnv } from "../test-support/store-isolation.js";

// ============================================================================
// Regression: `mementos restore` must work in API mode (hosted store).
//
// The verb used to refuse in API mode ("restore operates on the local SQLite
// database and is not available in API mode"). The hosted store has the
// faithful idempotent bulk-restore primitive (POST /memories/bulk-upsert:
// original ids preserved, existing rows never mutated) and the client domain
// layer already routes bulkUpsertMemories() to it — so a backup file created
// by `mementos backup` restores into the cloud store exactly as the local path
// restores into the local DB file.
//
// The failing input is driven end-to-end in API mode against a loopback stub:
// the backup .db file is read by the real CLI, its memories are sent to the
// stub's bulk-upsert route, and the stub's /_received readback proves what was
// actually sent (id fidelity) rather than trusting the client's own report.
// The dry-run (no --force) must not write, and a store that rejects rows must
// fail closed (exit 1) rather than read as a completed restore.
// ============================================================================

const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;

let stub: ReturnType<typeof Bun.spawn>;
let stubPort = 0;
let scratchDir = "";
let backupPath = "";

/** Base URL that makes the stub answer with `mode`. */
function baseFor(mode: string): string {
  return `http://127.0.0.1:${stubPort}/${mode}`;
}

async function readStubReceived(): Promise<Array<{ mode: string; memories: Array<Record<string, unknown>> }>> {
  const res = await fetch(`http://127.0.0.1:${stubPort}/_received`);
  return (await res.json()) as Array<{ mode: string; memories: Array<Record<string, unknown>> }>;
}

async function runRestore(
  mode: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // API mode ON PURPOSE, against the loopback stub — built through
  // store-isolation so an ambient production URL/key cannot take over and a
  // restore (a data-mutating verb) run against the live shared store.
  const env = stubApiEnv(baseFor(mode));
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "restore", ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

/** Build a real backup-shaped SQLite file: a memories table with 3 rows. */
function buildBackup(): void {
  scratchDir = mkdtempSync(join(tmpdir(), "mementos-restore-test-"));
  backupPath = join(scratchDir, "mementos-backup.db");
  const db = new Database(backupPath);
  db.run(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'knowledge',
      scope TEXT NOT NULL DEFAULT 'private',
      summary TEXT,
      tags TEXT DEFAULT '[]',
      importance INTEGER NOT NULL DEFAULT 5,
      source TEXT NOT NULL DEFAULT 'agent',
      status TEXT NOT NULL DEFAULT 'active',
      pinned INTEGER NOT NULL DEFAULT 0,
      agent_id TEXT,
      project_id TEXT,
      session_id TEXT,
      metadata TEXT DEFAULT '{}',
      access_count INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      accessed_at TEXT
    )
  `);
  const insert = db.prepare(
    `INSERT INTO memories (id, key, value, category, scope, summary, tags, importance,
       source, status, pinned, agent_id, project_id, session_id, metadata,
       access_count, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run("mem-restore-1", "restore-key-1", "value one", "knowledge", "shared", "summary one",
    '["a","b"]', 7, "agent", "active", 0, "agent-alpha", "proj-beta", "sess-gamma", '{"x":1}',
    0, 1, "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
  insert.run("mem-restore-2", "restore-key-2", "value two", "fact", "global", null,
    "[]", 8, "user", "active", 1, null, null, null, "{}",
    3, 2, "2026-08-02T00:00:00.000Z", "2026-08-02T00:00:00.000Z");
  insert.run("mem-restore-3", "restore-key-3", "value three", "history", "private", "summary three",
    '["c"]', 5, "system", "archived", 0, "agent-delta", null, "sess-gamma", '{"y":2}',
    1, 1, "2026-08-03T00:00:00.000Z", "2026-08-03T00:00:00.000Z");
  db.close();
}

beforeAll(async () => {
  // Separate process on purpose — see the fixture header: the api-mode
  // transport blocks the event loop with a synchronous curl child, so the stub
  // cannot live in the test process.
  stub = Bun.spawn(["bun", "run", `${import.meta.dir}/__fixtures__/io-restore-stub-server.ts`], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = stub.stdout.getReader();
  const deadline = Date.now() + 10_000;
  let buffered = "";
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += new TextDecoder().decode(value);
    const match = buffered.match(/READY (\d+)/);
    if (match) {
      stubPort = Number(match[1]);
      break;
    }
  }
  reader.releaseLock();
  if (!stubPort) throw new Error(`stub server did not start: ${buffered}`);
  buildBackup();
});

afterAll(() => {
  stub?.kill();
  if (scratchDir) {
    try {
      rmSync(scratchDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of a temp dir
    }
  }
});

describe("mementos restore: hosted store path (API mode)", () => {
  test("FAILING INPUT: --force restores the backup's memories into the hosted store", async () => {
    const before = await readStubReceived();
    const { stdout, exitCode } = await runRestore("ok", [backupPath, "--force", "--json"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as Record<string, unknown>;
    expect(result["action"]).toBe("restore");
    expect(result["status"]).toBe("completed");
    expect(result["restored_memories"]).toBe(3);
    expect(result["inserted"]).toBe(3);
    expect(result["skipped"]).toBe(0);
    expect(result["rejected"]).toBe(0);

    // What was actually sent, not what the client reported: all 3 rows with
    // their original ids, keys and statuses — including the archived row.
    const after = await readStubReceived();
    const sent = after.slice(before.length).flatMap((r) => r.memories);
    expect(sent.length).toBe(3);
    const byId = new Map(sent.map((m) => [String(m["id"]), m]));
    expect(byId.get("mem-restore-1")?.["key"]).toBe("restore-key-1");
    expect(byId.get("mem-restore-1")?.["value"]).toBe("value one");
    expect(byId.get("mem-restore-2")?.["scope"]).toBe("global");
    expect(byId.get("mem-restore-3")?.["status"]).toBe("archived");
  });

  test("dry run (no --force) reports without sending anything to the store", async () => {
    const before = await readStubReceived();
    const { stdout, exitCode } = await runRestore("ok", [backupPath, "--json"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as Record<string, unknown>;
    expect(result["action"]).toBe("restore");
    expect(result["status"]).toBe("dry_run");
    expect(result["backup_memories"]).toBe(3);
    const after = await readStubReceived();
    expect(after.length).toBe(before.length);
  });

  test("a store that rejects rows fails closed instead of reporting completion", async () => {
    const { stdout, exitCode } = await runRestore("partial", [backupPath, "--force", "--json"]);
    expect(exitCode).toBe(1);
    const result = JSON.parse(stdout) as { error?: string };
    expect(result.error).toContain("rejected");
    expect(result.error).not.toContain("completed");
  });
});
