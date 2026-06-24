import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./index.js";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-mcp-compact-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("MCP compact output", () => {
  test("list_files is compact by default and verbose preserves full records", async () => {
    const fixture = await seedFiles();
    const { client, close } = await connectedClient();
    try {
      const sources = await client.callTool({
        name: "list_sources",
        arguments: { limit: 1 },
      });
      const sourceJson = JSON.parse(text(sources)) as {
        items: Array<{ location: string }>;
        hint?: string;
      };
      expect(sourceJson.items[0]?.location).toContain("...");
      expect(sourceJson.hint).toContain("verbose=true");
      expect(sourceJson.hint).not.toContain("get_source");

      const compact = await client.callTool({
        name: "list_files",
        arguments: { limit: 1 },
      });
      const compactJson = JSON.parse(text(compact)) as {
        count: number;
        items: Array<{ id: string; path: string; mime?: string }>;
        hint?: string;
      };
      expect(compactJson.count).toBe(1);
      expect(compactJson.items[0]?.id).toBe(fixture.fileId);
      expect(compactJson.items[0]?.path).toContain("...");
      expect(compactJson.items[0]?.path).not.toBe(fixture.longPath);
      expect(compactJson.items[0]?.mime).toBeUndefined();
      expect(compactJson.hint).toContain("verbose=true");

      const verbose = await client.callTool({
        name: "list_files",
        arguments: { limit: 1, verbose: true },
      });
      const verboseJson = JSON.parse(text(verbose)) as Array<{ id: string; path: string; mime: string }>;
      expect(verboseJson[0]).toMatchObject({
        id: fixture.fileId,
        path: fixture.longPath,
        mime: "text/plain",
      });
    } finally {
      await close();
    }
  });

  test("find_duplicates caps files per group unless verbose is requested", async () => {
    await seedFiles();
    const { client, close } = await connectedClient();
    try {
      const compact = await client.callTool({
        name: "find_duplicates",
        arguments: { files_per_group: 1 },
      });
      const compactJson = JSON.parse(text(compact)) as {
        items: Array<{ files: unknown[]; omitted_files?: number; hint?: string }>;
        hint?: string;
      };
      expect(compactJson.items[0]?.files).toHaveLength(1);
      expect(compactJson.items[0]?.omitted_files).toBeGreaterThan(0);
      expect(compactJson.hint).toContain("verbose=true");

      const verbose = await client.callTool({
        name: "find_duplicates",
        arguments: { verbose: true },
      });
      const verboseJson = JSON.parse(text(verbose)) as { items: Array<{ files: unknown[]; omitted_files?: number }> };
      expect(verboseJson.items[0]?.files.length).toBeGreaterThan(1);
      expect(verboseJson.items[0]?.omitted_files).toBeUndefined();
    } finally {
      await close();
    }
  });

  test("organization audit export is summarized by default", async () => {
    const { client, close } = await connectedClient();
    try {
      const compact = await client.callTool({
        name: "files_organization_export_audit",
        arguments: {},
      });
      const compactJson = JSON.parse(text(compact)) as {
        summary: unknown;
        unresolved_rows?: unknown[];
        sample_rows: Record<string, unknown[]>;
        hint?: string;
      };
      expect(compactJson.summary).toBeDefined();
      expect(compactJson.unresolved_rows).toBeUndefined();
      expect(Array.isArray(compactJson.sample_rows.unresolved)).toBe(true);
      expect(compactJson.hint).toContain("verbose=true");

      const verbose = await client.callTool({
        name: "files_organization_export_audit",
        arguments: { verbose: true },
      });
      const verboseJson = JSON.parse(text(verbose)) as { unresolved_rows: unknown[] };
      expect(Array.isArray(verboseJson.unresolved_rows)).toBe(true);
    } finally {
      await close();
    }
  });
});

async function seedFiles(): Promise<{ fileId: string; longPath: string }> {
  const { getCurrentMachine } = await import("../db/machines.js");
  const { createSource } = await import("../db/sources.js");
  const { upsertFile } = await import("../db/files.js");

  const machine = getCurrentMachine();
  const source = createSource({
    name: "MCP compact fixtures",
    type: "local",
    path: join(testDir!, "very/long/source/root/path/that/should/truncate/in/mcp/source/list/defaults"),
    machine_id: machine.id,
  });
  const longPath = "very/long/customer/archive/path/with/repeated/legal/finance/context/final/board-packet-copy-1.txt";
  const file = upsertFile({
    id: "f_mcpCompact1",
    source_id: source.id,
    machine_id: machine.id,
    path: longPath,
    name: "board-packet-copy-1.txt",
    ext: ".txt",
    size: 23,
    mime: "text/plain",
    hash: "duplicate-hash",
    status: "active",
  });
  upsertFile({
    id: "f_mcpCompact2",
    source_id: source.id,
    machine_id: machine.id,
    path: "another/long/customer/archive/path/with/repeated/context/final/board-packet-copy-2.txt",
    name: "board-packet-copy-2.txt",
    ext: ".txt",
    size: 23,
    mime: "text/plain",
    hash: "duplicate-hash",
    status: "active",
  });
  return { fileId: file.id, longPath };
}

async function connectedClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "compact-output-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function text(result: { content?: unknown }): string {
  return (result.content as Array<{ text: string }>)[0]!.text;
}
