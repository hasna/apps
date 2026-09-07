import { afterAll, beforeAll, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { createPgPool, createQueryClient, MigrationLedger, type PoolQueryClient } from "../../storage-kit/index.js";
import { emailsSelfHostedMigrations, DEFAULT_TENANT_ID } from "./migrations.js";
import { EmailsSelfHostedStore } from "./store.js";
import { handleSelfHostedRequest, type SelfHostedServiceDeps } from "./service.js";
import { testAuthDeps } from "./auth/test-support.js";
import { resourceSpecForPath } from "./resources.js";
import { registerInfrastructureTools } from "../../mcp/tools/infrastructure.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
function run(name: string, body: () => Promise<void>) {
  test.skipIf(!process.env.EMAILS_TEST_POSTGRES_URL)(name, body);
}
let db: PoolQueryClient;
const other = "00000000-0000-4000-8000-000000000039";
const secret = crypto.randomUUID();
let deps: SelfHostedServiceDeps;
const token = (scopes = ["emails:*"]) => mintApiKey({ app: "emails", scopes, signingSecret: secret }).token;
async function request(path: string, method = "GET", body?: unknown, credential: string | null = token()) {
  return (await handleSelfHostedRequest(deps, new Request(`https://fixture${path}`, {
    method, headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })))!;
}
beforeAll(async () => {
  const url = process.env.EMAILS_TEST_POSTGRES_URL;
  if (!url) return;
  db = createQueryClient(createPgPool({ connectionString: url, env: { PGSSLMODE: "disable" } }));
  await db.execute("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");
  await new MigrationLedger(db, emailsSelfHostedMigrations()).migrate();
  await db.execute("INSERT INTO tenants(id,name,slug,status) VALUES($1,'Other','feedback-other','active')", [other]);
  deps = { client: db, store: new EmailsSelfHostedStore(db), verifier: verifyApiKey({ app: "emails", signingSecret: secret, keyStatus: async () => "active" }), version: "fixture", migrations: [], ...testAuthDeps(db, secret), env: {} } as SelfHostedServiceDeps;
}, 60000);
afterAll(async () => { await db?.close(); });
run("feedback requires authenticated write authority and validates bounded structured input", async () => {
  expect((await request("/v1/feedback", "POST", { message: "hello" }, null)).status).toBe(401);
  expect((await request("/v1/feedback", "POST", { message: "hello" }, token(["emails:read"]))).status).toBe(403);
  for (const body of [{}, { message: "  " }, { message: "a".repeat(10001) }, { message: "x", email: "bad" }, { message: "x", category: "sent" }]) {
    expect((await request("/v1/feedback", "POST", body)).status).toBe(400);
  }
  const created = await request("/v1/feedback", "POST", { message: "  A bug report  ", email: "user@example.com", category: "bug", tenant_id: other, status: "delivered" }, token(["emails:write"]));
  expect(created.status).toBe(201);
  const row = await created.json();
  expect(row).toMatchObject({ tenant_id: DEFAULT_TENANT_ID, message: "A bug report", email: "user@example.com", category: "bug", status: "saved" });
  expect((await request(`/v1/feedback/${row.id}`, "PATCH", { message: "" })).status).toBe(400);
  const patched = await request(`/v1/feedback/${row.id}`, "PATCH", { category: "feature" });
  expect(patched.status).toBe(200);
  expect(await patched.json()).toMatchObject({ message: "A bug report", category: "feature", status: "saved" });
});
run("feedback reads and writes remain tenant scoped, including forced RLS", async () => {
  const spec = resourceSpecForPath("feedback")!;
  const foreign = await new EmailsSelfHostedStore(db).forTenant(other).createResource(spec, { message: "foreign-private" });
  expect((await request(`/v1/feedback/${foreign.id}`)).status).toBe(404);
  expect((await request(`/v1/feedback/${foreign.id}`, "PATCH", { message: "override" })).status).toBe(404);
  expect((await request(`/v1/feedback/${foreign.id}`, "DELETE")).status).toBe(404);
  expect(JSON.stringify(await (await request("/v1/feedback")).json())).not.toContain("foreign-private");
  const role = `feedback_reader_${Date.now()}`;
  await db.execute(`CREATE ROLE "${role}"; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT,INSERT,UPDATE,DELETE ON service_feedback TO "${role}"`);
  try {
    await db.transaction(async tx => {
      await tx.execute(`SET LOCAL ROLE "${role}"`);
      await tx.execute("SELECT set_config('app.current_tenant',$1,true)", [DEFAULT_TENANT_ID]);
      expect(await tx.many("SELECT id FROM service_feedback WHERE tenant_id=$1", [other])).toEqual([]);
      expect(await tx.many("UPDATE service_feedback SET message='changed' WHERE tenant_id=$1 RETURNING id", [other])).toEqual([]);
    });
    await expect(db.transaction(async tx => {
      await tx.execute(`SET LOCAL ROLE "${role}"`);
      await tx.execute("SELECT set_config('app.current_tenant',$1,true)", [DEFAULT_TENANT_ID]);
      await tx.execute("INSERT INTO service_feedback(id,tenant_id,message) VALUES($1,$2,'wrong tenant')", [crypto.randomUUID(), other]);
    })).rejects.toThrow(/row.level security/);
  } finally { await db.execute(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`); }
});
run("actual MCP saves through generated SDK and acknowledges storage rather than delivery", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async req => (await handleSelfHostedRequest(deps, req)) ?? new Response(null, { status: 404 }) });
  const saved = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) if (/^(?:HASNA_EMAILS_|EMAILS_)/.test(key)) delete process.env[key];
    process.env.HASNA_STATION = `feedback-${crypto.randomUUID()}`;
    process.env.HASNA_EMAILS_API_URL = `http://127.0.0.1:${server.port}`;
    process.env.HASNA_EMAILS_API_KEY = token();
    process.env.EMAILS_CLIENT_ENV_LOADED = "1";
    let handler: ((args: Record<string, unknown>) => Promise<any>) | undefined;
    registerInfrastructureTools({ tool(name: string, ...args: unknown[]) { if (name === "send_feedback") handler = args.at(-1) as typeof handler; } } as unknown as McpServer);
    const result = await handler!({ message: "MCP feedback fixture", category: "general" });
    expect(result.isError).not.toBe(true);
    const receipt = JSON.parse(result.content[0].text);
    expect(receipt).toMatchObject({ status: "saved", delivery: "not_sent" });
    expect(await (await request(`/v1/feedback/${receipt.id}`)).json()).toMatchObject({ message: "MCP feedback fixture", tenant_id: DEFAULT_TENANT_ID });
    const bad = await handler!({ message: "" });
    expect(bad.isError).toBe(true);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    await server.stop(true);
  }
});
