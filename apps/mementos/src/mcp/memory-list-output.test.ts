process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { beforeEach, describe, expect, test } from "bun:test";
import { createMemory, getDatabase, resetDatabase } from "../index.js";
import { buildServer } from "./index.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type InternalServer = ReturnType<typeof buildServer> & {
  _registeredTools: Record<string, { handler(args: Record<string, unknown>): Promise<ToolResult> }>;
};

function freshDb(): void {
  resetDatabase();
  getDatabase(":memory:");
}

async function callMemoryList(args: Record<string, unknown>): Promise<ToolResult> {
  const server = buildServer("core") as InternalServer;
  return server._registeredTools.memory_list!.handler(args);
}

describe("memory_list full response", () => {
  beforeEach(() => freshDb());

  test("returns a bounded page envelope with a usable continuation", async () => {
    createMemory({ key: "one", value: "first" });
    createMemory({ key: "two", value: "second" });
    createMemory({ key: "three", value: "third" });

    const first = await callMemoryList({ full: true, limit: 2, offset: 0 });
    const firstPayload = JSON.parse(first.content[0]!.text) as {
      items: Array<{ id: string }>;
      _meta: Record<string, unknown>;
    };
    expect(firstPayload.items).toHaveLength(2);
    expect(firstPayload.items.every((item) => item.id.length > 8)).toBe(true);
    expect(firstPayload._meta).toEqual({
      count: 2,
      limit: 2,
      offset: 0,
      next_offset: 2,
      has_more: true,
      complete: false,
      truncated: true,
      detail: "full",
      fields: null,
      max_bytes: 65536,
      truncation_reason: "limit",
      blocked_item_id: null,
      detail_hint: null,
    });

    const second = await callMemoryList({ full: true, limit: 2, offset: 2 });
    const secondPayload = JSON.parse(second.content[0]!.text) as {
      items: Array<{ id: string }>;
      _meta: Record<string, unknown>;
    };
    expect(secondPayload.items).toHaveLength(1);
    expect(secondPayload._meta).toEqual({
      count: 1,
      limit: 2,
      offset: 2,
      next_offset: null,
      has_more: false,
      complete: true,
      truncated: false,
      detail: "full",
      fields: null,
      max_bytes: 65536,
      truncation_reason: null,
      blocked_item_id: null,
      detail_hint: null,
    });
  });

  test("empty full results still return truthful machine-readable metadata", async () => {
    const response = await callMemoryList({ full: true, limit: 10 });
    const payload = JSON.parse(response.content[0]!.text) as { items: unknown[]; _meta: Record<string, unknown> };
    expect(payload.items).toEqual([]);
    expect(payload._meta).toMatchObject({
      count: 0,
      limit: 10,
      offset: 0,
      next_offset: null,
      has_more: false,
      complete: true,
      truncated: false,
      detail: "full",
      max_bytes: 65536,
    });
  });

  test("field projection remains bounded and declares the selected fields", async () => {
    createMemory({ key: "projected", value: "hidden from projection", importance: 8 });
    const response = await callMemoryList({ full: true, limit: 10, fields: ["id", "key", "version"] });
    const payload = JSON.parse(response.content[0]!.text) as {
      items: Array<Record<string, unknown>>;
      _meta: { fields: string[] };
    };
    expect(Object.keys(payload.items[0]!).sort()).toEqual(["id", "key", "version"]);
    expect(payload._meta.fields).toEqual(["id", "key", "version"]);
    expect(response.content[0]!.text.includes("\n")).toBe(false);
  });
  test("default compact output stays bounded and discloses continuation", async () => {
    for (let index = 0; index < 12; index += 1) {
      createMemory({ key: `compact-${index}`, value: "x".repeat(5_000) });
    }
    const response = await callMemoryList({});
    const text = response.content[0]!.text;
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4 * 1024);
    expect(text).toContain("10+ memories:");
    expect(text).toContain("more available: call memory_list with offset=10, limit=10");
    expect(text).not.toContain("x".repeat(500));
  });

  test("full output enforces max_bytes and names an oversized blocking item", async () => {
    const memory = createMemory({ key: "oversized", value: "z".repeat(100_000) });
    const response = await callMemoryList({ full: true, limit: 10, max_bytes: 4096 });
    expect(Buffer.byteLength(response.content[0]!.text)).toBeLessThanOrEqual(4096);
    const payload = JSON.parse(response.content[0]!.text) as {
      items: unknown[];
      _meta: Record<string, unknown>;
    };
    expect(payload.items).toEqual([]);
    expect(payload._meta).toMatchObject({
      count: 0,
      next_offset: null,
      has_more: true,
      complete: false,
      truncated: true,
      truncation_reason: "max_bytes",
      max_bytes: 4096,
      blocked_item_id: memory.id,
    });
    expect(String(payload._meta.detail_hint)).toContain("memory_get");
  });

});
