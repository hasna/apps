import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { installMcpToolContracts } from "../mcp/contracts.js";
import { registerInfrastructureTools } from "../mcp/tools/infrastructure.js";
let saved: NodeJS.ProcessEnv, home: string, server: ReturnType<typeof Bun.serve>;
let status = 200, ok = true;
let requests: Record<string, unknown>[] = [];
beforeEach(() => {
  saved = { ...process.env }; home = mkdtempSync(join(tmpdir(), "emails-ses-setup-")); chmodSync(home, 0o700);
  for (const key of Object.keys(process.env)) if (/^(?:HASNA_EMAILS_|EMAILS_)/.test(key)) delete process.env[key];
  delete process.env.HASNA_CONFIG_HOME; delete process.env.HASNA_HOME;
  process.env.HOME = home; process.env.HASNA_STATION = `ses-setup-${crypto.randomUUID()}`; process.env.EMAILS_CLIENT_ENV_LOADED = "1";
  const credential = crypto.randomUUID(); requests = []; status = 200; ok = true;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    expect(req.headers.get("authorization")).toBe(`Bearer ${credential}`);
    expect(new URL(req.url).pathname).toBe("/v1/inbox/setup-ses-inbound"); expect(req.method).toBe("POST");
    requests.push(await req.json() as Record<string, unknown>);
    return status !== 200 ? Response.json({ error: "fixture missing" }, { status }) : Response.json({ ok, verified: ok, domain: "example.test", source_id: "source", bucket: "bound-bucket", prefix: "inbound/example.test/", region: "us-east-1", changed: ok ? [] : ["bucket_created"], attempted: ok ? [] : ["bucket_created", "bucket_policy_updated"], changes_may_have_applied: !ok, worker_started: false, delivery_tested: false });
  } });
  process.env.HASNA_EMAILS_API_URL = `http://127.0.0.1:${server.port}`; process.env.HASNA_EMAILS_API_KEY = credential;
});
afterEach(async () => {
  await server.stop(true);
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved); rmSync(home, { recursive: true, force: true });
});
async function call() {
  const server = new McpServer({ name: "fixture", version: "1" }); installMcpToolContracts(server); registerInfrastructureTools(server);
  return (server as any)._registeredTools.setup_ses_inbound.handler({ domain: "example.test", bucket: "bound-bucket", region: "us-east-1", prefix: "inbound/example.test/", catch_all: false });
}
test("MCP SES setup preserves all supplied selectors in the authenticated API request", async () => {
  const result = await call(); expect(result.isError).not.toBe(true);
  expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: true, verified: true, worker_started: false });
  expect(requests).toEqual([{ domain: "example.test", bucket: "bound-bucket", region: "us-east-1", prefix: "inbound/example.test/", catch_all: false }]);
});
test("MCP partial and older API responses never claim successful setup", async () => {
  ok = false; const partial = await call(); expect(partial.isError).toBe(true);
  expect(JSON.parse(partial.content[0].text)).toMatchObject({ ok:false,verified:false,changed:["bucket_created"],attempted:["bucket_created","bucket_policy_updated"],changes_may_have_applied:true,error:{code:"provisioning_incomplete",retryable:false} });
  status = 404; const result = await call(); expect(result.isError).toBe(true); expect(result.content[0].text).toContain("API needs an update");
});
