// Regression tests for bounded, receipt-bearing structured collection reads.
// JSON list/history output must never turn an omitted --limit into an implicit
// whole-store traversal. Defaults match the compact human pages, continuations
// are lossless, and explicit exhaustion is guarded by hard row/byte ceilings.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, resetDatabase } from "../db/database.js";
import {
  assertLocalStoreBackend,
  blankLlmProviderEnv,
  isolatedStoreEnv,
  stubApiEnv,
} from "../test-support/store-isolation.js";

const DB_PATH = join(tmpdir(), `mementos-pagination-cap-${Date.now()}.db`);
const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;
const CLI_ENV = isolatedStoreEnv(DB_PATH, { extra: blankLlmProviderEnv() });
const API_HOME = mkdtempSync(join(tmpdir(), "mementos-pagination-api-home-"));

function apiEnv(baseUrl: string): Record<string, string> {
  return {
    ...stubApiEnv(baseUrl, { apiKey: "test-key" }),
    HOME: API_HOME,
    HASNA_HOME: API_HOME,
    HASNA_CONFIG_HOME: API_HOME,
    HASNA_STATION: "mementos-pagination-no-keychain",
    ...blankLlmProviderEnv(),
  };
}

interface StructuredPage<T = Record<string, unknown>> {
  memories: T[];
  _meta: {
    receipt: string;
    count: number;
    limit: number | null;
    offset: number;
    next_cursor: number | null;
    has_more: boolean;
    complete: boolean;
    all: boolean;
    detail: "compact" | "full";
    max_rows: number;
    max_bytes: number;
    response_bytes: number;
    truncated: boolean;
    truncation_reason: "limit" | "cursor" | "max_bytes" | null;
    omitted_from_page: number;
    next_arguments: Record<string, unknown> | null;
  };
}

