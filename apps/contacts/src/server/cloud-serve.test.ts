import { afterEach, describe, expect, test } from "bun:test";
import { createCloudRequestHandler } from "./cloud-serve.js";

const managedEnv = [
  "HASNA_CONTACTS_DATABASE_URL",
  "CONTACTS_DATABASE_URL",
  "DATABASE_URL",
  "HASNA_CONTACTS_API_SIGNING_KEY",
  "HASNA_API_SIGNING_KEY",
  "API_KEY_SIGNING_SECRET",
  "HASNA_CONTACTS_STORAGE_MODE",
  "CONTACTS_STORAGE_MODE",
] as const;
const originalEnv = Object.fromEntries(managedEnv.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of managedEnv) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://contacts.example${path}`, init);
}

describe("production cloud request handler", () => {
  test("reports cloud liveness without requiring local or remote storage", async () => {
    for (const name of managedEnv) delete process.env[name];

    const response = await createCloudRequestHandler()(request("/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", name: "contacts", mode: "cloud" });
  });

  test("fails readiness closed when remote configuration is absent", async () => {
    for (const name of managedEnv) delete process.env[name];

    const response = await createCloudRequestHandler()(request("/ready"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "not_ready", mode: "cloud" });
  });

  test("does not expose the MCP or legacy local server surfaces", async () => {
    process.env.HASNA_CONTACTS_STORAGE_MODE = "cloud";
    const handler = createCloudRequestHandler();

    expect((await handler(request("/mcp", { method: "POST" }))).status).toBe(404);
    expect((await handler(request("/api/contacts"))).status).toBe(404);
  });
});
