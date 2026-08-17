// Server-side regression tests for the silent row-cap family (BUG 2796806b):
//   GET /api/memories        — must cap single responses at a bounded page and
//                              return has_more / next_cursor / total instead of
//                              an unbounded body that a proxy can truncate.
//   GET /api/memories/stale  — the silent hard cap of 100 is replaced by a
//                              bounded page plus total / has_more / next_cursor.
//   GET /api/memories/history— same family: bounded page plus signals.
//
// All three currently fail against the pre-fix server: list returns every
// requested row with no signals, stale silently caps at 100, history at 200.

// Set in-memory DB before any imports
process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isolatedStoreEnv } from "../test-support/store-isolation.js";
import { getDatabase, resetDatabase } from "../db/database.js";

const DB_PATH = join(tmpdir(), `mementos-server-pagination-cap-${Date.now()}.db`);
const PORT = 19400 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;

let serverProc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  // Seed the shared file DB directly with ONE multi-row INSERT statement.
  // Per-row inserts (even inside a transaction) take ~4.5ms each on a loaded
  // box — 1202 rows exceed bun's 5s hook timeout; one statement commits once.
  const db = getDatabase(DB_PATH);
  const ts = new Date().toISOString();
  const values: string[] = [];
  for (let i = 0; i < 1202; i++) {
    // 1202 rows => 201 accessed (history surface, not stale) and 1001 stale.
    values.push(
      `('00000000-0000-4000-8000-${String(i).padStart(12, "0")}',` +
        `'route-seed-${String(i).padStart(4, "0")}',` +
        `'route seed value ${i}',` +
        `'knowledge','shared',NULL,'[]',5,'agent','active',FALSE,'{}',0,1,NULL,` +
        `'${ts}',NULL,'${ts}','${ts}','${ts}')`,
    );
  }
  db.exec(
    `INSERT INTO memories (id, key, value, category, scope, summary, tags, importance,
       source, status, pinned, metadata, access_count, version, expires_at,
       valid_from, valid_until, ingested_at, created_at, updated_at)
     VALUES ${values.join(",")}`,
  );
  // Touch the first 201 rows so they are in the history surface (not stale).
  db.run(
    `UPDATE memories SET access_count = access_count + 1, accessed_at = ?
     WHERE id IN (SELECT id FROM memories ORDER BY created_at ASC LIMIT 201)`,
    [ts],
  );
  // Close the file handle BEFORE the server process opens the same file:
  // resetDatabase() only nulls the module refs, and until Bun's GC actually
  // runs the fd stays open — the server's startup migration then blocks on the
  // SQLite lock and never starts listening.
  db.close();
  resetDatabase();

  serverProc = Bun.spawn(
    ["bun", "run", "src/server/index.ts", "--port", String(PORT)],
    {
      env: isolatedStoreEnv(DB_PATH),
      stdout: "pipe",
      stderr: "pipe",
      cwd: new URL("../../", import.meta.url).pathname.replace(/\/$/, ""),
    }
  );
  let ready = false;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) { ready = true; break; }
    } catch { /* not ready yet */ }
    await Bun.sleep(100);
  }
  if (!ready) throw new Error("Server failed to start");
});

afterAll(() => {
  serverProc.kill();
  resetDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
});

async function api(path: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  return { status: res.status, data };
}

describe("GET /api/memories pagination contract", () => {
  test("a huge requested limit is capped to a bounded page with signals, not returned unbounded", async () => {
    const { status, data } = await api("/api/memories?limit=40000");
    expect(status).toBe(200);
    expect(Array.isArray(data.memories)).toBe(true);
    expect(data.memories.length).toBe(1000);
    expect(data.count).toBe(1000);
    expect(data.total).toBe(1202);
    expect(data.limit).toBe(1000);
    expect(data.has_more).toBe(true);
    expect(data.next_cursor).toBe(1000);
  });

  test("no limit defaults to a bounded page with a truncation signal", async () => {
    const { status, data } = await api("/api/memories");
    expect(status).toBe(200);
    expect(data.memories.length).toBe(1000);
    expect(data.total).toBe(1202);
    expect(data.has_more).toBe(true);
  });

  test("a small explicit limit is honored and carries the signal", async () => {
    const { status, data } = await api("/api/memories?limit=100");
    expect(status).toBe(200);
    expect(data.memories.length).toBe(100);
    expect(data.total).toBe(1202);
    expect(data.has_more).toBe(true);
    expect(data.next_cursor).toBe(100);
  });

  test("the ?fields= projection carries the same bounded-page signals", async () => {
    const { status, data } = await api("/api/memories?fields=key,value&limit=40000");
    expect(status).toBe(200);
    expect(data.memories.length).toBe(1000);
    expect(data.total).toBe(1202);
    expect(data.has_more).toBe(true);
    expect(data.next_cursor).toBe(1000);
  });

  test("the terminal page reports has_more false and no cursor", async () => {
    const { status, data } = await api("/api/memories?limit=1000&offset=1000");
    expect(status).toBe(200);
    expect(data.memories.length).toBe(202);
    expect(data.has_more).toBe(false);
    expect(data.next_cursor).toBeNull();
  });
});

describe("GET /api/memories/stale pagination contract", () => {
  test("a huge requested limit is capped at a bounded page; the TRUE count is exposed", async () => {
    const { status, data } = await api("/api/memories/stale?days=30&limit=5000");
    expect(status).toBe(200);
    expect(Array.isArray(data.memories)).toBe(true);
    expect(data.memories.length).toBe(1000);
    expect(data.total).toBe(1001); // 1202 seeded - 201 touched
    expect(data.has_more).toBe(true);
    expect(data.next_cursor).toBe(1000);
  });

  test("the old silent cap of 100 is gone: limit=100 still returns 100 but with the truth beside it", async () => {
    const { status, data } = await api("/api/memories/stale?days=30&limit=100");
    expect(status).toBe(200);
    expect(data.memories.length).toBe(100);
    expect(data.total).toBe(1001);
    expect(data.has_more).toBe(true);
    expect(data.next_cursor).toBe(100);
  });

  test("no limit defaults to a page and exposes the true count plus signal", async () => {
    const { status, data } = await api("/api/memories/stale?days=30");
    expect(status).toBe(200);
    expect(data.memories.length).toBe(20);
    expect(data.total).toBe(1001);
    expect(data.has_more).toBe(true);
    expect(data.next_cursor).toBe(20);
  });
});

describe("GET /api/memories/history pagination contract", () => {
  test("a huge requested limit is capped to a bounded page with signals", async () => {
    const { status, data } = await api("/api/memories/history?limit=5000");
    expect(status).toBe(200);
    expect(Array.isArray(data.memories)).toBe(true);
    expect(data.memories.length).toBe(200);
    expect(data.total).toBe(201);
    expect(data.has_more).toBe(true);
    expect(data.next_cursor).toBe(200);
  });
});
