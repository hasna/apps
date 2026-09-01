import { afterEach, describe, expect, test } from "bun:test";
import { buildServer } from "./index.js";

const envNames = [
  "HASNA_CONTACTS_API_URL",
  "CONTACTS_API_URL",
  "HASNA_CONTACTS_API_KEY",
  "CONTACTS_API_KEY",
  "HASNA_CONTACTS_STORAGE_MODE",
  "CONTACTS_STORAGE_MODE",
  "HASNA_CONTACTS_DB_PATH",
  "CONTACTS_DB_PATH",
  "HASNA_CONTACTS_DATABASE_URL",
  "CONTACTS_DATABASE_URL",
] as const;

const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));

function isolateEnv(): void {
  for (const name of envNames) delete process.env[name];
}

function restoreEnv(): void {
  for (const name of envNames) {
    const value = originalEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
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
      local_fallback: false,
    });
  });

  test("reports HTTPS without exposing the API key", async () => {
    isolateEnv();
    process.env.HASNA_CONTACTS_API_URL = "https://contacts.example.invalid";
    process.env.HASNA_CONTACTS_API_KEY = "test-key-not-a-real-secret";
    const result = await registeredTools()["contacts_connection_status"]!.handler({});
    expect(textPayload(result)).toMatchObject({ transport: "https", configured: true, api_key_present: true });
    expect(result.content[0]!.text).not.toContain("contacts.example.invalid");
    expect(result.content[0]!.text).not.toContain("test-key-not-a-real-secret");
  });

  test("rejects retired client storage selectors", async () => {
    isolateEnv();
    process.env.CONTACTS_DATABASE_URL = "postgresql://should-not-be-in-a-client";
    const result = await registeredTools()["contacts_connection_status"]!.handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("RETIRED_CONTACTS_CLIENT_SELECTOR");
  });
});
