import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./index.js";

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
}

function restoreEnv(): void {
  for (const name of envNames) {
    const value = originalEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
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
  test("storage status reports local-first remote configuration state", async () => {
    isolateEnv();
    const server = buildServer();
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<any> }> })._registeredTools;

    const result = await tools["contacts_storage_status"]!.handler({});
    const payload = textPayload(result);

    expect(payload.mode).toBe("local-first");
    expect(payload.local.mode).toBe("local");
    expect(payload.remote.configured).toBe(false);
    expect(payload.remote.env).toContain("HASNA_CONTACTS_POSTGRES_URL");
  });

  test("storage push and cloud alias fail closed when remote URL is missing", async () => {
    isolateEnv();
    const server = buildServer();
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<any> }> })._registeredTools;

    const storageResult = await tools["contacts_storage_push"]!.handler({ tables: "contacts" });
    const cloudResult = await tools["contacts_cloud_push"]!.handler({ tables: "contacts" });

    expect(storageResult.isError).toBe(true);
    expect(cloudResult.isError).toBe(true);
    expect(textContent(storageResult)).toContain("Missing contacts remote database URL");
    expect(textContent(cloudResult)).toContain("Missing contacts remote database URL");
  });
});
