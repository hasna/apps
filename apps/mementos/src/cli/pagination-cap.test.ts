// Regression tests for the silent row-cap family (BUG 2796806b):
//   (1) `mementos list --json` with no --limit returned exactly 50 rows, rc=0,
//       bare array, no truncation notice.
//   (2) `mementos stale --days 30` capped at 100 server-side; stale_count
//       mirrored the page length; no has_more / next_cursor.
//   (3) a high-limit read could hit a truncated cloud response and the CLI
//       reported its own parse failure as an error object on stdout.
//
// The contract this file locks:
//   - structured `list`/`history` with no --limit returns the FULL population
//     (a bare array cannot carry a truncation marker, so a silent default page
//     is the defect);
//   - `list --limit N` returns exactly N rows;
//   - `stale` JSON exposes the TRUE count plus has_more / next_cursor, never a
//     count that mirrors the returned page;
//   - a high-limit read walks bounded server pages and returns the full
//     population instead of one giant response;
//   - a truncated cloud response is reported as a cloud-response failure, not
//     as "the CLI's own output is unparseable".

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createMemory, touchMemory } from "../db/memories.js";
import {
  assertLocalStoreBackend,
  blankLlmProviderEnv,
  isolatedStoreEnv,
} from "../test-support/store-isolation.js";
import {
  API_URL_ENV_KEYS,
  API_KEY_ENV_KEYS,
  DATABASE_URL_ENV_KEYS,
  DB_PATH_ENV_KEYS,
} from "../db/api-mode.js";

const DB_PATH = join(tmpdir(), `mementos-pagination-cap-${Date.now()}.db`);
const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;
const CLI_ENV = isolatedStoreEnv(DB_PATH, { extra: blankLlmProviderEnv() });

async function runCli(
  env: Record<string, string>,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Capture via files, never pipes: the full-population outputs are hundreds
  // of KB, and a piped capture truncates at one 64 KiB pipe buffer with no
  // error (the capture-path rule — a CLI read must be redirected). Spawn `bun`
  // directly — a bash wrapper would source BASH_ENV and re-inject the ambient
  // production API selectors over the stub env this harness builds.
  const outFile = join(tmpdir(), `mementos-pcap-out-${Date.now()}-${Math.random()}.txt`);
  const errFile = join(tmpdir(), `mementos-pcap-err-${Date.now()}-${Math.random()}.txt`);
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    env,
    stdout: Bun.file(outFile),
    stderr: Bun.file(errFile),
  });
  const exitCode = await proc.exited;
  const stdout = existsSync(outFile) ? (await Bun.file(outFile).text()).trim() : "";
  const stderr = existsSync(errFile) ? (await Bun.file(errFile).text()).trim() : "";
  for (const f of [outFile, errFile]) {
    if (existsSync(f)) unlinkSync(f);
  }
  return { stdout, stderr, exitCode };
}

// ---------------------------------------------------------------------------
// Local-store fixtures: >50 memories, >1000 of them stale, >50 accessed ones.
// ---------------------------------------------------------------------------

const SEED_COUNT = 120;
const STALE_COUNT = 1200;

function seedLocalDb(): void {
  const db = getDatabase(DB_PATH);
  for (let i = 0; i < STALE_COUNT; i++) {
    createMemory(
      {
        key: `stale-key-${String(i).padStart(4, "0")}`,
        value: `stale value ${i}`,
        scope: "shared",
        category: "knowledge",
      },
      "create",
      db,
    );
  }
  // The first SEED_COUNT rows also get accessed_at set so they are NOT stale
  // and ARE part of the history surface.
  const fresh = db
    .query(
      "SELECT id FROM memories ORDER BY created_at ASC LIMIT ?",
    )
    .all(SEED_COUNT) as Array<{ id: string }>;
  for (const row of fresh) {
    touchMemory(row.id, db);
  }
}

beforeAll(async () => {
  await assertLocalStoreBackend(CLI_PATH, CLI_ENV, DB_PATH);
  seedLocalDb();
});

afterAll(() => {
  resetDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
});

// ---------------------------------------------------------------------------
// (1) list: no-limit structured output must return the full population
// ---------------------------------------------------------------------------

describe("list pagination contract (local store)", () => {
  test("list --format json with no --limit returns the FULL population, not a 50-row page", async () => {
    const result = await runCli(CLI_ENV, "list", "--format", "json");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("error:");
    const parsed = JSON.parse(result.stdout) as Array<{ id: string }>;
    expect(parsed.length).toBe(STALE_COUNT);
  });

  test("list --format json --limit 60 returns exactly 60 rows", async () => {
    const result = await runCli(CLI_ENV, "list", "--format", "json", "--limit", "60");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as Array<{ id: string }>;
    expect(parsed.length).toBe(60);
  });

  test("list --format json --limit 2000 returns the full population (no silent server page)", async () => {
    const result = await runCli(CLI_ENV, "list", "--format", "json", "--limit", "2000");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as Array<{ id: string }>;
    expect(parsed.length).toBe(STALE_COUNT);
  });
});

// ---------------------------------------------------------------------------
// (2) stale: JSON must expose the true count plus a pagination signal
// ---------------------------------------------------------------------------

