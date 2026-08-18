import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./index.js";
import { resetStoreCache } from "../store/index.js";

/**
 * Behavior lock for the recorded strong reason on the organization capability
 * (local-only-capability-removal workflow, 2026-08-18):
 *
 * Organization reviews operate on `google_drive_imported_objects` metadata
 * produced ONLY by the on-box Google Drive sync. The hosted server has no
 * schema, no routes, and no producer for this data plane, so in api mode the
 * tools MUST refuse with the documented reason instead of silently reading or
 * writing the local SQLite island (the split-brain this guard exists to
 * close). These tests make the refusal checkable as behavior, not prose.
 */

const ENV_KEYS = [
  "HASNA_FILES_DATA_DIR",
  "HASNA_FILES_DB_PATH",
  "HASNA_FILES_API_URL",
  "HASNA_FILES_API_KEY",
  "HASNA_FILES_STORAGE_MODE",
] as const;

const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-organization-mcp-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
  delete process.env.HASNA_FILES_API_URL;
  delete process.env.HASNA_FILES_API_KEY;
  delete process.env.HASNA_FILES_STORAGE_MODE;
  resetStoreCache();
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
  resetStoreCache();
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

describe("organization MCP tools on the hosted (api) transport — recorded strong reason", () => {
  const ORGANIZATION_TOOLS = [
    "files_organization_bootstrap_google_drive",
    "files_organization_stats",
    "files_organization_reviews",
    "files_organization_update_review",
    "files_organization_export_audit",
    "files_organization_events",
  ] as const;

  beforeEach(() => {
    // Full api pair: url + key resolve the ApiStore transport (see
    // src/store/store.test.ts "returns an ApiStore when API url + key are present").
    process.env.HASNA_FILES_API_URL = "https://files.example.test/v1";
    process.env.HASNA_FILES_API_KEY = "k_test";
    resetStoreCache();
  });

  for (const tool of ORGANIZATION_TOOLS) {
    test(`${tool} refuses in api mode with the recorded reason, never touching the local island`, async () => {
      const { client, close } = await connectedClient();
      try {
        // Tools with a required id_or_file_id arg get one so the SDK input
        // validation passes and the local-transport guard is what refuses.
        const arguments_ =
          tool === "files_organization_update_review" || tool === "files_organization_events"
            ? { id_or_file_id: "f_test" }
            : {};
        const result = await client.callTool({ name: tool, arguments: arguments_ });
        expect(result.isError).toBe(true);
        const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
        expect(text).toContain("runs on-box only");
        expect(text).toContain("cloud (api) mode");
        expect(text).toContain("locally-imported Google Drive metadata");
      } finally {
        await close();
      }
    });
  }
});
