import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  testDir = mkdtempSync(join(tmpdir(), "files-mcp-knowledge-"));
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

describe("knowledge MCP tools", () => {
  test("exports manifests, resolves refs, and polls outbox events", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");

    const sourceRoot = join(testDir!, "source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "notes.md"), "# Notes\nhello mcp\n");
    const machine = getCurrentMachine();
    const source = createSource({
      name: "MCP docs",
      type: "local",
      path: sourceRoot,
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_mcpKnowledge",
      source_id: source.id,
      machine_id: machine.id,
      path: "notes.md",
      name: "notes.md",
      ext: ".md",
      size: Buffer.byteLength("# Notes\nhello mcp\n"),
      mime: "text/markdown",
      hash: "a".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });

    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "knowledge-test", version: "0.0.0" });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "export_knowledge_manifest")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "doctor_knowledge_sources")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "resolve_knowledge_source")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "poll_knowledge_outbox")).toBe(true);

    const manifestResult = await client.callTool({
      name: "export_knowledge_manifest",
      arguments: { source_id: source.id, limit: 10 },
    });
    const manifest = JSON.parse((manifestResult.content as Array<{ text: string }>)[0]!.text) as {
      items: Array<{ file_id: string }>;
    };
    expect(manifest.items[0]?.file_id).toBe(file.id);

    const resolveResult = await client.callTool({
      name: "resolve_knowledge_source",
      arguments: { source_ref: `open-files://file/${file.id}`, mode: "metadata" },
    });
    const resolved = JSON.parse((resolveResult.content as Array<{ text: string }>)[0]!.text) as {
      file_id: string;
      permissions: { mode: string; write: boolean };
    };
    expect(resolved.file_id).toBe(file.id);
    expect(resolved.permissions.write).toBe(false);

    const doctorResult = await client.callTool({
      name: "doctor_knowledge_sources",
      arguments: { source_refs: [`open-files://file/${file.id}`] },
    });
    const doctor = JSON.parse((doctorResult.content as Array<{ text: string }>)[0]!.text) as {
      checks: Array<{ status: string; recommendation: string }>;
    };
    expect(doctor.checks[0]).toMatchObject({ status: "ready", recommendation: "none" });

    const outboxResult = await client.callTool({
      name: "poll_knowledge_outbox",
      arguments: { limit: 10 },
    });
    const outbox = JSON.parse((outboxResult.content as Array<{ text: string }>)[0]!.text) as {
      events: Array<{ event_type: string; file_id?: string }>;
    };
    expect(outbox.events.some((event) => event.event_type === "indexed" && event.file_id === file.id)).toBe(true);

    await client.close();
    await server.close();
  });
});
