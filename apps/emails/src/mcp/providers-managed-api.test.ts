import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { handleSelfHostedRequest, type SelfHostedServiceDeps } from "../server/self-hosted/service.js";
import { selfScopedStore, testAuthDeps } from "../server/self-hosted/auth/test-support.js";
import { DEFAULT_TENANT_ID } from "../server/self-hosted/migrations.js";
import { ManagedProviderSecretError, type ManagedProviderSecrets } from "../server/self-hosted/managed-provider-secrets.js";
import type { TypedQueryClient } from "../storage-kit/index.js";

test("installed MCP provider tools use saved API credentials and atomic server-managed writes", async () => {
  const home = mkdtempSync(join(tmpdir(), "emails-mcp-managed-"));
  const rows = new Map<string, any>(), envelopes = new Map<string, any>();
  const writes: any[] = [], genericWrites: any[] = [], tenants: string[] = [];
  const root = crypto.randomUUID();
  let fail = false, backendAvailable = true;
  const client = { query: async () => ({ rows: [], rowCount: 0 }), many: async () => [], get: async () => null, one: async () => ({}), execute: async () => {} } as TypedQueryClient;
  const store = selfScopedStore(client) as any;
  store.listResource = async (_spec: unknown, options: any) => [...rows.values()].slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 100));
  store.getResource = async (_spec: unknown, id: string) => rows.get(id) ?? null;
  store.createResource = async (_spec: unknown, input: any) => { genericWrites.push(input); const row = { id: crypto.randomUUID(), tenant_id: DEFAULT_TENANT_ID, region: null, ...input, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; rows.set(row.id, row); return row; };
  store.updateResource = async (_spec: unknown, id: string, input: any) => { genericWrites.push(input); const row = { ...rows.get(id), ...input }; rows.set(id, row); return row; };
  store.deleteResource = async () => { throw Error("Client must never roll back a provider with DELETE"); };
  const backend = {
    configured: true,
    metadata: async () => ({ roots: [{ id: root, state: "active" }], envelopes: [...envelopes.values()] }),
    install: async (id: string, credentials: any, revision: number | null, actor: string, options: any) => {
      writes.push({ id, credentials, revision, actor, options });
      if (fail) throw new ManagedProviderSecretError("Synthetic server validation failed; nothing saved", 422);
      if (options.create && rows.has(id)) throw new ManagedProviderSecretError("Provider already exists", 409);
      if (!options.create && revision !== (envelopes.get(id)?.revision ?? null)) throw new ManagedProviderSecretError("Revision changed", 409);
      const row = { region: null, ...rows.get(id), id, tenant_id: DEFAULT_TENANT_ID, ...options.metadata, active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      if (options.validate) await options.validate({ type: row.type, ...credentials }, row.region, AbortSignal.timeout(1000));
      rows.set(id, row); envelopes.set(id, { provider_id: id, revision: (revision ?? 0) + 1, root_id: root });
      return { provider_id: id, revision: (revision ?? 0) + 1, root_id: root };
    },
  } as unknown as ManagedProviderSecrets;
  const signingSecret = crypto.randomUUID();
  const key = mintApiKey({ app: "emails", scopes: ["emails:*"], signingSecret }).token;
  const deps = { client, store, verifier: verifyApiKey({ app: "emails", signingSecret, keyStatus: async () => "active" }), version: "fixture", migrations: [], ...testAuthDeps(client, signingSecret), env: {}, validateManagedCredentials: async () => {}, managedProviderSecrets: (tenant: string) => { tenants.push(tenant); return backend; } } as SelfHostedServiceDeps;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
    if (!backendAvailable && new URL(request.url).pathname === "/v1/providers/secrets/status") return Response.json({ error: "not found" }, { status: 404 });
    return await handleSelfHostedRequest(deps, request) ?? new Response(null, { status: 404 });
  } });
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(EMAILS_|HASNA_EMAILS_)/.test(name)) delete env[name];
  for (const name of ["HASNA_CONFIG_HOME", "HASNA_HOME", "HASNA_DATA_HOME", "HASNA_STATE_HOME", "HASNA_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) delete env[name];
  Object.assign(env, { HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_STATION: `mcp-managed-${crypto.randomUUID()}`, EMAILS_HOME: join(home, "mail"), EMAILS_CLIENT_ENV_LOADED: "1", NO_COLOR: "1" });
  const config = join(home, ".hasna", "emails", "config"); mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "credentials"), `HASNA_EMAILS_API_URL=${server.url.origin}\nHASNA_EMAILS_API_KEY=${key}\n`, { mode: 0o600 });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--no-env-file", "src/mcp/index.ts", "--stdio"], env: env as Record<string, string>, stderr: "pipe" });
  const mcp = new Client({ name: "synthetic-provider-test", version: "1" });
  let stderr = ""; transport.stderr?.on("data", chunk => { stderr += String(chunk); });
  const secret = "synthetic-provider-credential-only";
  async function call(name: string, args: Record<string, unknown>) {
    const result = await mcp.callTool({ name, arguments: args });
    const raw = JSON.stringify(result);
    expect(raw).not.toContain(secret); expect(raw).not.toContain(key);
    const text = (result.content as any[])[0].text;
    return { ...result, raw, payload: JSON.parse(text) };
  }
  try {
    await mcp.connect(transport);
    const schema = await mcp.listTools();
    expect(schema.tools.find(tool => tool.name === "add_provider")?.inputSchema.properties).toHaveProperty("id");
    expect(schema.tools.find(tool => tool.name === "update_provider")?.inputSchema.properties).toHaveProperty("skip_validation");
    const registered = await call("add_provider", { name: "Registry fixture", type: "resend" });
    expect(registered.isError, registered.raw).not.toBe(true); expect(registered.payload.checked).toBe(false);
    expect(writes).toHaveLength(0); expect(genericWrites).toHaveLength(1);
    const id = crypto.randomUUID();
    const created = await call("add_provider", { id, name: "Managed fixture", type: "ses", region: "eu-west-1", access_key: "synthetic-access", secret_key: secret });
    expect(created.isError).not.toBe(true); expect(created.payload).toMatchObject({ provider_id: id, revision: 1, checked: true });
    expect(writes[0]).toMatchObject({ id, revision: null, credentials: { access_key: "synthetic-access", secret_key: secret }, options: { create: true } });
    expect(typeof writes[0].options.validate).toBe("function");
    expect(created.payload.cli_equivalent).toContain(`--id ${id}`);
    expect(created.payload.cli_equivalent).toContain("--region eu-west-1");
    expect(created.payload.cli_equivalent).toContain("requires secure provider credential input");
    const updated = await call("update_provider", { id, secret_key: secret, skip_validation: true });
    expect(updated.payload).toMatchObject({ revision: 2, checked: false });
    expect(writes[1]).toMatchObject({ revision: 1, credentials: { secret_key: secret } });
    expect(writes[1].options).not.toHaveProperty("validate");
    expect(updated.payload.cli_equivalent).toContain("--skip-validation");
    const region = await call("update_provider", { id, region: "eu-central-1" });
    expect(region.payload).toMatchObject({ revision: 3, checked: true });
    expect(writes[2]).toMatchObject({ revision: 2, credentials: {}, options: { metadata: { region: "eu-central-1" } } });
    expect(genericWrites).toHaveLength(1);
    const renamed = await call("update_provider", { id, name: "Managed renamed" });
    expect(renamed.isError).not.toBe(true); expect(renamed.payload.checked).toBe(false);
    expect(renamed.payload.cli_equivalent).toContain('--name "Managed renamed"');
    expect(writes).toHaveLength(3); expect(genericWrites).toHaveLength(2);
    fail = true;
    const failedId = crypto.randomUUID();
    const failed = await call("add_provider", { id: failedId, name: "Rejected fixture", type: "resend", api_key: secret });
    expect(failed.isError).toBe(true); expect(failed.raw).toContain(failedId); expect(failed.raw).toContain("reuse the same id");
    expect(rows.has(failedId)).toBe(false); expect(rows.size).toBe(2);
    const failedUpdate = await call("update_provider", { id, region: "us-west-2", secret_key: secret });
    expect(failedUpdate.isError).toBe(true); expect(rows.get(id).region).toBe("eu-central-1");
    expect(envelopes.get(id).revision).toBe(3);
    fail = false;
    expect((await call("add_provider", { id: failedId, name: "Retry fixture", type: "resend", api_key: secret })).isError).not.toBe(true);
    expect((await call("add_provider", { id: failedId, name: "Retry fixture", type: "resend", api_key: secret })).isError).toBe(true);
    expect(rows.size).toBe(3);
    backendAvailable = false;
    const before = writes.length;
    const unavailable = await call("add_provider", { id: crypto.randomUUID(), name: "Unavailable", type: "resend", api_key: secret });
    expect(unavailable.isError).toBe(true); expect(unavailable.raw).toContain("needs an update"); expect(writes.length).toBe(before);
    expect(tenants.length).toBeGreaterThan(0); expect(tenants.every(tenant => tenant === DEFAULT_TENANT_ID)).toBe(true);
    expect(genericWrites.every(input => !("api_key" in input) && !("secret_key" in input) && !("access_key" in input))).toBe(true);
    expect(existsSync(join(home, "mail", "emails.db"))).toBe(false);
    expect(stderr).not.toContain(secret); expect(stderr).not.toContain(key);
  } finally { await mcp.close(); server.stop(true); rmSync(home, { recursive: true, force: true }); }
}, 30000);