async function runCli(
  env: Record<string, string>,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Capture via files, never pipes: explicit --all output can approach 1 MiB.
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

// Both list and history fixtures exceed one server page. The remaining rows
// are stale, so the pre-existing stale pagination contract stays covered too.
const TOTAL_COUNT = 2_205;
const HISTORY_COUNT = 1_105;
const STALE_COUNT = TOTAL_COUNT - HISTORY_COUNT;

function seedLocalDb(): void {
  const db = getDatabase(DB_PATH);
  const insert = db.prepare(`
    INSERT INTO memories (
      id, key, value, category, scope, summary, tags, importance, source,
      status, pinned, metadata, access_count, version, created_at, updated_at,
      accessed_at
    ) VALUES (?, ?, ?, 'knowledge', 'shared', ?, '[]', 5, 'agent',
      'active', FALSE, ?, 0, 1, ?, ?, ?)
  `);
  db.transaction(() => {
    for (let index = 0; index < TOTAL_COUNT; index += 1) {
      const timestamp = new Date(Date.UTC(2026, 8, 18, 10, 0, 0, index)).toISOString();
      insert.run(
        `fixture-memory-${String(index).padStart(5, "0")}`,
        `fixture-key-${String(index).padStart(5, "0")}`,
        `fixture value ${index} ${"v".repeat(96)}`,
        `fixture summary ${index} ${"s".repeat(48)}`,
        JSON.stringify({ fixture: true, index, detail: "m".repeat(64) }),
        timestamp,
        timestamp,
        index < HISTORY_COUNT ? timestamp : null,
      );
    }
  });
}

beforeAll(async () => {
  await assertLocalStoreBackend(CLI_PATH, CLI_ENV, DB_PATH);
  seedLocalDb();
});

afterAll(() => {
  resetDatabase();
  rmSync(API_HOME, { recursive: true, force: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
});

describe("list structured pagination contract (local store)", () => {
  test("default JSON is a compact 20-row page with a continuation receipt", async () => {
    const result = await runCli(CLI_ENV, "list", "--format", "json");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("error:");
    const parsed = JSON.parse(result.stdout) as StructuredPage<{ id: string; metadata?: unknown }>;
    expect(parsed.memories).toHaveLength(20);
    expect(parsed.memories.every((memory) => !("metadata" in memory))).toBe(true);
    expect(parsed._meta).toMatchObject({
      receipt: "mementos.list.page.v1",
      count: 20,
      limit: 20,
      offset: 0,
      next_cursor: 20,
      has_more: true,
      complete: false,
      all: false,
      detail: "compact",
      max_rows: 1_000,
      max_bytes: 32_768,
      truncated: true,
      truncation_reason: "limit",
    });
    expect(parsed._meta.response_bytes).toBe(Buffer.byteLength(`${result.stdout}\n`));
    expect(parsed._meta.response_bytes).toBeLessThanOrEqual(parsed._meta.max_bytes);
  });

  test("continuation pages have no overlap and carry the next receipt", async () => {
    const first = JSON.parse((await runCli(CLI_ENV, "list", "--format", "json")).stdout) as StructuredPage<{ id: string }>;
    const second = JSON.parse((await runCli(
      CLI_ENV,
      "list", "--format", "json", "--cursor", String(first._meta.next_cursor),
    )).stdout) as StructuredPage<{ id: string }>;
    const firstIds = new Set(first.memories.map((memory) => memory.id));
    expect(second._meta.offset).toBe(first._meta.next_cursor);
    expect(second.memories.some((memory) => firstIds.has(memory.id))).toBe(false);
    expect(second._meta.next_cursor).toBe(40);
  });

  test("an explicit page limit is honored without exhaustion", async () => {
    const result = await runCli(CLI_ENV, "list", "--format", "json", "--limit", "60");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as StructuredPage<{ id: string }>;
    expect(parsed.memories).toHaveLength(60);
    expect(parsed._meta).toMatchObject({ limit: 60, next_cursor: 60, has_more: true });
  });

  test("--full is explicit full detail but remains a bounded page", async () => {
    const result = await runCli(CLI_ENV, "list", "--format", "json", "--full", "--limit", "2");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as StructuredPage<{ metadata: { fixture: boolean } }>;
    expect(parsed.memories).toHaveLength(2);
    expect(parsed.memories[0]?.metadata.fixture).toBe(true);
    expect(parsed._meta).toMatchObject({ detail: "full", limit: 2, has_more: true, complete: false });
  });

  test("--all explicitly exhausts >1000 rows and proves whole-query completeness", async () => {
    const result = await runCli(CLI_ENV, "list", "--format", "json", "--all");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as StructuredPage<{ id: string }>;
    expect(parsed.memories).toHaveLength(TOTAL_COUNT);
    expect(new Set(parsed.memories.map((memory) => memory.id)).size).toBe(TOTAL_COUNT);
    expect(parsed._meta).toMatchObject({
      count: TOTAL_COUNT,
      limit: null,
      offset: 0,
      next_cursor: null,
      has_more: false,
      complete: true,
      all: true,
      max_rows: 5_000,
      max_bytes: 1_048_576,
      truncated: false,
      truncation_reason: null,
    });
    expect(parsed._meta.response_bytes).toBeLessThanOrEqual(parsed._meta.max_bytes);
  });

  test("byte clipping advances the continuation without overlap", async () => {
    const firstResult = await runCli(
      CLI_ENV,
      "list", "--format", "json", "--limit", "100", "--max-bytes", "4096",
    );
    expect(firstResult.exitCode).toBe(0);
    const first = JSON.parse(firstResult.stdout) as StructuredPage<{ id: string }>;
    expect(first.memories.length).toBeGreaterThan(0);
    expect(first.memories.length).toBeLessThan(100);
    expect(first._meta).toMatchObject({
      has_more: true,
      next_cursor: first.memories.length,
      truncated: true,
      truncation_reason: "max_bytes",
      max_bytes: 4096,
    });
    expect(Buffer.byteLength(`${firstResult.stdout}\n`)).toBeLessThanOrEqual(4096);

    const secondResult = await runCli(
      CLI_ENV,
      "list", "--format", "json", "--limit", "100",
      "--cursor", String(first._meta.next_cursor), "--max-bytes", "4096",
    );
    const second = JSON.parse(secondResult.stdout) as StructuredPage<{ id: string }>;
    const firstIds = new Set(first.memories.map((memory) => memory.id));
    expect(second.memories.some((memory) => firstIds.has(memory.id))).toBe(false);
    expect(second._meta.offset).toBe(first._meta.next_cursor);
  });

  test("hard row and exhaustive byte ceilings fail closed", async () => {
    const rowCap = await runCli(CLI_ENV, "list", "--format", "json", "--limit", "1001");
    expect(rowCap.exitCode).toBe(1);
    expect((JSON.parse(rowCap.stdout) as { error: string }).error).toContain("hard page ceiling");

    const byteCap = await runCli(
      CLI_ENV,
      "list", "--format", "json", "--all", "--max-bytes", "1024",
    );
    expect(byteCap.exitCode).toBe(1);
    expect((JSON.parse(byteCap.stdout) as { error: string }).error).toContain("hard safety limit");
  });
});

describe("stale pagination contract (local store)", () => {
  test("stale JSON exposes the true count plus a pagination signal", async () => {
    const result = await runCli(CLI_ENV, "stale", "--days", "30", "--format", "json");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      stale_count: number;
      has_more?: boolean;
      next_cursor?: number | null;
      memories: Array<{ id: string }>;
    };
    expect(parsed.stale_count).toBe(STALE_COUNT);
    expect(parsed.memories.length).toBeLessThan(parsed.stale_count);
    expect(parsed.has_more).toBe(true);
    expect(typeof parsed.next_cursor).toBe("number");
  });

  test("stale --limit 1000 keeps the true count and continuation", async () => {
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
    expect(parsed.stale_count).toBe(STALE_COUNT);
    expect(parsed.memories.length).toBe(1000);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_cursor).toBe(1000);
  });
});

describe("history structured pagination contract (local store)", () => {
  test("default JSON is a compact 10-row receipt, not implicit exhaustion", async () => {
    const result = await runCli(CLI_ENV, "history", "--format", "json");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as StructuredPage<{ id: string; accessed_at: string }>;
    expect(parsed.memories).toHaveLength(10);
    expect(parsed.memories.every((memory) => typeof memory.accessed_at === "string")).toBe(true);
    expect(parsed._meta).toMatchObject({
      receipt: "mementos.history.page.v1",
      count: 10,
      limit: 10,
      next_cursor: 10,
      has_more: true,
      complete: false,
      detail: "compact",
      max_bytes: 32_768,
    });
  });

  test("history continuation has no overlap", async () => {
    const first = JSON.parse((await runCli(CLI_ENV, "history", "--json")).stdout) as StructuredPage<{ id: string }>;
    const second = JSON.parse((await runCli(
      CLI_ENV,
      "history", "--json", "--cursor", String(first._meta.next_cursor),
    )).stdout) as StructuredPage<{ id: string }>;
    const firstIds = new Set(first.memories.map((memory) => memory.id));
    expect(second.memories.some((memory) => firstIds.has(memory.id))).toBe(false);
    expect(second._meta.offset).toBe(10);
  });

  test("history --full preserves complete row detail on a bounded page", async () => {
    const result = await runCli(CLI_ENV, "history", "--json", "--full", "--limit", "1");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as StructuredPage<{ metadata: { fixture: boolean } }>;
    expect(parsed.memories).toHaveLength(1);
    expect(parsed.memories[0]?.metadata.fixture).toBe(true);
    expect(parsed._meta).toMatchObject({ detail: "full", limit: 1, has_more: true });
  });

  test("history --all explicitly exhausts its >1000-row population", async () => {
    const result = await runCli(CLI_ENV, "history", "--json", "--all");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as StructuredPage<{ id: string }>;
    expect(parsed.memories).toHaveLength(HISTORY_COUNT);
    expect(new Set(parsed.memories.map((memory) => memory.id)).size).toBe(HISTORY_COUNT);
    expect(parsed._meta).toMatchObject({ all: true, complete: true, has_more: false, next_cursor: null });
  });
});

describe("list structured pagination contract (cloud API)", () => {
  test("default JSON reads one bounded page from exactly /v1/memories", async () => {
    const total = 2_750;
    const requests: Array<{ path: string; limit: number; offset: number }> = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/v1/memories") {
          const limit = Math.min(Number(u.searchParams.get("limit")) || 1000, 1000);
          const offset = Number(u.searchParams.get("offset")) || 0;
          requests.push({ path: u.pathname, limit, offset });
          const page = Array.from({ length: Math.min(limit, total - offset) }, (_, index) => ({
            id: `mem-${String(offset + index).padStart(5, "0")}`,
            key: `key-${offset + index}`,
            value: `value ${offset + index}`,
            importance: 1,
            scope: "shared",
            category: "knowledge",
          }));
          const has_more = offset + page.length < total;
          return Response.json({
            memories: page,
            count: page.length,
            total,
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
        apiEnv(`http://127.0.0.1:${server.port}`),
        "list", "--format", "json",
      );
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as StructuredPage<{ id: string }>;
      expect(parsed.memories).toHaveLength(20);
      expect(parsed._meta.next_cursor).toBe(20);
      expect(requests).toEqual([{ path: "/v1/memories", limit: 21, offset: 0 }]);
    } finally {
      server.stop();
    }
  });

  test("explicit --all walks bounded server pages and returns a complete receipt", async () => {
    const total = 2_750;
    const requests: Array<{ limit: number; offset: number }> = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname !== "/v1/memories") return Response.json({ error: "not found" }, { status: 404 });
        const limit = Math.min(Number(u.searchParams.get("limit")) || 1000, 1000);
        const offset = Number(u.searchParams.get("offset")) || 0;
        requests.push({ limit, offset });
        const count = Math.min(limit, total - offset);
        const memories = Array.from({ length: count }, (_, index) => ({
          id: `mem-${String(offset + index).padStart(5, "0")}`,
          key: `key-${offset + index}`,
          value: `value ${offset + index}`,
          importance: 1,
          scope: "shared",
          category: "knowledge",
        }));
        const has_more = offset + memories.length < total;
        return Response.json({ memories, has_more, next_cursor: has_more ? offset + memories.length : null });
      },
    });
    try {
      const result = await runCli(
        apiEnv(`http://127.0.0.1:${server.port}`),
        "list", "--format", "json", "--all",
      );
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as StructuredPage<{ id: string }>;
      expect(parsed.memories).toHaveLength(total);
      expect(parsed._meta).toMatchObject({ all: true, complete: true, has_more: false });
      expect(requests).toEqual([
        { limit: 1000, offset: 0 },
        { limit: 1000, offset: 1000 },
        { limit: 1000, offset: 2000 },
      ]);
    } finally {
      server.stop();
    }
  });

  test("explicit --all refuses a 5001st row instead of returning a partial success", async () => {
    const total = 5_001;
    const requestLimits: number[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        const limit = Math.min(Number(u.searchParams.get("limit")) || 1000, 1000);
        const offset = Number(u.searchParams.get("offset")) || 0;
        requestLimits.push(limit);
        const count = Math.min(limit, total - offset);
        const memories = Array.from({ length: count }, (_, index) => ({
          id: `cap-${offset + index}`,
          key: `cap-key-${offset + index}`,
          value: "v",
          importance: 1,
          scope: "shared",
          category: "knowledge",
        }));
        const has_more = offset + memories.length < total;
        return Response.json({ memories, has_more, next_cursor: has_more ? offset + memories.length : null });
      },
    });
    try {
      const result = await runCli(
        apiEnv(`http://127.0.0.1:${server.port}`),
        "list", "--format", "json", "--all",
      );
      expect(result.exitCode).toBe(1);
      expect((JSON.parse(result.stdout) as { error: string }).error).toContain("5000 rows");
      expect(requestLimits.every((limit) => limit <= 1000)).toBe(true);
      expect(requestLimits).toEqual([1000, 1000, 1000, 1000, 1000, 1]);
    } finally {
      server.stop();
    }
  });

  test("a truncated cloud response is reported as a cloud failure", async () => {
    const full = JSON.stringify({
      memories: Array.from({ length: 200 }, (_, i) => ({
        id: `mem-${i}`, key: `key-${i}`, value: "v".repeat(3000),
      })),
      count: 200,
    });
    const truncated = full.slice(0, 100000);
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
        apiEnv(`http://127.0.0.1:${server.port}`),
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
