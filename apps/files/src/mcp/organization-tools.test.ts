import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./index.js";

/**
 * Behavior lock for the organization capability (allcmds campaign, owner
 * directive 2026-08-15 — the storage-mode axis is retired):
 *
 * Organization reviews operate on `google_drive_imported_objects` metadata
 * produced by the on-box Google Drive sync. They are an explicitly invoked
 * machine operation: the tools run in BOTH environments against the machine's
 * on-box store, announcing it with the LOCAL-mode line under a hosted
 * credential. There are no transport refusals and no transport-conditional
 * tool blocks. These tests make that checkable as behavior, not prose.
 */

const ENV_KEYS = [
  "HASNA_FILES_DATA_DIR",
  "HASNA_FILES_DB_PATH",
  "HASNA_FILES_API_URL",
  "HASNA_FILES_API_KEY",
  "HASNA_HOME",
] as const;

const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-organization-mcp-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
  // Isolate the credential disk tier from the station's real credentials file.
  process.env.HASNA_HOME = testDir;
  delete process.env.HASNA_FILES_API_URL;
  delete process.env.HASNA_FILES_API_KEY;
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

async function connectedClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "organization-tools-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("organization MCP tools on the local transport (positive control)", () => {
  test("files_organization_stats answers against the on-box store", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({ name: "files_organization_stats", arguments: {} });
      expect(result.isError).not.toBe(true);
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
      const stats = JSON.parse(text) as { total: number };
      expect(typeof stats.total).toBe("number");
    } finally {
      await close();
    }
  });
});

describe("organization MCP tools on the hosted (api) transport — no refusal", () => {
  const ORGANIZATION_TOOLS = [
    "files_organization_bootstrap_google_drive",
    "files_organization_stats",
    "files_organization_reviews",
    "files_organization_update_review",
    "files_organization_export_audit",
    "files_organization_events",
  ] as const;

  beforeEach(() => {
    // Full api pair: url + key resolve the ApiStore transport; the machine
    // operation still answers from the on-box store.
    process.env.HASNA_FILES_API_URL = "https://files.example.test/v1";
    process.env.HASNA_FILES_API_KEY = "k_test";
  });

  for (const tool of ORGANIZATION_TOOLS) {
    test(`${tool} executes in api mode without transport-refusal vocabulary`, async () => {
      const { client, close } = await connectedClient();
      try {
        // Tools with a required id_or_file_id arg get one so the SDK input
        // validation passes.
        const arguments_ =
          tool === "files_organization_update_review" || tool === "files_organization_events"
            ? { id_or_file_id: "f_test" }
            : {};
        const result = await client.callTool({ name: tool, arguments: arguments_ });
        const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
        expect(text).not.toContain("runs on-box only");
        expect(text).not.toContain("cloud (api) mode");
        expect(text).not.toContain("local mode only");
        // Empty-store operations succeed; row lookups for missing files are
        // operational errors, never transport refusals.
        if (arguments_.id_or_file_id === undefined) {
          expect(result.isError).not.toBe(true);
        }
      } finally {
        await close();
      }
    });
  }
});
