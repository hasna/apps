// Regression coverage for bounded JSON receipt output. Global --json,
// --format json, and the --agent-json compatibility alias share compact,
// byte-bounded pages; --all and --full remain explicit envelope controls.
//
// Offset continuations are stable and non-overlapping only while the query's
// result set is unchanged. Equal sort keys are made deterministic by the DB's
// final id DESC tie-breaker; concurrent writes still require a fresh traversal.

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
    continuation_scope: "unchanged_snapshot";
  };
}

async function runCli(
  env: Record<string, string>,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Capture via files, never pipes: compatibility arrays and explicit --all
  // output can approach or exceed one pipe buffer.
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
  for (const file of [outFile, errFile]) {
    if (existsSync(file)) unlinkSync(file);
  }
  return { stdout, stderr, exitCode };
}

const TOTAL_COUNT = 2_205;
const HISTORY_COUNT = 1_105;
const STALE_COUNT = TOTAL_COUNT - HISTORY_COUNT;
const TIED_TIMESTAMP = "2026-09-18T10:00:00.000Z";

function fixtureId(index: number): string {
  return `fixture-memory-${String(index).padStart(5, "0")}`;
}

function descendingIds(highest: number, count: number): string[] {
  return Array.from({ length: count }, (_, offset) => fixtureId(highest - offset));
}

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
      insert.run(
        fixtureId(index),
        `fixture-key-${String(index).padStart(5, "0")}`,
        `fixture value ${index} ${"v".repeat(96)}`,
        `fixture summary ${index} ${"s".repeat(48)}`,
        JSON.stringify({ fixture: true, index, detail: "m".repeat(64) }),
        TIED_TIMESTAMP,
        TIED_TIMESTAMP,
        index < HISTORY_COUNT ? TIED_TIMESTAMP : null,
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

describe("ordinary JSON is bounded; exhaustive/full behavior is explicit", () => {
  test("list --format json defaults to a compact 20-row receipt", async () => {
    const result = await runCli(CLI_ENV, "list", "--format", "json");
    expect(result.exitCode).toBe(0);
    const page = JSON.parse(result.stdout) as StructuredPage<{ id: string; metadata?: unknown; value: string }>;
    expect(page.memories).toHaveLength(20);
    expect(page.memories.every((memory) => memory.metadata === undefined)).toBe(true);
    expect(page.memories[0]?.value.length).toBeLessThanOrEqual(240);
    expect(page._meta).toMatchObject({ receipt: "mementos.list.page.v1", has_more: true, next_cursor: 20, detail: "compact", max_bytes: 32768 });
  });

  test("ordinary JSON enforces the 1000-row page ceiling", async () => {
    const result = await runCli(CLI_ENV, "list", "--json", "--limit", "2000");
    expect(result.exitCode).toBe(1);
    expect((JSON.parse(result.stdout) as { error: string }).error).toContain("page ceiling");
  });

  test("history compatibility remains unchanged", async () => {
    const jsonFlag = await runCli(CLI_ENV, "history", "--json");
    const formatFlag = await runCli(CLI_ENV, "history", "--format", "json");
    expect(jsonFlag.exitCode).toBe(0);
    expect(formatFlag.exitCode).toBe(0);
    const first = JSON.parse(jsonFlag.stdout) as Array<{ id: string; metadata: unknown }>;
    const second = JSON.parse(formatFlag.stdout) as Array<{ id: string; metadata: unknown }>;
    expect(first).toHaveLength(HISTORY_COUNT);
    expect(second).toEqual(first);
  });

  test("--all and --full are explicit JSON compatibility controls", async () => {
    const full = await runCli(CLI_ENV, "--json", "list", "--full", "--limit", "2");
    expect(full.exitCode).toBe(0);
    const fullPage = JSON.parse(full.stdout) as StructuredPage<{ metadata: { fixture: boolean } }>;
    expect(fullPage.memories[0]?.metadata.fixture).toBe(true);
    expect(fullPage._meta).toMatchObject({ detail: "full", all: false });

    const all = await runCli(CLI_ENV, "--json", "list", "--all");
    expect(all.exitCode).toBe(0);
    const allPage = JSON.parse(all.stdout) as StructuredPage<{ id: string }>;
    expect(allPage.memories).toHaveLength(TOTAL_COUNT);
    expect(allPage._meta).toMatchObject({ all: true, complete: true, has_more: false });
  });
});

describe("list agent JSON page contract (local store)", () => {
  test("default receipt is a compact 20-row byte-bounded page", async () => {
    const result = await runCli(CLI_ENV, "list", "--agent-json");
    expect(result.exitCode).toBe(0);
    const page = JSON.parse(result.stdout) as StructuredPage<{ id: string; metadata?: unknown }>;
    expect(page.memories).toHaveLength(20);
    expect(page.memories.every((memory) => !("metadata" in memory))).toBe(true);
    expect(page.memories.map((memory) => memory.id)).toEqual(descendingIds(TOTAL_COUNT - 1, 20));
    expect(page._meta).toMatchObject({
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
      continuation_scope: "unchanged_snapshot",
    });
    expect(page._meta.response_bytes).toBe(Buffer.byteLength(`${result.stdout}\n`));
    expect(page._meta.response_bytes).toBeLessThanOrEqual(page._meta.max_bytes);
  });

  test("equal-importance/equal-timestamp pages do not overlap while the snapshot is unchanged", async () => {
    const first = JSON.parse((await runCli(CLI_ENV, "list", "--agent-json")).stdout) as StructuredPage<{ id: string }>;
    const second = JSON.parse((await runCli(
      CLI_ENV,
      "list", "--agent-json", "--cursor", String(first._meta.next_cursor),
    )).stdout) as StructuredPage<{ id: string }>;
    expect(first.memories.map((memory) => memory.id)).toEqual(descendingIds(TOTAL_COUNT - 1, 20));
    expect(second.memories.map((memory) => memory.id)).toEqual(descendingIds(TOTAL_COUNT - 21, 20));
    const firstIds = new Set(first.memories.map((memory) => memory.id));
    expect(second.memories.some((memory) => firstIds.has(memory.id))).toBe(false);
    expect(second._meta).toMatchObject({ offset: 20, next_cursor: 40, continuation_scope: "unchanged_snapshot" });
  });

  test("--full preserves complete row detail but remains a bounded receipt page", async () => {
    const result = await runCli(CLI_ENV, "list", "--agent-json", "--full", "--limit", "2");
    expect(result.exitCode).toBe(0);
    const page = JSON.parse(result.stdout) as StructuredPage<{ metadata: { fixture: boolean } }>;
    expect(page.memories).toHaveLength(2);
    expect(page.memories[0]?.metadata.fixture).toBe(true);
    expect(page._meta).toMatchObject({ detail: "full", limit: 2, has_more: true, complete: false });
  });

  test("--all explicitly exhausts >1000 rows and proves whole-query completeness", async () => {
    const result = await runCli(CLI_ENV, "list", "--agent-json", "--all");
    expect(result.exitCode).toBe(0);
    const page = JSON.parse(result.stdout) as StructuredPage<{ id: string }>;
    expect(page.memories).toHaveLength(TOTAL_COUNT);
    expect(new Set(page.memories.map((memory) => memory.id)).size).toBe(TOTAL_COUNT);
    expect(page._meta).toMatchObject({
      count: TOTAL_COUNT,
      limit: null,
      offset: 0,
      next_cursor: null,
      has_more: false,
      complete: true,
      all: true,
      max_rows: 100_000,
      max_bytes: 67_108_864,
      truncated: false,
      truncation_reason: null,
    });
  });

  test("byte clipping advances without overlap while the snapshot is unchanged", async () => {
    const firstResult = await runCli(
      CLI_ENV,
      "list", "--agent-json", "--limit", "100", "--max-bytes", "4096",
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
      continuation_scope: "unchanged_snapshot",
    });
    expect(Buffer.byteLength(`${firstResult.stdout}\n`)).toBeLessThanOrEqual(4096);

    const secondResult = await runCli(
      CLI_ENV,
      "list", "--agent-json", "--limit", "100",
      "--cursor", String(first._meta.next_cursor), "--max-bytes", "4096",
    );
    const second = JSON.parse(secondResult.stdout) as StructuredPage<{ id: string }>;
    const firstIds = new Set(first.memories.map((memory) => memory.id));
    expect(second.memories.some((memory) => firstIds.has(memory.id))).toBe(false);
    expect(second._meta.offset).toBe(first._meta.next_cursor);
  });

  test("receipt mode enforces hard page-row and exhaustive-byte ceilings", async () => {
    const rowCap = await runCli(CLI_ENV, "--json", "list", "--agent-json", "--limit", "1001");
    expect(rowCap.exitCode).toBe(1);
    expect((JSON.parse(rowCap.stdout) as { error: string }).error).toContain("agent JSON page ceiling");

    const byteCap = await runCli(
      CLI_ENV,
      "--json", "list", "--agent-json", "--all", "--max-bytes", "1024",
    );
    expect(byteCap.exitCode).toBe(1);
    expect((JSON.parse(byteCap.stdout) as { error: string }).error).toContain("hard safety limit");
  });
});

