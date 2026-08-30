import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./index.js";
import { resetStoreCache } from "../store/index.js";

const envNames = [
  "HOME",
  "USERPROFILE",
  "CONTACTS_DB_PATH",
  "HASNA_CONTACTS_DB_PATH",
  "HASNA_CONTACTS_POSTGRES_URL",
  "OPEN_CONTACTS_POSTGRES_URL",
  "CONTACTS_POSTGRES_URL",
  "HASNA_CONTACTS_DATABASE_URL",
  "CONTACTS_DATABASE_URL",
  "HASNA_CONTACTS_API_URL",
  "HASNA_CONTACTS_API_KEY",
] as const;

const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));
let tempHome: string | null = null;

function isolateEnv(): void {
  tempHome = mkdtempSync(join(tmpdir(), "contacts-mcp-home-"));
  process.env["HOME"] = tempHome;
  delete process.env["USERPROFILE"];
  delete process.env["CONTACTS_DB_PATH"];
  delete process.env["HASNA_CONTACTS_DB_PATH"];
  delete process.env["HASNA_CONTACTS_POSTGRES_URL"];
  delete process.env["OPEN_CONTACTS_POSTGRES_URL"];
  delete process.env["CONTACTS_POSTGRES_URL"];
  delete process.env["HASNA_CONTACTS_DATABASE_URL"];
  delete process.env["CONTACTS_DATABASE_URL"];
  delete process.env["HASNA_CONTACTS_API_URL"];
  delete process.env["HASNA_CONTACTS_API_KEY"];
  resetStoreCache();
}

function restoreEnv(): void {
  for (const name of envNames) {
    const value = originalEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetStoreCache();
}

function textPayload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]!.text);
}

function textContent(result: { content: Array<{ text: string }> }) {
  return result.content[0]!.text;
}

afterEach(() => {
  restoreEnv();
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  tempHome = null;
});

describe("contacts storage MCP runtime", () => {
  test("storage status reports local transport when no client-flip env is set", async () => {
    isolateEnv();
    const server = buildServer();
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<any> }> })._registeredTools;

    const result = await tools["contacts_storage_status"]!.handler({});
    const payload = textPayload(result);

    expect(payload.transport.transport).toBe("local");
    expect(payload.transport.mode).toBe("local");
    expect(payload.local.mode).toBe("local");
  });

  test("no client-side Postgres-DSN sync tools are registered", async () => {
    isolateEnv();
    const server = buildServer();
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;

    for (const removed of [
      "contacts_storage_push",
      "contacts_storage_pull",
      "contacts_storage_sync",
      "contacts_cloud_push",
      "contacts_cloud_pull",
      "contacts_cloud_sync",
    ]) {
      expect(tools[removed]).toBeUndefined();
    }
  });

  test("cloud status reports cloud-http transport without leaking the API key", async () => {
    isolateEnv();
    process.env["HASNA_CONTACTS_API_URL"] = "https://contacts.hasna.xyz";
    process.env["HASNA_CONTACTS_API_KEY"] = "test-key-not-a-real-secret";
    try {
      const server = buildServer();
      const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<any> }> })._registeredTools;
      const result = await tools["contacts_cloud_status"]!.handler({});
      const payload = textPayload(result);
      expect(payload.transport.transport).toBe("cloud-http");
      expect(payload.transport.api_key_present).toBe(true);
      expect(textContent(result)).not.toContain("test-key-not-a-real-secret");
    } finally {
      delete process.env["HASNA_CONTACTS_API_URL"];
      delete process.env["HASNA_CONTACTS_API_KEY"];
    }
  });
});
