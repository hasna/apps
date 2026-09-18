import { afterEach, expect, test } from "bun:test";
import { RemoteSkillsClient } from "./remote-client.js";
import { saveSkillProfile } from "./profile-admin.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const originalFetch = globalThis.fetch;
const originalUrl = process.env.HASNA_SKILLS_API_URL;
const originalKey = process.env.HASNA_SKILLS_API_KEY_OVERRIDE;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.HASNA_SKILLS_API_URL; else process.env.HASNA_SKILLS_API_URL = originalUrl;
  if (originalKey === undefined) delete process.env.HASNA_SKILLS_API_KEY_OVERRIDE; else process.env.HASNA_SKILLS_API_KEY_OVERRIDE = originalKey;
});

const contract = { contractVersion: 1, apiVersion: 1, capabilities: ["skills.registry", "skills.profiles"] };
function fixture(access: Record<string, unknown>, status = 200) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin).toBe("https://permissions.example.test");
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname.endsWith("/capabilities")) return Response.json({ ...contract, ...access }, { status });
    return Response.json({ id: "fleet", revision: "one", selections: [], version: "1.0.0" }, { status: 201 });
  }) as typeof fetch;
  process.env.HASNA_SKILLS_API_URL = "https://permissions.example.test";
  process.env.HASNA_SKILLS_API_KEY_OVERRIDE = "permission-fixture-only";
  return { calls, client: new RemoteSkillsClient("permission-fixture-only", "https://permissions.example.test") };
}

test("capabilities retain typed effective permissions and scopes without unrelated provider fields", async () => {
  const { client } = fixture({ scopes: ["skills:read"], permissions: { publish: false, profilesWrite: false, read: true, apiKey: "unrelated-fixture" }, apiKey: "unrelated-fixture" });
  const result = await client.getCapabilities();
  expect(result).toMatchObject({ scopes: ["skills:read"], permissions: { publish: false, profilesWrite: false, read: true } });
  expect(JSON.stringify(result)).not.toContain("unrelated-fixture");
});

test("an owner credential explicitly denied publication sends no multipart request", async () => {
  const { client, calls } = fixture({ role: "owner", scopes: ["skills:read"], permissions: { publish: false } });
  await expect(client.publishSkill({ slug: "owned-draft" }, new Uint8Array([1, 2]))).rejects.toMatchObject({ code: "SKILLS_PERMISSION_DENIED", permission: "publish" });
  expect(calls).toEqual(["GET /api/v1/capabilities"]);
});

test("explicit profile-write denial prevents PUT even for an empty profile", async () => {
  const { calls } = fixture({ role: "owner", permissions: { profilesWrite: false } });
  await expect(saveSkillProfile("fleet", [])).rejects.toMatchObject({ code: "SKILLS_PERMISSION_DENIED", permission: "profilesWrite" });
  expect(calls).toEqual(["GET /api/v1/capabilities"]);
});

for (const [label, access] of [
  ["permitted writer", { role: "member", scopes: ["skills:publish"], permissions: { publish: true, profilesWrite: true } }],
  ["older server omitting permissions", {}],
] as const) test(`${label} retains publication and profile mutation behavior`, async () => {
  const { client, calls } = fixture(access);
  expect((await client.publishSkill({ slug: "owned-draft" }, new Uint8Array([1]))).status).toBe(201);
  expect((await saveSkillProfile("fleet", [])).id).toBe("fleet");
  expect(calls.filter(call => call.startsWith("POST ") || call.startsWith("PUT "))).toEqual(["POST /api/v1/skills", "PUT /api/v1/profiles/fleet"]);
});

test("malformed permissions cannot be mistaken for an older omitted contract", async () => {
  const { client, calls } = fixture({ permissions: { publish: "false" }, error: "unrelated-fixture" });
  await expect(client.publishSkill({ slug: "owned-draft" })).rejects.toThrow("Invalid Skills permission contract");
  expect(calls).toEqual(["GET /api/v1/capabilities"]);
});

test("publication rechecks effective access after an earlier capability read", async () => {
  const access = { permissions: { publish: true } };
  const { client, calls } = fixture(access);
  expect((await client.getCapabilities()).permissions?.publish).toBe(true);
  access.permissions.publish = false;
  await expect(client.publishSkill({ slug: "owned-draft" })).rejects.toMatchObject({ code: "SKILLS_PERMISSION_DENIED" });
  expect(calls).toEqual(["GET /api/v1/capabilities", "GET /api/v1/capabilities"]);
});

for (const status of [404, 405]) test(`older capability route HTTP ${status} preserves server-side authorization`, async () => {
  const { client, calls } = fixture({}, status);
  expect((await client.publishSkill({ slug: "owned-draft" })).status).toBe(201);
  expect((await saveSkillProfile("fleet", [])).id).toBe("fleet");
  expect(calls.filter(call => !call.startsWith("GET "))).toEqual(["POST /api/v1/skills", "PUT /api/v1/profiles/fleet"]);
});

for (const status of [401, 403, 500]) test(`capability HTTP ${status} is not treated as legacy omission`, async () => {
  const { client, calls } = fixture({ error: "unrelated-fixture" }, status);
  await expect(client.publishSkill({ slug: "owned-draft" })).rejects.toThrow(`HTTP ${status}`);
  await expect(saveSkillProfile("fleet", [])).rejects.toThrow(`HTTP ${status}`);
  expect(calls.every(call => call.startsWith("GET "))).toBe(true);
});

for (const body of ['{"scopes": provider-fixture-marker}', 'null', '[]']) test(`malformed capability document ${body[0]} fails without reflecting provider data`, async () => {
  const { client, calls } = fixture({});
  const fixtureFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fixtureFetch(input, init);
    if (String(input).endsWith('/capabilities')) return new Response(body);
    return response;
  }) as typeof fetch;
  await expect(client.publishSkill({ slug: "owned-draft" })).rejects.toThrow("Invalid Skills capability response");
  await expect(saveSkillProfile("fleet", [])).rejects.toThrow("Invalid Skills capability response");
  expect(calls.every(call => call.startsWith("GET "))).toBe(true);
});

test("profile permission preflight and write use the same captured credential", async () => {
  const { calls } = fixture({ permissions: { profilesWrite: true } });
  const fixtureFetch = globalThis.fetch;
  const credentials: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    credentials.push(new Headers(init?.headers).get("Authorization") ?? "");
    const response = await fixtureFetch(input, init);
    process.env.HASNA_SKILLS_API_KEY_OVERRIDE = "changed-fixture-only";
    return response;
  }) as typeof fetch;
  await saveSkillProfile("fleet", []);
  expect(calls).toEqual(["GET /api/v1/capabilities", "PUT /api/v1/profiles/fleet"]);
  expect(credentials).toEqual(["Bearer permission-fixture-only", "Bearer permission-fixture-only"]);
});
