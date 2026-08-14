import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  testDir = mkdtempSync(join(tmpdir(), "files-mcp-context-pack-"));
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

describe("context-pack MCP tools", () => {
  test("builds context and search packs with bounded citations", async () => {
    const fileId = await seedMcpFile();
    const { client, close } = await connectedClient();
    try {
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === "build_context_pack")).toBe(true);
      expect(tools.tools.some((tool) => tool.name === "search_context_pack")).toBe(true);

      const context = await client.callTool({
        name: "build_context_pack",
        arguments: { file_ids: [fileId], max_excerpts: 1, max_excerpt_chars: 80 },
      });
      const contextJson = JSON.parse(text(context)) as {
        files: Array<{ excerpts: Array<{ text: string }> }>;
        citations: Array<{ attachment_ref: string }>;
      };
      expect(contextJson.files[0]?.excerpts).toHaveLength(1);
      expect(contextJson.citations[0]?.attachment_ref).toBe(`open-files://file/${fileId}`);

      const search = await client.callTool({
        name: "search_context_pack",
        arguments: { query: "agent-loop", max_files: 1 },
      });
      const searchJson = JSON.parse(text(search)) as { mode: string; files: unknown[] };
      expect(searchJson.mode).toBe("search");
      expect(searchJson.files).toHaveLength(1);

      const outPath = join(testDir!, "mcp-pack.json");
      const pointer = await client.callTool({
        name: "search_context_pack",
        arguments: { query: "agent-loop", max_files: 1, output_local_path: outPath, dry_run: true },
      });
      const pointerJson = JSON.parse(text(pointer)) as {
        pack_id: string;
        dry_run: boolean;
        artifact: { path: string };
        files?: unknown[];
      };
      expect(pointerJson.pack_id).toMatch(/^ctxpack_/);
      expect(pointerJson.dry_run).toBe(true);
      expect(pointerJson.artifact.path).toBe(outPath);
      expect(pointerJson.files).toBeUndefined();
      expect(existsSync(outPath)).toBe(false);
    } finally {
      await close();
    }
  });
});

async function seedMcpFile(): Promise<string> {
  const { getCurrentMachine } = await import("../db/machines.js");
  const { createSource } = await import("../db/sources.js");
  const { upsertFile } = await import("../db/files.js");

  const root = join(testDir!, "source");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "agent-loop-notes.txt"), "agent-loop receipt context\nsecond line\n");
  const machine = getCurrentMachine();
  const source = createSource({
    name: "MCP context source",
    type: "local",
    path: root,
    machine_id: machine.id,
  });
  const file = upsertFile({
    id: "f_mcp_context_pack",
    source_id: source.id,
    machine_id: machine.id,
    path: "agent-loop-notes.txt",
    name: "agent-loop-notes.txt",
    ext: ".txt",
    size: 39,
    mime: "text/plain",
    hash: "c".repeat(64),
    status: "active",
  });
  return file.id;
}

async function connectedClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "context-pack-test", version: "0.0.0" });
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
