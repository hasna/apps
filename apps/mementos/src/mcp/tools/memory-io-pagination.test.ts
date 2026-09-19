// MCP export is always a truthful bounded receipt. Continuations contain only
// accepted memory_export inputs and terminal pages carry no truncation reason.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../index.js";
import {
  startMemoriesPageStubProcess,
  waitForMemoriesPageStub,
  type MemoriesPageStubProcess,
} from "../../test-support/memories-page-stub.js";
import {
  API_URL_ENV_KEYS,
  API_KEY_ENV_KEYS,
  DB_PATH_ENV_KEYS,
} from "../../db/api-mode.js";

const ROWS = 1500;
let stub: MemoriesPageStubProcess;

beforeAll(async () => {
  stub = startMemoriesPageStubProcess(ROWS);
  await waitForMemoriesPageStub(stub.baseUrl);
  for (const key of DB_PATH_ENV_KEYS) delete process.env[key];
  process.env[API_URL_ENV_KEYS[0]] = stub.baseUrl;
  process.env[API_KEY_ENV_KEYS[0]] = "test-key";
});

afterAll(() => {
  stub.stop();
  delete process.env[API_URL_ENV_KEYS[0]];
  delete process.env[API_KEY_ENV_KEYS[0]];
  process.env["MEMENTOS_DB_PATH"] = ":memory:";
});

interface ExportReceipt {
  memories: Array<{ id: string }>;
  _meta: {
    count: number;
    offset: number;
    has_more: boolean;
    next_offset: number | null;
    complete: boolean;
    truncated: boolean;
    truncation_reason: string | null;
    max_bytes: number;
    next_arguments: { format: "json"; offset: number; limit: number; max_bytes: number; scope?: string } | null;
  };
}

async function receipt(client: Client, args: Record<string, unknown>): Promise<ExportReceipt> {
  const result = await client.callTool({ name: "memory_export", arguments: args });
  const text = result.content?.find((content) => content.type === "text")?.text ?? "";
  return JSON.parse(text) as ExportReceipt;
}

describe("memory_export truthful pagination in api mode", () => {
  test("continuation uses only accepted inputs and follows without overlap", async () => {
    const server = buildServer("admin");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "pagination-test", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      const first = await receipt(client, { format: "json", scope: "shared" });
      expect(first.memories).toHaveLength(20);
      expect(first._meta).toMatchObject({ count: 20, has_more: true, next_offset: 20, complete: false, max_bytes: 65536 });
      expect(Object.keys(first._meta.next_arguments!).sort()).toEqual(["format", "limit", "max_bytes", "offset", "scope"]);
      expect(first._meta.next_arguments!.scope).toBe("shared");

      const second = await receipt(client, first._meta.next_arguments!);
      expect(second._meta.offset).toBe(20);
      const firstIds = new Set(first.memories.map((memory) => memory.id));
      expect(second.memories.some((memory) => firstIds.has(memory.id))).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("terminal receipt has truncated=false, null reason, and no continuation", async () => {
    const server = buildServer("admin");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "terminal-test", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      const terminal = await receipt(client, { format: "json", offset: 1490, limit: 20 });
      expect(terminal.memories).toHaveLength(10);
      expect(terminal._meta).toMatchObject({
        offset: 1490,
        has_more: false,
        next_offset: null,
        truncated: false,
        truncation_reason: null,
        next_arguments: null,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
