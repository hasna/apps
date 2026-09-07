import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabase } from "../db/database.js";
import { ensureSchema } from "../db/schema.js";
import { createServer, getServerBySlug, updateServer } from "../db/servers.js";
import { getLocalServerSnapshot, startLocalServer, stopLocalServer } from "../runtime/local-server.js";
import { appDirectory, instanceId, loadPreviewManifest, previewKey, selectPreviewApps, slugSchema, workerName } from "./config.js";
import { provisionPreviewAlias } from "./cloudflare.js";
import { localGatewayControl } from "./gateway.js";
import { infrastructureSecretRefs, loadPreviewSettings, loadPreviewStation, previewControl, requiredSecret, type LocalPreviewRoute, type PreviewLease, type PreviewSettings, type PreviewStation } from "./state.js";

export interface PreviewSelection { app?: string; product?: string; manifest?: string; environment?: string; name?: string }
export interface UpPreviewOptions extends PreviewSelection { takeover?: boolean; port?: number; dryRun?: boolean }
interface LocalStatus { ready: boolean; pid: number; routes: LocalPreviewRoute[] }
export async function ensurePreviewStationRunning(settings = loadPreviewSettings(), station = loadPreviewStation()): Promise<LocalStatus> {
  try { return await localGatewayControl<LocalStatus>(settings, station, "status"); } catch {}
  const dir = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(dir, "daemon.ts"), join(dir, "daemon.js"), join(dir, "preview", "daemon.js"), join(dir, "..", "preview", "daemon.js")];
  const executable = candidates.find((file) => existsSync(file));
  if (!executable) throw new Error("Preview station daemon artifact is missing; rebuild @hasna/servers");
  const child = spawn(process.execPath, [executable], { detached: true, env: process.env, stdio: "ignore" });
  let failed = false; child.once("error", () => { failed = true; }); child.unref();
  for (let attempt = 0; attempt < 80; attempt++) {
    if (failed) break;
    try { return await localGatewayControl<LocalStatus>(settings, station, "status"); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Station gateway did not start; run servers preview station start in the foreground for diagnostics");
}
async function availablePort(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const listener = createNetServer();
    listener.once("error", () => resolve(false));
    listener.listen(port, "127.0.0.1", () => listener.close(() => resolve(true)));
  });
}
async function selectPort(preferred: number, explicit: boolean, excluded: number): Promise<number> {
  for (let offset = 0; offset < (explicit ? 1 : 100); offset++) {
    const port = preferred + offset;
    if (port <= 65535 && port !== excluded && await availablePort(port)) return port;
  }
  throw new Error("No available app port; select a free --port or change the manifest's preferred port");
}
export async function upPreviews(options: UpPreviewOptions): Promise<unknown[]> {
  const settings = loadPreviewSettings();
  const loaded = loadPreviewManifest(options.manifest);
  const apps = selectPreviewApps(loaded, options);
  if (options.port && apps.length !== 1) throw new Error("--port is only valid for one app without dependencies");
  const environment = slugSchema.parse(options.environment ?? "dev");
  const name = slugSchema.parse(options.name ?? "main");
  const plans = apps.map((app) => {
    const key = previewKey({ product: loaded.manifest.product, app: app.name, environment, name });
    return { key, url: `https://${workerName(key)}.${settings.subdomain}.workers.dev`, app, directory: appDirectory(loaded, app) };
  });
  if (options.dryRun) return plans.map(({ key, url, app }) => ({ key, url, preferredPort: options.port ?? app.port, environmentReferences: app.envRefs, actions: ["Ensure station tunnel and gateway are running", "Provision hostname Access application and alias Worker", "Start app and verify readiness", "Verify remote station connectivity", options.takeover ? "Atomically take ownership" : "Claim only if unowned", "Renew ownership while healthy"] }));
  infrastructureSecretRefs(settings).filter((ref) => ref !== "TUNNEL_TOKEN").forEach((ref) => requiredSecret(ref));
  const station = loadPreviewStation();
  await ensurePreviewStationRunning(settings, station);
  // Tunnel readiness is checked through the VPC binding before changing any ownership.
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await previewControl(settings, { action: "probe-station", stationId: station.id }); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 1000)); }
  }
  if (!ready) throw new Error("Station tunnel is not reachable through Workers VPC; preview ownership was not changed");
  const database = getDatabase(); ensureSchema(database);
  if (!database.filename || database.filename === ":memory:") throw new Error("Previews require a file-backed servers database so the station can monitor all repositories");
  const databasePath = resolve(database.filename);
  const results: unknown[] = [];
  for (const plan of plans) {
    const id = instanceId(plan.key, plan.directory, station.id);
    const slug = `preview-${id}`;
    const existing = getServerBySlug(slug, database);
    const local = await localGatewayControl<LocalStatus>(settings, station, "status");
    const current = local.routes.find((route) => route.key === plan.key);
    if (current && current.instanceId === id && current.databasePath !== databasePath) throw new Error(`Preview already belongs to a different local database; set SERVERS_DB_PATH to ${current.databasePath} before managing this instance`);
    if (current && current.instanceId !== id && current.expiresAt > Date.now()) throw new Error("This station already runs that preview from another checkout; use a different --name or down the existing preview first");
    const configuredPort = options.port ?? (typeof existing?.metadata.port === "number" ? existing.metadata.port : plan.app.port);
    const observed = existing ? await getLocalServerSnapshot({ ...existing, metadata: { ...existing.metadata, runtime_process_scope: "owned" } }) : undefined;
    if (observed?.running && !observed.ready) throw new Error("Existing preview process is not ready; inspect its runtime before restarting");
    if (observed?.running && options.port && observed.port !== options.port) throw new Error("An active instance cannot change ports; down --stop before selecting another port");
    const port = observed?.running && observed.ready ? configuredPort : await selectPort(configuredPort, Boolean(options.port), station.gatewayPort);
    const forbidden = new Set(infrastructureSecretRefs(settings));
    const transientEnv: Record<string, string> = {};
    for (const [target, source] of Object.entries(plan.app.envRefs)) {
      if (forbidden.has(source) || forbidden.has(target)) throw new Error("App environment references cannot access preview infrastructure credentials");
      const value = process.env[source];
      if (value === undefined) throw new Error(`Missing app environment reference ${source}`);
      transientEnv[target] = value;
    }
    const alias = await provisionPreviewAlias(settings, plan.key);
    const publicEnv = Object.fromEntries(plan.app.publicUrlEnv.map((env) => [env, plan.url]));
    const metadata = { runtime_mode: "local", runtime_process_scope: "owned", start_command: plan.app.command, command: plan.app.command, cwd: plan.directory, port, public_url: plan.url, readiness_url: `http://127.0.0.1:${port}${plan.app.readinessPath}`, health_url: `http://127.0.0.1:${port}${plan.app.readinessPath}`, env: { ...publicEnv, PORT: String(port), HOST: "127.0.0.1" }, preview_key: plan.key, preview_instance_id: id, preview_station_id: station.id };
    const server = existing ? updateServer(existing.id, { metadata: { ...existing.metadata, ...metadata } }, database) : createServer({ name: plan.key, slug, path: plan.directory, status: "offline", metadata }, database);
    const started = await startLocalServer(server.id, { wait: true, transientEnv, omitEnv: [...forbidden], readyTimeoutMs: 30_000, agentId: "servers-preview" }, database);
    if (!started.ready) throw new Error("App did not become ready; preview ownership was not changed");
    const pending: LocalPreviewRoute = { key: plan.key, instanceId: id, serverId: server.id, databasePath, pid: started.pid!, port, hostname: alias.hostname, fence: current?.fence ?? 0, expiresAt: current?.expiresAt ?? 0, readinessPath: plan.app.readinessPath };
    await localGatewayControl(settings, station, "route", pending);
    let lease: PreviewLease | undefined;
    try {
      await previewControl(settings, { action: "probe-station", stationId: station.id });
      lease = await previewControl<PreviewLease>(settings, { action: "claim", key: plan.key, stationId: station.id, instanceId: id, takeover: options.takeover ?? false });
      await localGatewayControl(settings, station, "route", { ...pending, fence: lease.fence, expiresAt: lease.expiresAt });
    } catch (error) {
      if (!current) await localGatewayControl(settings, station, "remove", { key: plan.key }).catch(() => {});
      if (lease) await previewControl(settings, { action: "release", key: plan.key, stationId: station.id, instanceId: id, fence: lease.fence }).catch(() => {});
      throw error;
    }
    results.push({ ...lease, url: plan.url, serverId: server.id, port });
  }
  return results;
}
export async function listPreviews(product?: string): Promise<PreviewLease[]> {
  if (product) slugSchema.parse(product);
  return previewControl<PreviewLease[]>(loadPreviewSettings(), { action: "list", ...(product ? { product } : {}) });
}
function selectionKey(options: PreviewSelection): string {
  if (!options.app || options.app.split("/").length !== 2) throw new Error("Specify product/app");
  const [product, app] = options.app.split("/");
  return previewKey({ product: product!, app: app!, environment: options.environment ?? "dev", name: options.name ?? "main" });
}
export async function previewStatus(options: PreviewSelection): Promise<PreviewLease> {
  return previewControl(loadPreviewSettings(), { action: "status", key: selectionKey(options) });
}
export async function downPreviews(options: PreviewSelection & { stop?: boolean }): Promise<unknown[]> {
  const settings = loadPreviewSettings(); const station = loadPreviewStation();
  const status = await localGatewayControl<LocalStatus>(settings, station, "status");
  const keys = options.product ? status.routes.filter((route) => route.key.split("/")[0] === slugSchema.parse(options.product) && route.key.split("/")[2] === (options.environment ?? "dev") && route.key.split("/")[3] === (options.name ?? "main")).map((route) => route.key) : [selectionKey(options)];
  const results: unknown[] = [];
  for (const key of keys) {
    const route = status.routes.find((item) => item.key === key);
    if (!route) throw new Error("Preview is not active on this station; inspect status for its owner");
    try { await previewControl(settings, { action: "release", key, stationId: station.id, instanceId: route.instanceId, fence: route.fence }); }
    finally { await localGatewayControl(settings, station, "remove", { key }); }
    if (options.stop) {
      const database = new Database(route.databasePath, { readwrite: true });
      try { database.run("PRAGMA foreign_keys = ON"); database.run("PRAGMA busy_timeout = 5000"); await stopLocalServer(route.serverId, { agentId: "servers-preview", wait: true }, database); }
      finally { database.close(); }
    }
    results.push({ key, exposed: false, stopped: Boolean(options.stop) });
  }
  return results;
}
export function previewOAuth(options: PreviewSelection): unknown {
  const settings = loadPreviewSettings(); const loaded = loadPreviewManifest(options.manifest);
  const apps = selectPreviewApps(loaded, options);
  return apps.map((app) => {
    const key = previewKey({ product: loaded.manifest.product, app: app.name, environment: options.environment ?? "dev", name: options.name ?? "main" });
    const origin = `https://${workerName(key)}.${settings.subdomain}.workers.dev`;
    return { key, origin, javascriptOrigins: app.oauth?.javascriptOrigin ? [origin] : [], redirectUris: app.oauth?.callbackPaths.map((path) => `${origin}${path}`) ?? [], publicUrlEnv: app.publicUrlEnv, guidance: app.oauth ? "Register these exact URLs in separate development OAuth credentials. Configure Google consent Testing/test users. Cloudflare Access is a separate login gate." : "Declare oauth.callbackPaths in servers.config.json; callback paths depend on your auth library." };
  });
}
export async function doctorPreview(options: PreviewSelection = {}): Promise<unknown> {
  const settings = loadPreviewSettings();
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  for (const command of ["cloudflared", "lsof", "ps"]) checks.push({ name: command, ok: Boolean(Bun.which(command)), detail: Bun.which(command) ? "installed" : "required executable missing" });
  for (const ref of infrastructureSecretRefs(settings).filter((ref) => ref !== "TUNNEL_TOKEN")) checks.push({ name: ref, ok: Boolean(process.env[ref]), detail: process.env[ref] ? "present" : "missing environment reference" });
  let station: PreviewStation | undefined;
  try { station = loadPreviewStation(); checks.push({ name: "station", ok: true, detail: station.name }); } catch { checks.push({ name: "station", ok: false, detail: "run preview station register" }); }
  if (station) {
    try { await localGatewayControl(settings, station, "status"); checks.push({ name: "gateway", ok: true, detail: "loopback gateway reachable" }); } catch { checks.push({ name: "gateway", ok: false, detail: "run preview station start" }); }
    try { await previewControl(settings, { action: "probe-station", stationId: station.id }); checks.push({ name: "tunnel", ok: true, detail: "VPC gateway reachable" }); } catch { checks.push({ name: "tunnel", ok: false, detail: "check cloudflared, VPC binding and setup credentials" }); }
  }
  if (options.app) {
    try { const status = await previewStatus(options); checks.push({ name: "ownership", ok: status.expiresAt > Date.now(), detail: status.stationId ?? "offline" }); } catch { checks.push({ name: "ownership", ok: false, detail: "preview not registered or registry unavailable" }); }
  }
  return { ready: checks.every((check) => check.ok), checks };
}
