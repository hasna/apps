import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./index.js";

const ENV_KEYS = [
  "HASNA_FILES_DATA_DIR",
  "HASNA_FILES_DB_PATH",
  "OPEN_FILES_MCP_ALLOW_MUTATIONS",
  "OPEN_FILES_MCP_ALLOW_ALL",
  "OPEN_FILES_ALLOW_ALL",
] as const;

const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-mcp-hardening-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
  delete process.env.OPEN_FILES_MCP_ALLOW_MUTATIONS;
  delete process.env.OPEN_FILES_MCP_ALLOW_ALL;
  delete process.env.OPEN_FILES_ALLOW_ALL;
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

describe("MCP hardening", () => {
  test("mutation tools fail closed by default", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "add_source",
        arguments: { type: "local", path: testDir, name: "blocked" },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain("requires explicit capability");
    } finally {
      await close();
    }
  });

  test("mutation tools run when the matching capability is explicit", async () => {
    process.env.OPEN_FILES_MCP_ALLOW_MUTATIONS = "1";
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "add_source",
        arguments: { type: "local", path: testDir, name: "allowed" },
      });
      expect(result.isError).not.toBe(true);
      const source = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as { name: string; type: string };
      expect(source).toMatchObject({ name: "allowed", type: "local" });
    } finally {
      await close();
    }
  });

  test("add_source rejects static S3 credential fields even when mutations are allowed", async () => {
    process.env.OPEN_FILES_MCP_ALLOW_MUTATIONS = "1";
    const { client, close } = await connectedClient();
    try {
      let result: Awaited<ReturnType<typeof client.callTool>> | undefined;
      let thrown: unknown;
      const credentialConfig = Object.fromEntries([
        ["access" + "KeyId", "static-value"],
        ["secret" + "AccessKey", "static-value"],
      ]);
      try {
        result = await client.callTool({
          name: "add_source",
          arguments: {
            type: "s3",
            bucket: "hasna-xyz-opensource-files-test",
            config: credentialConfig,
          },
        });
      } catch (error) {
        thrown = error;
      }

      const text = thrown
        ? String(thrown)
        : JSON.stringify(result?.content ?? result);
      expect(result?.isError ?? Boolean(thrown)).toBe(true);
      expect(text).toMatch(/accessKeyId|Unrecognized key|Invalid arguments/);
    } finally {
      await close();
    }
  });
});

async function connectedClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "hardening-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
