import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createPreviewGateway, renewGatewayRoutes } from "./gateway.js";
import { runMigrations } from "../db/schema.js";
import { createServer } from "../db/servers.js";
import { startLocalServer, stopLocalServer } from "../runtime/local-server.js";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { instanceId } from "./config.js";
import { downPreviews, previewOAuth, upPreviews } from "./service.js";
import { savePreviewState, settingsSchema, type LocalPreviewRoute } from "./state.js";
const nativeFetch = globalThis.fetch;
const envKeys = ["SERVERS_PREVIEW_STATE_DIR", "SERVERS_PREVIEW_CONTROL_TOKEN", "SERVERS_PREVIEW_GATEWAY_TOKEN", "CLOUDFLARE_API_TOKEN", "SERVERS_PREVIEW_ROUTER_TOKEN", "SERVERS_DB_PATH"];
let before: Record<string, string | undefined>, root: string;
const settings = settingsSchema.parse({ version: 1, accountId: "a".repeat(32), subdomain: "test-account", accessTeamDomain: "https://test-team.cloudflareaccess.com", accessEmails: ["developer@example.com"] });
beforeEach(() => { before = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])); root = mkdtempSync(join(tmpdir(), "preview-service-")); process.env.SERVERS_PREVIEW_STATE_DIR = root; process.env.SERVERS_PREVIEW_CONTROL_TOKEN = "c".repeat(40); process.env.SERVERS_PREVIEW_GATEWAY_TOKEN = "g".repeat(40); savePreviewState("settings", settings); });
afterEach(() => { globalThis.fetch = nativeFetch; for (const key of envKeys) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; rmSync(root, { recursive: true, force: true }); });
describe("preview SDK workflows", () => {
  it("refuses to duplicate an existing instance when called from another database scope", async () => {
    const gateway = createPreviewGateway({ port: 0, gatewayToken: process.env.SERVERS_PREVIEW_GATEWAY_TOKEN!, controlToken: process.env.SERVERS_PREVIEW_CONTROL_TOKEN! });
    const station = { id: "laptop", name: "laptop", tunnelId: crypto.randomUUID(), serviceId: crypto.randomUUID(), binding: "STATION_LAPTOP", gatewayPort: gateway.server.port! };
    savePreviewState("station", station);
    process.env.CLOUDFLARE_API_TOKEN = crypto.randomUUID(); process.env.SERVERS_PREVIEW_ROUTER_TOKEN = crypto.randomUUID();
    process.env.SERVERS_DB_PATH = join(root, "new-scope.db"); resetDatabase();
    writeFileSync(join(root, "servers.config.json"), JSON.stringify({ version: 1, product: "studio", apps: [{ name: "web", command: "false", port: 3000 }] }));
    const key = "studio/web/dev/main";
    gateway.routes.set(key, { key, instanceId: instanceId(key, root, station.id), databasePath: join(root, "original.db"), serverId: "original", pid: process.pid, port: 3000, hostname: "studio-web.test-account.workers.dev", fence: 1, expiresAt: Date.now() + 60_000, readinessPath: "/" });
    const actions: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith("https://servers-preview-router.")) { const input = JSON.parse(init!.body as string); actions.push(input.action); return Response.json({ ready: true }); }
      if (String(url).startsWith("https://api.cloudflare.com")) throw new Error("Unexpected provisioning mutation");
      return nativeFetch(url, init);
    }) as unknown as typeof fetch;
    try {
      await expect(upPreviews({ app: "studio/web", manifest: root })).rejects.toThrow("different local database");
      expect(actions).toEqual(["probe-station"]);
      expect(gateway.routes.get(key)!.serverId).toBe("original");
    } finally { gateway.stop(); closeDatabase(); }
  });
  it("one station renews instances from separate repository databases", async () => {
    const gateway = createPreviewGateway({ port: 0, gatewayToken: process.env.SERVERS_PREVIEW_GATEWAY_TOKEN!, controlToken: process.env.SERVERS_PREVIEW_CONTROL_TOKEN! });
    const station = { id: "laptop", name: "laptop", tunnelId: crypto.randomUUID(), serviceId: crypto.randomUUID(), binding: "STATION_LAPTOP", gatewayPort: gateway.server.port! };
    const databases: Database[] = [];
    const serverIds: string[] = [];
    writeFileSync(join(root, "app.ts"), 'Bun.serve({hostname:"127.0.0.1", port:Number(process.env.PORT), fetch(){return new Response("ready")}});');
    const renewed: string[] = [];
    try {
      for (let index = 0; index < 2; index++) {
        const probe = Bun.serve({ port: 0, fetch: () => new Response("probe") }); const port = probe.port!; probe.stop(true);
        const databasePath = join(root, `repository-${index}.db`);
        const database = new Database(databasePath); databases.push(database); runMigrations(database);
        const key = `product-${index}/web/dev/main`;
        const server = createServer({ name: key, metadata: { command: `${process.execPath} app.ts`, cwd: root, port, runtime_mode: "local", runtime_process_scope: "owned", health_url: `http://127.0.0.1:${port}/`, readiness_url: `http://127.0.0.1:${port}/`, env: { PORT: String(port) } } }, database); serverIds.push(server.id);
        const started = await startLocalServer(server.id, { readyTimeoutMs: 5000 }, database);
        expect(started.ready).toBe(true);
        gateway.routes.set(key, { key, instanceId: String(index).repeat(32), serverId: server.id, databasePath, pid: started.pid!, port, hostname: `product-${index}.test-account.workers.dev`, fence: 1, expiresAt: Date.now() + 60_000, readinessPath: "/" });
      }
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).startsWith("https://servers-preview-router.")) { const input = JSON.parse(init!.body as string); renewed.push(input.key); return Response.json({ expiresAt: Date.now() + 60_000 }); }
        return nativeFetch(url, init);
      }) as unknown as typeof fetch;
      await renewGatewayRoutes(gateway, settings, station);
      expect(renewed.sort()).toEqual(["product-0/web/dev/main", "product-1/web/dev/main"]);
      expect(gateway.routes.size).toBe(2);
    } finally {
      gateway.stop();
      for (let index = 0; index < databases.length; index++) {
        try { if (serverIds[index]) await stopLocalServer(serverIds[index]!, { stopTimeoutMs: 1000 }, databases[index]!); } finally { databases[index]!.close(); }
      }
    }
  }, 15_000);
  it("product down only releases the selected environment and name, preserving app processes", async () => {
    const gateway = createPreviewGateway({ port: 0, gatewayToken: process.env.SERVERS_PREVIEW_GATEWAY_TOKEN!, controlToken: process.env.SERVERS_PREVIEW_CONTROL_TOKEN! });
    savePreviewState("station", { id: "laptop", name: "laptop", tunnelId: crypto.randomUUID(), serviceId: crypto.randomUUID(), binding: "STATION_LAPTOP", gatewayPort: gateway.server.port! });
    const route: LocalPreviewRoute = { key: "studio/web/dev/main", instanceId: "a".repeat(32), serverId: "test-server", databasePath: join(root, "servers.db"), pid: process.pid, port: 31000, hostname: "studio-web.test-account.workers.dev", fence: 1, expiresAt: Date.now() + 60_000, readinessPath: "/" };
    for (const key of [route.key, "studio/web/dev/demo", "studio/api/dev/demo", "studio/web/qa/demo", "commerce/web/dev/demo"]) gateway.routes.set(key, { ...route, key });
    const released: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith("https://servers-preview-router.")) { const input = JSON.parse(init!.body as string); expect(input.action).toBe("release"); released.push(input.key); return Response.json({ released: true }); }
      return nativeFetch(url, init);
    }) as unknown as typeof fetch;
    try {
      const result = await downPreviews({ product: "studio", environment: "dev", name: "demo" });
      expect(released.sort()).toEqual(["studio/api/dev/demo", "studio/web/dev/demo"]);
      expect(gateway.routes.size).toBe(3);
      expect(result).toEqual([{ key: "studio/web/dev/demo", exposed: false, stopped: false }, { key: "studio/api/dev/demo", exposed: false, stopped: false }]);
    } finally { gateway.stop(); }
  });
  it("dry-run up is scoped and OAuth guidance uses only declared exact callback paths", async () => {
    writeFileSync(join(root, "servers.config.json"), JSON.stringify({ version: 1, product: "studio", apps: [{ name: "web", command: "bun run dev", port: 3000, oauth: { callbackPaths: ["/api/auth/callback/google"] } }] }));
    globalThis.fetch = (async () => { throw new Error("Network prohibited in plan"); }) as unknown as typeof fetch;
    const plans = await upPreviews({ app: "studio/web", manifest: root, name: "checkout", dryRun: true });
    expect(plans).toHaveLength(1);
    const oauth = previewOAuth({ app: "studio/web", manifest: root, name: "checkout" }) as { origin: string; redirectUris: string[] }[];
    expect(oauth[0]!.redirectUris).toEqual([`${oauth[0]!.origin}/api/auth/callback/google`]);
    expect(oauth[0]!.origin).toContain(".test-account.workers.dev");
    expect(upPreviews({ app: "commerce/web", manifest: root, dryRun: true })).rejects.toThrow("scope");
  });
});
