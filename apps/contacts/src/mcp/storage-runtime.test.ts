import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./index.js";

// The status tool resolves on the LIVE process.env, so the resolver's ambient
// tiers answer unless this file pins them away: on a Mac station whose
// Keychain holds hasna.credentials.contacts.api-key / .api-url, the
// "unconfigured" probe reported the real item and the explicit-URL probe was
// refused for disagreeing with the Keychain api-url — and `prepublishOnly`
// runs `bun test`, so the publish was blocked (hasna/apps#1720 validation).
// Every name the chain may consult is cleared, the Keychain account is pointed
// at an item that cannot exist (`security` exits 44 → tier absent, nothing on
// the machine is read), and the disk root at an empty temporary HASNA_HOME.
const envNames = [
  "HASNA_CONTACTS_API_URL",
  "CONTACTS_API_URL",
  "HASNA_CONTACTS_API_KEY",
  "CONTACTS_API_KEY",
  "HASNA_CONTACTS_API_KEY_OVERRIDE",
  "HASNA_CONTACTS_API_KEY_REF",
  "HASNA_PROFILE",
  "HASNA_STATION",
  "HASNA_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_CONTACTS_STORAGE_MODE",
  "CONTACTS_STORAGE_MODE",
  "HASNA_CONTACTS_DB_PATH",
  "CONTACTS_DB_PATH",
  "HASNA_CONTACTS_DATABASE_URL",
  "CONTACTS_DATABASE_URL",
] as const;

const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));
let tempHome: string | null = null;

function isolateEnv(): string {
  for (const name of envNames) delete process.env[name];
  tempHome = mkdtempSync(join(tmpdir(), "contacts-mcp-home-"));
  process.env.HASNA_HOME = tempHome;
  process.env.HASNA_STATION = "no-such-station";
  return tempHome;
}

function restoreEnv(): void {
  for (const name of envNames) {
    const value = originalEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  tempHome = null;
}

function registeredTools() {
  const server = buildServer();
  return (server as unknown as {
    _registeredTools: Record<string, { handler: (args: unknown) => Promise<any> }>;
  })._registeredTools;
}

function textPayload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]!.text);
}

afterEach(restoreEnv);

describe("contacts connection MCP runtime", () => {
  test("reports unconfigured with local fallback disabled when URL/key are absent", async () => {
    isolateEnv();
    const result = await registeredTools()["contacts_connection_status"]!.handler({});
    expect(textPayload(result)).toMatchObject({
      transport: "unconfigured",
      configured: false,
      misconfigured: true,
      api_key_present: false,
      api_key_source: null,
      local_fallback: false,
    });
  });

  test("reports HTTPS without exposing the API key", async () => {
    isolateEnv();
    process.env.HASNA_CONTACTS_API_URL = "https://contacts.example.invalid";
    process.env.HASNA_CONTACTS_API_KEY = "test-key-not-a-real-secret";
    const result = await registeredTools()["contacts_connection_status"]!.handler({});
    expect(textPayload(result)).toMatchObject({
      transport: "https",
      configured: true,
      api_key_present: true,
      api_url_source: "HASNA_CONTACTS_API_URL",
      api_key_source: "HASNA_CONTACTS_API_KEY",
      api_key_tier: "env",
    });
    expect(result.content[0]!.text).not.toContain("contacts.example.invalid");
    expect(result.content[0]!.text).not.toContain("test-key-not-a-real-secret");
  });

  test("reports the disk tier under HASNA_HOME by path, never by value", async () => {
    const home = isolateEnv();
    const dir = join(home, "contacts", "config");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "credentials"), "HASNA_CONTACTS_API_KEY=disk-key-not-a-real-secret\n");
    chmodSync(join(dir, "credentials"), 0o600);
    const result = await registeredTools()["contacts_connection_status"]!.handler({});
    expect(textPayload(result)).toMatchObject({
      transport: "https",
      configured: true,
      api_url_source: "default",
      api_key_present: true,
      api_key_tier: "disk",
    });
    expect(textPayload(result).api_key_source).toContain(join("contacts", "config", "credentials"));
    expect(result.content[0]!.text).not.toContain("disk-key-not-a-real-secret");
  });

  test("rejects retired client storage selectors", async () => {
    isolateEnv();
    process.env.CONTACTS_DATABASE_URL = "postgresql://should-not-be-in-a-client";
    const result = await registeredTools()["contacts_connection_status"]!.handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("RETIRED_CONTACTS_CLIENT_SELECTOR");
  });
});