describe("stale pagination contract remains unchanged", () => {
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
    expect(parsed.memories).toHaveLength(1000);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_cursor).toBe(1000);
  });
});

describe("history agent JSON page contract (local store)", () => {
  test("default receipt is a compact 10-row page with deterministic tied ordering", async () => {
    const result = await runCli(CLI_ENV, "history", "--agent-json");
    expect(result.exitCode).toBe(0);
    const page = JSON.parse(result.stdout) as StructuredPage<{ id: string; accessed_at: string }>;
    expect(page.memories).toHaveLength(10);
    expect(page.memories.map((memory) => memory.id)).toEqual(descendingIds(HISTORY_COUNT - 1, 10));
    expect(page.memories.every((memory) => memory.accessed_at === TIED_TIMESTAMP)).toBe(true);
    expect(page._meta).toMatchObject({
      receipt: "mementos.history.page.v1",
      count: 10,
      limit: 10,
      next_cursor: 10,
      has_more: true,
      complete: false,
      detail: "compact",
      max_bytes: 32_768,
      continuation_scope: "unchanged_snapshot",
    });
  });

  test("equal-access-time pages do not overlap while the snapshot is unchanged", async () => {
    const first = JSON.parse((await runCli(CLI_ENV, "history", "--agent-json")).stdout) as StructuredPage<{ id: string }>;
    const second = JSON.parse((await runCli(
      CLI_ENV,
      "history", "--agent-json", "--cursor", String(first._meta.next_cursor),
    )).stdout) as StructuredPage<{ id: string }>;
    expect(first.memories.map((memory) => memory.id)).toEqual(descendingIds(HISTORY_COUNT - 1, 10));
    expect(second.memories.map((memory) => memory.id)).toEqual(descendingIds(HISTORY_COUNT - 11, 10));
    const firstIds = new Set(first.memories.map((memory) => memory.id));
    expect(second.memories.some((memory) => firstIds.has(memory.id))).toBe(false);
    expect(second._meta).toMatchObject({ offset: 10, continuation_scope: "unchanged_snapshot" });
  });

  test("history --full and --all remain explicit receipt-mode escape hatches", async () => {
    const fullResult = await runCli(CLI_ENV, "history", "--agent-json", "--full", "--limit", "1");
    const full = JSON.parse(fullResult.stdout) as StructuredPage<{ metadata: { fixture: boolean } }>;
    expect(fullResult.exitCode).toBe(0);
    expect(full.memories[0]?.metadata.fixture).toBe(true);
    expect(full._meta).toMatchObject({ detail: "full", limit: 1, has_more: true });

    const allResult = await runCli(CLI_ENV, "history", "--agent-json", "--all");
    expect(allResult.exitCode).toBe(0);
    const all = JSON.parse(allResult.stdout) as StructuredPage<{ id: string }>;
    expect(all.memories).toHaveLength(HISTORY_COUNT);
    expect(new Set(all.memories.map((memory) => memory.id)).size).toBe(HISTORY_COUNT);
    expect(all._meta).toMatchObject({ all: true, complete: true, has_more: false, next_cursor: null });
  });
});

