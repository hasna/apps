// Set in-memory DB before any imports (this process only opens the DB to seed).
process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isolatedStoreEnv, stubApiEnv } from "../test-support/store-isolation.js";
import { getDatabase, resetDatabase } from "../db/database.js";

// ============================================================================
// Regression: `mementos remove` / `mementos forget` must resolve a PARTIAL
// (prefix) id in api mode exactly like the local path does, not require the
// full 36-character UUID.
//
// At origin/main the CLI short-circuits prefix resolution when api mode is
// active (`let id = isApiMode() ? null : resolvePartialId(...)`), falls back to
// an exact-key lookup, and only then forwards the input to the server when it
// already matches the full-UUID shape. So `mementos remove <8-char-id>` — the
// exact form every other command prints back to the operator — answered
// "Memory not found" in api mode while the same command worked locally.
//
// The server-side DELETE /api/memories/:id already resolves a unique prefix
// (deleteMemory -> resolvePartialId, TEXT id column on both backends). The
// defect is purely the CLI gate that never sends the partial through. This
// suite drives the REAL server (spawned against a temp file DB) with the REAL
// CLI in api mode, so the whole chain is exercised: CLI forwards the prefix,
// the server resolves it, the row is gone.
//
// The transport is a blocking spawnSync(curl), so both sides must be separate
// processes (same pattern as clean-legacy-fallback.test.ts).
// ============================================================================

const DB_PATH = join(tmpdir(), `mementos-remove-partial-id-${Date.now()}.db`);
const PORT = 19500 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;

const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;

// Crafted ids make the unique/ambiguous prefixes deterministic. The ids must
// be seeded directly into the file DB BEFORE the server starts — the server
// mints its own ids on POST, which cannot be made to share a prefix.
const UNIQUE = { id: "bbbbbbbb-1111-4000-8000-000000000001", key: "partial-unique" };
const AMB_A = { id: "aaaaaaa0-2222-4000-8000-000000000002", key: "partial-amb-a" };
const AMB_B = { id: "aaaaaaa1-3333-4000-8000-000000000003", key: "partial-amb-b" };
const FORGET = { id: "cccccccc-6666-4000-8000-000000000006", key: "partial-forget" };
const KEY_ROW = { id: "eeeeeeee-4444-4000-8000-000000000004", key: "key-probe-1" };
const FULL_ROW = { id: "ffffffff-5555-4000-8000-000000000005", key: "full-uuid-probe" };

let serverProc: ReturnType<typeof Bun.spawn>;

beforeAll(
  async () => {
  // Seed the shared file DB directly with ONE multi-row INSERT statement
  // (pagination-cap.test.ts pattern). Close the file handle BEFORE the server
  // process opens the same file, or the startup migration blocks on the
  // SQLite lock and the server never starts listening.
  const db = getDatabase(DB_PATH);
  const ts = new Date().toISOString();
  const rows = [UNIQUE, AMB_A, AMB_B, FORGET, KEY_ROW, FULL_ROW];
  const values = rows.map(
    (r) =>
      `('${r.id}','${r.key}','seed value','knowledge','shared',NULL,'[]',5,'agent','active',FALSE,'{}',0,1,NULL,` +
      `'${ts}',NULL,'${ts}','${ts}','${ts}')`,
  );
  db.exec(
    `INSERT INTO memories (id, key, value, category, scope, summary, tags, importance,
       source, status, pinned, metadata, access_count, version, expires_at,
       valid_from, valid_until, ingested_at, created_at, updated_at)
     VALUES ${values.join(",")}`,
  );
  db.close();
  resetDatabase();

  serverProc = Bun.spawn(
    ["bun", "run", "src/server/index.ts", "--port", String(PORT)],
    {
      // This suite exercises CLI partial-id resolution, not server auth: the
      // server runs with no API key and accepts the stub-keyed CLI. The server
      // now fails closed on state-changing requests without a configured key
      // and allowlists origins on mutations, so opt in explicitly and name the
      // loopback origin the CLI's curl uses (security P1, todos d836c304).
      env: isolatedStoreEnv(DB_PATH, {
        extra: {
          MEMENTOS_ALLOW_UNAUTHENTICATED_WRITES: "1",
          MEMENTOS_CORS_ORIGIN: `http://127.0.0.1:${PORT}`,
        },
      }),
      stdout: "pipe",
      stderr: "pipe",
      cwd: new URL("../../", import.meta.url).pathname.replace(/\/$/, ""),
    }
  );
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* not ready yet */
    }
    await Bun.sleep(200);
  }
  if (!ready) throw new Error("Server failed to start");
  },
  30000
);

