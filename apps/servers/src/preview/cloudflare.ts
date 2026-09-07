import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";
import { createHash } from "node:crypto";
import { slugSchema, workerName } from "./config.js";
import { loadPreviewSettings, loadPreviewStation, previewControl, PreviewControlError, requiredSecret, savePreviewState, settingsSchema, type PreviewSettings, type PreviewStation } from "./state.js";

type Binding = { type: string; name: string; [key: string]: unknown };
interface WorkerSettings { bindings?: Binding[]; tags?: string[]; migrations?: { tag?: string }; }
const ROUTER_TAG = "servers-preview-router-v1";
const ALIAS_TAG = "servers-preview-alias-v1";
const waitForStationPropagation = (delayMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, delayMs));
export class CloudflareApiError extends Error {
  constructor(public status: number, method: string, path: string) { super(`Cloudflare ${method} ${path.split("?")[0]} failed (HTTP ${status}); check token permissions and account configuration`); }
}
export class PreviewCloudflare {
  constructor(readonly settings: PreviewSettings, private readonly request: typeof fetch = fetch, private readonly readArtifact: (name: string) => string = workerArtifact, private readonly beforeMutation?: () => Promise<void>) {}
  async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (method !== "GET") await this.beforeMutation?.();
    let response: Response;
    try {
      response = await this.request(`https://api.cloudflare.com/client/v4/accounts/${this.settings.accountId}${path}`, {
        method, headers: { authorization: `Bearer ${requiredSecret(this.settings.apiTokenEnv)}`, ...(body instanceof FormData ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(30_000), redirect: "error",
      });
    } catch { throw new Error("Cloudflare API is unreachable; no credential values have been logged"); }
    if (!response.ok) {
      const diagnostic = await response.json().catch(() => ({})) as { errors?: { message?: string }[] };
      if (path.startsWith("/access/") && diagnostic.errors?.some((error) => error.message?.includes("access.api.error.not_enabled") || error.message?.includes("Access is not enabled"))) {
        throw new Error("Cloudflare Access is not enabled for this account. Complete Zero Trust onboarding and enable Access in the Cloudflare dashboard, then rerun preview setup. No unprotected preview will be published.");
      }
      throw new CloudflareApiError(response.status, method, path);
    }
    const envelope = await response.json() as { success?: boolean; result: T };
    if (envelope.success === false) throw new CloudflareApiError(response.status, method, path);
    return envelope.result;
  }
  async list<T>(path: string): Promise<T[]> {
    const values: T[] = [];
    for (let page = 1; page <= 100; page++) {
      const chunk = await this.api<T[]>("GET", `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      values.push(...chunk);
      if (chunk.length < 100) return values;
    }
    throw new Error("Cloudflare resource listing exceeded pagination limit");
  }
  async workerSettings(name: string): Promise<WorkerSettings | undefined> {
    try { return await this.api<WorkerSettings>("GET", `/workers/scripts/${name}/settings`); }
    catch (error) { if (error instanceof CloudflareApiError && error.status === 404) return undefined; throw error; }
  }
  async quota(requiredNames: string[]): Promise<void> {
    const scripts = await this.api<{ id: string }[]>("GET", "/workers/scripts");
    const existing = new Set(scripts.map((script) => script.id));
    const needed = new Set(requiredNames.filter((name) => !existing.has(name))).size;
    if (scripts.length + needed > this.settings.workerLimit) throw new Error(`Workers script quota would be exceeded (${scripts.length} existing + ${needed} new; configured limit ${this.settings.workerLimit})`);
  }
  async upload(name: string, artifact: "preview-router" | "preview-alias", bindings: Binding[], existing?: WorkerSettings): Promise<void> {
    const tag = artifact === "preview-router" ? ROUTER_TAG : ALIAS_TAG;
    if (existing && !existing.tags?.includes(tag)) throw new Error(`Worker name ${name} is already owned by another application`);
    const metadata: Record<string, unknown> = {
      main_module: `${artifact}.js`, compatibility_date: "2026-09-01", bindings, tags: [tag],
      keep_bindings: ["secret_text"],
    };
    if (artifact === "preview-router" && !existing) metadata.migrations = { new_tag: "v1", new_sqlite_classes: ["PreviewRegistry"] };
    const data = new FormData();
    data.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    data.set(`${artifact}.js`, new Blob([this.readArtifact(artifact)], { type: "application/javascript+module" }), `${artifact}.js`);
    await this.api("PUT", `/workers/scripts/${name}`, data);
  }
  async secret(worker: string, name: string, reference: string): Promise<void> {
    await this.api("PUT", `/workers/scripts/${worker}/secrets`, { name, type: "secret_text", text: requiredSecret(reference) });
  }
  async enableWorker(name: string): Promise<void> {
    await this.api("POST", `/workers/scripts/${name}/subdomain`, { enabled: true, previews_enabled: false });
  }
}
function workerArtifact(name: string): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++, directory = dirname(directory)) {
    const path = join(directory, "workers", `${name}.js`);
    if (existsSync(path)) return readFileSync(path, "utf8");
    const built = join(directory, "dist", "workers", `${name}.js`);
    if (existsSync(built)) return readFileSync(built, "utf8");
  }
  throw new Error("Preview Worker artifact is missing; run the @hasna/servers build first");
}
export interface SetupPreviewOptions { accountId?: string; subdomain?: string; accessTeamDomain?: string; accessEmails?: string[]; routerName?: string; dryRun?: boolean }
export async function setupPreviews(options: SetupPreviewOptions, request?: typeof fetch): Promise<unknown> {
  let previous: PreviewSettings | undefined;
  try { previous = loadPreviewSettings(); } catch {}
  let settings: PreviewSettings;
  try { settings = settingsSchema.parse({ ...previous, version: 1, accountId: options.accountId ?? previous?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID, subdomain: options.subdomain ?? previous?.subdomain, accessTeamDomain: options.accessTeamDomain ?? previous?.accessTeamDomain, accessEmails: options.accessEmails ?? previous?.accessEmails, routerName: options.routerName ?? previous?.routerName }); }
  catch { throw new Error("Setup requires --account-id, --subdomain, --access-team https://TEAM.cloudflareaccess.com and at least one --access-email"); }
  const plan = { provider: "cloudflare", hostnameMode: "workers.dev", router: `${settings.routerName}.${settings.subdomain}.workers.dev`, workerLimit: settings.workerLimit, actions: ["Verify workers.dev subdomain and Worker quota", "Create or update shared router and Durable Object registry", "Configure environment-backed Worker secrets", "Disable version preview URLs", "Save credential references locally"], requiredEnv: [settings.apiTokenEnv, settings.controlTokenEnv, settings.routerTokenEnv, settings.gatewayTokenEnv] };
  if (options.dryRun) return plan;
  plan.requiredEnv.forEach((ref) => requiredSecret(ref));
  const api = new PreviewCloudflare(settings, request);
  const actual = await api.api<{ subdomain: string }>("GET", "/workers/subdomain");
  if (actual.subdomain !== settings.subdomain) throw new Error("Configured workers.dev subdomain does not match the account; configure it in the Cloudflare dashboard first");
  const org = await api.api<{ auth_domain?: string }>("GET", "/access/organizations");
  if (`https://${org.auth_domain}` !== settings.accessTeamDomain) throw new Error("Access team domain does not match the account's Zero Trust organization");
  await api.quota([settings.routerName]);
  const existing = await api.workerSettings(settings.routerName);
  const configure = async (assertLock?: () => Promise<void>) => {
    const guarded = new PreviewCloudflare(settings, request, workerArtifact, assertLock);
    const latest = existing ? await guarded.workerSettings(settings.routerName) : undefined;
    const bindings = latest?.bindings?.filter((binding) => binding.type !== "secret_text") ?? [{ type: "durable_object_namespace", name: "PREVIEWS", class_name: "PreviewRegistry" }];
    await guarded.upload(settings.routerName, "preview-router", bindings, latest);
    for (const [name, ref] of [["CONTROL_TOKEN", settings.controlTokenEnv], ["ROUTER_TOKEN", settings.routerTokenEnv], ["GATEWAY_TOKEN", settings.gatewayTokenEnv]]) await guarded.secret(settings.routerName, name!, ref!);
    await guarded.enableWorker(settings.routerName);
    savePreviewState("settings", settings);
  };
  if (existing) await withInfrastructureLock(settings, configure, request);
  else await configure();
  return { ...plan, ready: true };
}
async function registerStationUnlocked(options: { name?: string; gatewayPort?: number; dryRun?: boolean } = {}, request?: typeof fetch, assertLock?: () => Promise<void>, wait = waitForStationPropagation): Promise<unknown> {
  const settings = loadPreviewSettings();
  let existingStation: PreviewStation | undefined;
  try { existingStation = loadPreviewStation(); } catch {}
  if (existingStation) {
    if (options.name && options.name !== existingStation.name || options.gatewayPort && options.gatewayPort !== existingStation.gatewayPort) throw new Error("Station is already enrolled; preserve its identity and gateway port");
    return existingStation;
  }
  const name = slugSchema.parse(options.name ?? hostname().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40));
  const id = `${name.slice(0, 30)}-${crypto.randomUUID().slice(0, 8)}`;
  const gatewayPort = options.gatewayPort ?? 47832;
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65535) throw new Error("Gateway port must be between 1024 and 65535");
  if (options.dryRun) return { station: name, gateway: `127.0.0.1:${gatewayPort}`, actions: ["Create one named tunnel for this station", "Create one fixed loopback VPC Service", "Bind service to shared router", "Register immutable station identity"], credentialStorage: "environment only" };
  const api = new PreviewCloudflare(settings, request, workerArtifact, assertLock);
  const router = await api.workerSettings(settings.routerName);
  if (!router?.tags?.includes(ROUTER_TAG)) throw new Error("Shared preview router is missing; run setup first");
  const tunnel = await api.api<{ id: string }>("POST", "/cfd_tunnel", { name: `servers-preview-${id}`, config_src: "cloudflare" });
  let serviceId: string | undefined;
  try {
    await api.api("PUT", `/cfd_tunnel/${tunnel.id}/configurations`, { config: { ingress: [{ service: "http_status:404" }], "warp-routing": { enabled: true } } });
    const service = await api.api<{ service_id: string }>("POST", "/connectivity/directory/services", { name: `servers-preview-${id}`, type: "http", http_port: gatewayPort, host: { ipv4: "127.0.0.1", network: { tunnel_id: tunnel.id } } });
    serviceId = service.service_id;
    const binding = `STATION_${id.toUpperCase().replace(/-/g, "_")}`;
    // Re-read immediately before updating to preserve other registered station bindings.
    const latest = await api.workerSettings(settings.routerName);
    const bindings = (latest?.bindings ?? []).filter((item) => item.type !== "secret_text");
    bindings.push({ type: "vpc_service", name: binding, service_id: serviceId });
    await api.upload(settings.routerName, "preview-router", bindings, latest);
    const station: PreviewStation = { id, name, tunnelId: tunnel.id, serviceId, binding, gatewayPort };
    // A successful upload can precede the new VPC binding reaching the serving
    // Worker. Retry only this idempotent registration, keeping the setup lease.
    for (let attempt = 0; attempt < 10; attempt++) {
      await assertLock?.();
      try {
        await previewControl(settings, { action: "register-station", station: { id, binding } }, request);
        break;
      } catch (error) {
        if (!(error instanceof PreviewControlError) || error.status !== 503 || attempt === 9) throw error;
        await wait(3000);
      }
    }
    savePreviewState("station", station);
    return station;
  } catch (error) {
    // Created resources have no public ingress. Retain their identifiers for operator recovery, without tokens.
    throw new Error(`Station enrollment did not finish; tunnel ${tunnel.id}${serviceId ? ` and VPC Service ${serviceId}` : ""} may need cleanup in Cloudflare. ${error instanceof Error ? error.message : "Retry setup"}`);
  }
}
async function provisionAliasUnlocked(settings: PreviewSettings, key: string, request?: typeof fetch, assertLock?: () => Promise<void>): Promise<{ hostname: string; worker: string }> {
  const api = new PreviewCloudflare(settings, request, workerArtifact, assertLock);
  const worker = workerName(key);
  const hostname = `${worker}.${settings.subdomain}.workers.dev`;
  await api.quota([worker]);
  const existing = await api.workerSettings(worker);
  if (existing && !existing.tags?.includes(ALIAS_TAG)) throw new Error("Preview Worker name collides with another application");
  const apps = await api.list<{ id: string; name: string; domain: string; aud: string; type: string }>("/access/apps");
  const expectedName = `servers-preview-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
  let access = apps.find((app) => app.domain === hostname);
  if (access && (access.name !== expectedName || access.type !== "self_hosted")) throw new Error("Preview hostname already has an independently managed Access application");
  if (!access) access = await api.api("POST", "/access/apps", { name: expectedName, domain: hostname, type: "self_hosted", session_duration: "24h", app_launcher_visible: false, policies: [{ name: "Preview developers", decision: "allow", include: settings.accessEmails.map((email) => ({ email: { email } })) }] });
  if (access) {
    const policies = await api.list<{ decision: string; include?: { email?: { email: string } }[]; exclude?: unknown[]; require?: unknown[] }>(`/access/apps/${access.id}/policies`);
    const policy = policies[0];
    const actualEmails = policy?.include?.map((rule) => rule.email?.email).sort();
    if (policies.length !== 1 || policy?.decision !== "allow" || policy.exclude?.length || policy.require?.length || JSON.stringify(actualEmails) !== JSON.stringify([...settings.accessEmails].sort())) {
      throw new Error("Preview Access policy differs from the configured developer allowlist; restore the managed policy before exposing this preview");
    }
  }
  if (!access?.aud) throw new Error("Cloudflare Access did not return an audience; refusing to expose preview");
  const bindings: Binding[] = [
    { type: "service", name: "ROUTER", service: settings.routerName },
    ...Object.entries({ PREVIEW_KEY: key, PREVIEW_HOST: hostname, ACCESS_TEAM_DOMAIN: settings.accessTeamDomain, ACCESS_AUD: access.aud }).map(([name, text]) => ({ type: "plain_text", name, text })),
  ];
  await api.upload(worker, "preview-alias", bindings, existing);
  await api.secret(worker, "ROUTER_TOKEN", settings.routerTokenEnv);
  await previewControl(settings, { action: "register-preview", preview: { key, hostname } }, request);
  await api.enableWorker(worker);
  return { hostname, worker };
}

/** Serialize account-level binding and alias provisioning across workstations. */
async function withInfrastructureLock<T>(settings: PreviewSettings, work: (assertLock: () => Promise<void>) => Promise<T>, request?: typeof fetch): Promise<T> {
  const operationId = crypto.randomUUID();
  await previewControl(settings, { action: "acquire-setup", operationId }, request);
  let failed = false;
  const timer = setInterval(() => { void previewControl(settings, { action: "acquire-setup", operationId }, request).catch(() => { failed = true; }); }, 30_000);
  try {
    const assertLock = async () => {
      if (failed) throw new Error("Infrastructure coordination was interrupted before mutation");
      try { await previewControl(settings, { action: "acquire-setup", operationId }, request); }
      catch { failed = true; throw new Error("Infrastructure ownership changed; no further changes will be made"); }
    };
    const result = await work(assertLock);
    if (failed) throw new Error("Infrastructure coordination was interrupted; inspect setup before retrying");
    return result;
  } finally {
    clearInterval(timer);
    await previewControl(settings, { action: "release-setup", operationId }, request).catch(() => {});
  }
}
export async function registerPreviewStation(options: { name?: string; gatewayPort?: number; dryRun?: boolean } = {}, request?: typeof fetch, wait = waitForStationPropagation): Promise<unknown> {
  if (options.dryRun) return registerStationUnlocked(options, request);
  return withInfrastructureLock(loadPreviewSettings(), (assertLock) => registerStationUnlocked(options, request, assertLock, wait), request);
}
export async function provisionPreviewAlias(settings: PreviewSettings, key: string, request?: typeof fetch): Promise<{ hostname: string; worker: string }> {
  return withInfrastructureLock(settings, (assertLock) => provisionAliasUnlocked(settings, key, request, assertLock), request);
}