describe("stale pagination contract (local store)", () => {
  test("stale --format json exposes the TRUE stale count and a pagination signal", async () => {
    const result = await runCli(CLI_ENV, "stale", "--days", "30", "--format", "json");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      stale_count: number;
      returned?: number;
      has_more?: boolean;
      next_cursor?: number | null;
      memories: Array<{ id: string }>;
    };
    // 120 of the 1200 memories were touched => 1080 stale. stale_count must be
    // the TRUE count, never the returned page length.
    expect(parsed.stale_count).toBe(STALE_COUNT - SEED_COUNT);
    expect(parsed.memories.length).toBeLessThan(parsed.stale_count);
    expect(parsed.has_more).toBe(true);
    expect(typeof parsed.next_cursor).toBe("number");
  });

  test("stale --limit 1000 --format json returns a full page AND keeps the true count + signal", async () => {
    const result = await runCli(
      CLI_ENV,
      "stale", "--days", "30", "--limit", "1000", "--format", "json",
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      stale_count: number;
      has_more: boolean;
      next_cursor: number | null;
      memories: Array<{ id: string }>;
    };
    expect(parsed.stale_count).toBe(STALE_COUNT - SEED_COUNT);
    expect(parsed.memories.length).toBe(1000);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_cursor).toBe(1000);
  });

  test("stale --limit 5000 --format json walks pages to honor the requested limit", async () => {
    const result = await runCli(
      CLI_ENV,
      "stale", "--days", "30", "--limit", "5000", "--format", "json",
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      stale_count: number;
      memories: Array<{ id: string }>;
    };
    expect(parsed.stale_count).toBe(STALE_COUNT - SEED_COUNT);
    expect(parsed.memories.length).toBe(STALE_COUNT - SEED_COUNT);
  });
});

// ---------------------------------------------------------------------------
// history (same family): no-limit structured output must return the full
// population, and the server page must not be silently capped.
// ---------------------------------------------------------------------------

describe("history pagination contract (local store)", () => {
  test("history --json with no --limit returns the full accessed population", async () => {
    const result = await runCli(CLI_ENV, "history", "--json");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as Array<{ id: string }>;
    expect(parsed.length).toBe(SEED_COUNT);
  });
});

// ---------------------------------------------------------------------------
// (3) API mode: high-limit reads walk bounded pages; a truncated cloud
// response is reported as a cloud failure, never as the CLI's own parse error.
// ---------------------------------------------------------------------------

function apiModeEnv(baseUrl: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of Object.keys(process.env)) {
    env[k] = process.env[k] ?? "";
  }
  for (const k of [
    ...API_URL_ENV_KEYS,
    ...API_KEY_ENV_KEYS,
    ...DATABASE_URL_ENV_KEYS,
    ...DB_PATH_ENV_KEYS,
  ]) {
    delete env[k];
  }
  env[API_URL_ENV_KEYS[0]] = baseUrl;
  env[API_KEY_ENV_KEYS[0]] = "test-key";
  return { ...env, ...blankLlmProviderEnv() };
}

describe("list pagination contract (cloud API)", () => {
  test("list --limit 40000 walks capped server pages and returns the full population", async () => {
    // Stub server that behaves like the NEW contract: pages capped at 1000
    // rows with has_more / next_cursor. The CLI must walk and return all rows.
    const total = 2750;
    const memories = Array.from({ length: total }, (_, i) => ({
      id: `mem-${String(i).padStart(5, "0")}`,
      key: `key-${i}`,
      value: `value ${i}`,
      importance: 1,
      scope: "shared",
      category: "knowledge",
    }));
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/v1/memories") {
          const limit = Math.min(Number(u.searchParams.get("limit")) || 1000, 1000);
          const offset = Number(u.searchParams.get("offset")) || 0;
          const page = memories.slice(offset, offset + limit);
          const has_more = offset + page.length < memories.length;
          return Response.json({
            memories: page,
            count: page.length,
            total: memories.length,
            limit,
            has_more,
            next_cursor: has_more ? offset + page.length : null,
          });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    try {
      const result = await runCli(
        apiModeEnv(`http://127.0.0.1:${server.port}`),
        "list", "--limit", "40000", "--format", "json",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("error:");
      const parsed = JSON.parse(result.stdout) as Array<{ id: string }>;
      expect(parsed.length).toBe(total);
    } finally {
      server.stop();
    }
  });

  test("a truncated cloud response is reported as a cloud failure, not the CLI's own parse error", async () => {
    // Stub server returning HTTP 200 with a body cut mid-string (simulates a
    // proxy response cap). The CLI must not emit the raw V8 "JSON Parse error"
    // message as its own error; the error must name the cloud response.
    const full = JSON.stringify({
      memories: Array.from({ length: 200 }, (_, i) => ({
        id: `mem-${i}`, key: `key-${i}`, value: "v".repeat(3000),
      })),
      count: 200,
    });
    const truncated = full.slice(0, 100000); // cut mid-string
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(truncated, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    try {
      const result = await runCli(
        apiModeEnv(`http://127.0.0.1:${server.port}`),
        "list", "--format", "json",
      );
      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stdout) as { error?: string };
      expect(parsed.error).toBeDefined();
      expect(parsed.error).not.toBe("JSON Parse error: Unterminated string");
      expect(parsed.error).toContain("not valid JSON");
    } finally {
      server.stop();
    }
  });
});
