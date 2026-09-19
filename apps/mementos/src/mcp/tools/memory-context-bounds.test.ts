import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "../index.js";
import { createMemory } from "../../db/memories.js";
import { getDatabase, resetDatabase } from "../../db/database.js";

const DB_PATH = join(tmpdir(), `mementos-context-bounds-${Date.now()}.db`);
const previous = process.env["MEMENTOS_DB_PATH"];

type RegisteredServer = ReturnType<typeof buildServer> & {
  _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }>;
};

beforeAll(() => {
  process.env["MEMENTOS_DB_PATH"] = DB_PATH;
  const db = getDatabase(DB_PATH);
  for (let index = 0; index < 30; index += 1) {
    createMemory({
      key: `context-large-${String(index).padStart(2, "0")}`,
      value: `value-${index}-${"x".repeat(5_000)}`,
      scope: "global",
      category: "knowledge",
      importance: 10 - (index % 5),
    }, "merge", db);
  }
});

afterAll(() => {
  resetDatabase();
  if (previous === undefined) delete process.env["MEMENTOS_DB_PATH"];
  else process.env["MEMENTOS_DB_PATH"] = previous;
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const server = buildServer(name === "memory_context" ? "search" : "core") as RegisteredServer;
  const result = await server._registeredTools[name]!.handler(args);
  expect(result.isError).not.toBe(true);
  return result.content.find((entry) => entry.type === "text")?.text ?? "";
}

describe("memory_context bounded defaults", () => {
  test("ordinary context is ten compact previews under 32 KiB with ranking continuation", async () => {
    const text = await call("memory_context");
    const page = JSON.parse(text) as {
      memories: Array<{ id: string; preview: string; value?: string }>;
      _meta: { count: number; next_offset: number; has_more: boolean; max_bytes: number; response_bytes: number; total_ranked: number; ranking: { order: string } };
    };
    expect(page.memories).toHaveLength(10);
    expect(page.memories.every((memory) => memory.value === undefined && memory.preview.length <= 240)).toBe(true);
    expect(page._meta).toMatchObject({ count: 10, next_offset: 10, has_more: true, max_bytes: 32768, total_ranked: 30 });
    expect(page._meta.ranking.order).toContain("effective_score_desc");
    expect(Buffer.byteLength(text)).toBe(page._meta.response_bytes);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(32 * 1024);
  });

  test("continuation pages do not overlap and explicit full preserves complete values", async () => {
    const first = JSON.parse(await call("memory_context")) as { memories: Array<{ id: string }>; _meta: { next_offset: number } };
    const second = JSON.parse(await call("memory_context", { offset: first._meta.next_offset })) as { memories: Array<{ id: string }> };
    const firstIds = new Set(first.memories.map((memory) => memory.id));
    expect(second.memories.some((memory) => firstIds.has(memory.id))).toBe(false);

    const full = JSON.parse(await call("memory_context", { detail: "full", limit: 2 })) as {
      memories: Array<{ value: string }>;
      _meta: { detail: string; max_bytes: number };
    };
    expect(full.memories).toHaveLength(2);
    expect(full.memories[0]!.value.length).toBeGreaterThan(5_000);
    expect(full._meta).toMatchObject({ detail: "full", max_bytes: 65536 });
  });
});

describe("memory_inject hint default", () => {
  test("broad calls default to hints and explicit mode=full preserves content", async () => {
    const hints = await call("memory_inject", { min_importance: 1 });
    expect(hints).toContain("You have relevant memories available");
    expect(hints).not.toContain("x".repeat(500));

    const full = await call("memory_inject", { min_importance: 1, mode: "full", format: "compact", max_tokens: 2_000 });
    expect(full).toContain("context-large-");
    expect(full).toContain("x".repeat(500));
  });
});