describe("list pagination contract (cloud API)", () => {
  test("ordinary JSON reads one bounded /v1 page and returns a receipt", async () => {
    const total = 2_750;
    const requests: Array<{ path: string; limit: number; offset: number }> = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/v1/memories") return Response.json({ error: "not found" }, { status: 404 });
        const limit = Math.min(Number(url.searchParams.get("limit")) || 1000, 1000);
        const offset = Number(url.searchParams.get("offset")) || 0;
        requests.push({ path: url.pathname, limit, offset });
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
      const result = await runCli(apiEnv(`http://127.0.0.1:${server.port}`), "list", "--format", "json");
      expect(result.exitCode).toBe(0);
      const page = JSON.parse(result.stdout) as StructuredPage<{ id: string }>;
      expect(page.memories).toHaveLength(20);
      expect(page._meta).toMatchObject({ has_more: true, next_cursor: 20, detail: "compact" });
      expect(requests).toEqual([{ path: "/v1/memories", limit: 21, offset: 0 }]);
    } finally {
      server.stop();
    }
  });

  test("--agent-json reads one bounded page from exactly /v1/memories", async () => {
    const total = 2_750;
    const requests: Array<{ path: string; limit: number; offset: number }> = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/v1/memories") return Response.json({ error: "not found" }, { status: 404 });
        const limit = Math.min(Number(url.searchParams.get("limit")) || 1000, 1000);
        const offset = Number(url.searchParams.get("offset")) || 0;
        requests.push({ path: url.pathname, limit, offset });
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
      const result = await runCli(apiEnv(`http://127.0.0.1:${server.port}`), "list", "--agent-json");
      expect(result.exitCode).toBe(0);
      const page = JSON.parse(result.stdout) as StructuredPage<{ id: string }>;
      expect(page.memories).toHaveLength(20);
      expect(page._meta.next_cursor).toBe(20);
      expect(requests).toEqual([{ path: "/v1/memories", limit: 21, offset: 0 }]);
    } finally {
      server.stop();
    }
  });

  test("explicit agent JSON --all walks bounded server pages", async () => {
    const total = 2_750;
    const requests: Array<{ limit: number; offset: number }> = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        const limit = Math.min(Number(url.searchParams.get("limit")) || 1000, 1000);
        const offset = Number(url.searchParams.get("offset")) || 0;
        requests.push({ limit, offset });
        const count = Math.min(limit, total - offset);
        const memories = Array.from({ length: count }, (_, index) => ({
          id: `mem-${offset + index}`,
          key: `key-${offset + index}`,
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
      const result = await runCli(apiEnv(`http://127.0.0.1:${server.port}`), "list", "--agent-json", "--all");
      expect(result.exitCode).toBe(0);
      const page = JSON.parse(result.stdout) as StructuredPage<{ id: string }>;
      expect(page.memories).toHaveLength(total);
      expect(page._meta).toMatchObject({ all: true, complete: true, has_more: false });
      expect(requests).toEqual([
        { limit: 1000, offset: 0 },
        { limit: 1000, offset: 1000 },
        { limit: 1000, offset: 2000 },
      ]);
    } finally {
      server.stop();
    }
  });

  test("explicit JSON --all can exhaust populations above the old 5000-row cap", async () => {
    const total = 5_001;
    const requestLimits: number[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        const limit = Math.min(Number(url.searchParams.get("limit")) || 1000, 1000);
        const offset = Number(url.searchParams.get("offset")) || 0;
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
        "--json", "list", "--agent-json", "--all",
      );
      expect(result.exitCode).toBe(0);
      const page = JSON.parse(result.stdout) as StructuredPage<{ id: string }>;
      expect(page.memories).toHaveLength(total);
      expect(page._meta).toMatchObject({ all: true, complete: true, has_more: false, max_rows: 100000 });
      expect(requestLimits).toEqual([1000, 1000, 1000, 1000, 1000, 1000]);
    } finally {
      server.stop();
    }
  });

  test("a truncated cloud response is reported as a cloud failure", async () => {
    const full = JSON.stringify({
      memories: Array.from({ length: 200 }, (_, index) => ({
        id: `mem-${index}`, key: `key-${index}`, value: "v".repeat(3000),
      })),
      count: 200,
    });
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(full.slice(0, 100000), {
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