afterAll(() => {
  serverProc?.kill();
  try {
    unlinkSync(DB_PATH);
  } catch {
    // already gone
  }
  resetDatabase();
});

async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // The CLI runs in api mode ON PURPOSE, against the loopback real server.
  // stubApiEnv strips ambient selectors first (overriding the URL alone is not
  // enough — the operator's real endpoint would take over).
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    env: stubApiEnv(BASE),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("mementos remove in api mode resolves a partial (prefix) id", () => {
  test("remove <8-char prefix> deletes the row the prefix resolves to", async () => {
    const { stdout, stderr, exitCode } = await runCli(["remove", "bbbbbbbb", "--json"]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout.trim()) as { deleted?: string; error?: string };
    // The api-mode success contract emits the INPUT (the server's DELETE
    // response carries no resolved id); the deletion itself is proven by the
    // 404 read-back below.
    expect(parsed.deleted).toBe("bbbbbbbb");

    const after = await fetch(`${BASE}/api/memories/${UNIQUE.id}`);
    expect(after.status).toBe(404);
  });

  test("remove <ambiguous prefix> fails loudly and deletes nothing", async () => {
    const { stdout, exitCode } = await runCli(["remove", "aaaaaaa", "--json"]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim()) as { deleted?: string; error?: string };
    expect(parsed.error).toContain("Memory not found");
    expect(parsed.deleted).toBeUndefined();

    for (const row of [AMB_A, AMB_B]) {
      const res = await fetch(`${BASE}/api/memories/${row.id}`);
      expect(res.status).toBe(200);
    }
  });

  test("remove <prefix matching nothing> fails loudly", async () => {
    const { stdout, exitCode } = await runCli(["remove", "dddddddd", "--json"]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim()) as { deleted?: string; error?: string };
    expect(parsed.error).toContain("Memory not found");
    expect(parsed.deleted).toBeUndefined();
  });

  test("remove <exact key> still routes through the key lookup", async () => {
    const { stdout, exitCode } = await runCli(["remove", KEY_ROW.key, "--json"]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim()) as { deleted?: string; error?: string };
    expect(parsed.deleted).toBe(KEY_ROW.id);

    const after = await fetch(`${BASE}/api/memories/${KEY_ROW.id}`);
    expect(after.status).toBe(404);
  });

  test("remove <full uuid> still deletes", async () => {
    const { stdout, exitCode } = await runCli(["remove", FULL_ROW.id, "--json"]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim()) as { deleted?: string; error?: string };
    expect(parsed.deleted).toBe(FULL_ROW.id);

    const after = await fetch(`${BASE}/api/memories/${FULL_ROW.id}`);
    expect(after.status).toBe(404);
  });
});

describe("mementos forget in api mode resolves a partial (prefix) id", () => {
  test("forget <8-char prefix> deletes the row the prefix resolves to", async () => {
    const { stdout, stderr, exitCode } = await runCli(["forget", "cccccccc", "--json"]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout.trim()) as { deleted?: string; error?: string };
    // Same input-as-deleted contract as `remove` in api mode; the deletion is
    // proven by the 404 read-back below.
    expect(parsed.deleted).toBe("cccccccc");

    const after = await fetch(`${BASE}/api/memories/${FORGET.id}`);
    expect(after.status).toBe(404);
  });

  test("forget <prefix matching nothing> fails loudly", async () => {
    const { stdout, exitCode } = await runCli(["forget", "dddddddd", "--json"]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim()) as { deleted?: string; error?: string };
    expect(parsed.error).toContain("No memory found");
    expect(parsed.deleted).toBeUndefined();
  });
});
