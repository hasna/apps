import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PreviewCloudflare, registerPreviewStation, setupPreviews } from "./cloudflare.js";
import { requiredSecret, savePreviewState, settingsSchema } from "./state.js";
const settings = settingsSchema.parse({ version: 1, accountId: "a".repeat(32), subdomain: "test-account", accessTeamDomain: "https://test-team.cloudflareaccess.com", accessEmails: ["developer@example.com"] });
const references = ["SERVERS_PREVIEW_STATE_DIR", "CLOUDFLARE_API_TOKEN", "SERVERS_PREVIEW_CONTROL_TOKEN", "SERVERS_PREVIEW_ROUTER_TOKEN", "SERVERS_PREVIEW_GATEWAY_TOKEN"];
let before: Record<string, string | undefined>, root: string;
beforeEach(() => { before = Object.fromEntries(references.map((key) => [key, process.env[key]])); root = mkdtempSync(join(tmpdir(), "preview-cloudflare-")); process.env.SERVERS_PREVIEW_STATE_DIR = root; for (const key of references.slice(1)) process.env[key] = crypto.randomUUID(); });
afterEach(() => { for (const key of references) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; rmSync(root, { recursive: true, force: true }); });
const ok = (result: unknown) => Response.json({ success: true, result });
describe("Cloudflare provisioning contract", () => {
  function stationDeployment(statuses: number[], lockFailureStatus?: number) {
    savePreviewState("settings", settings);
    const tunnelId = crypto.randomUUID(); const serviceId = crypto.randomUUID();
    const events: string[] = []; const waits: number[] = [];
    let attempts = 0;
    const upload = spyOn(PreviewCloudflare.prototype, "upload").mockImplementation(async () => { events.push("upload"); });
    const request = (async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path === "/__servers/control") {
        const input = JSON.parse(init!.body as string); events.push(input.action);
        if (input.action === "acquire-setup" && lockFailureStatus && attempts > 0) return Response.json({}, { status: lockFailureStatus });
        if (input.action === "register-station") {
          const status = statuses[Math.min(attempts++, statuses.length - 1)]!;
          return Response.json(status === 200 ? input.station : {}, { status });
        }
        return Response.json({});
      }
      if (path.endsWith("/settings")) return ok({ tags: ["servers-preview-router-v1"], bindings: [] });
      if (path.endsWith("/cfd_tunnel")) return ok({ id: tunnelId });
      if (path.endsWith("/configurations")) return ok({});
      if (path.endsWith("/connectivity/directory/services")) return ok({ service_id: serviceId });
      throw new Error("Unexpected provisioning request");
    }) as unknown as typeof fetch;
    return {
      events, waits, tunnelId, serviceId, upload,
      attempts: () => attempts,
      run: () => registerPreviewStation({ name: "test-station" }, request, async (delayMs) => { waits.push(delayMs); }),
    };
  }
  it("waits for a newly deployed station binding before persisting enrollment", async () => {
    const deployment = stationDeployment([503, 503, 200]);
    try {
      const station = await deployment.run() as { tunnelId: string; serviceId: string };
      expect(station.tunnelId).toBe(deployment.tunnelId); expect(station.serviceId).toBe(deployment.serviceId);
      expect(deployment.attempts()).toBe(3); expect(deployment.waits).toEqual([3000, 3000]);
      const tail = deployment.events.slice(deployment.events.indexOf("upload") + 1);
      expect(tail).toEqual(["acquire-setup", "register-station", "acquire-setup", "register-station", "acquire-setup", "register-station", "release-setup"]);
      expect(JSON.parse(readFileSync(join(root, "station.json"), "utf8")).tunnelId).toBe(deployment.tunnelId);
      expect(deployment.upload).toHaveBeenCalledTimes(1);
    } finally { deployment.upload.mockRestore(); }
  });
  it("bounds unavailable-binding retries and retains resource IDs without persisting enrollment", async () => {
    const deployment = stationDeployment([503]);
    try {
      let message = ""; try { await deployment.run(); } catch (error) { message = String(error); }
      expect(deployment.attempts()).toBe(10); expect(deployment.waits).toHaveLength(9);
      expect(message).toContain(deployment.tunnelId); expect(message).toContain(deployment.serviceId); expect(message).toContain("HTTP 503");
      expect(existsSync(join(root, "station.json"))).toBe(false);
      expect(deployment.events.at(-1)).toBe("release-setup");
      expect(deployment.upload).toHaveBeenCalledTimes(1);
    } finally { deployment.upload.mockRestore(); }
  });
  it.each([401, 403, 409])("does not retry station registration HTTP %s", async (status) => {
    const deployment = stationDeployment([status, 200]);
    try {
      await expect(deployment.run()).rejects.toThrow("Station enrollment did not finish");
      expect(deployment.attempts()).toBe(1); expect(deployment.waits).toHaveLength(0);
      expect(existsSync(join(root, "station.json"))).toBe(false);
    } finally { deployment.upload.mockRestore(); }
  });
  it.each([409, 503])("stops retrying when infrastructure lock assertion returns HTTP %s", async (status) => {
    const deployment = stationDeployment([503, 200], status);
    try {
      await expect(deployment.run()).rejects.toThrow("Infrastructure ownership changed");
      expect(deployment.attempts()).toBe(1); expect(deployment.waits).toHaveLength(1);
      expect(existsSync(join(root, "station.json"))).toBe(false);
    } finally { deployment.upload.mockRestore(); }
  });
  it("preflights non-paginated Worker quota above100 scripts and before exceeding500", async () => {
    const calls: string[] = [];
    const scripts = Array.from({ length: 200 }, (_, i) => ({ id: `existing-${i}` }));
    const api = new PreviewCloudflare(settings, (async (url: string | URL | Request) => { calls.push(String(url)); return ok(scripts); }) as unknown as typeof fetch);
    await api.quota(["one-new"]); expect(calls).toHaveLength(1); expect(calls[0]).toEndWith("/workers/scripts");
    scripts.push(...Array.from({ length: 300 }, (_, i) => ({ id: `another-${i}` })));
    expect(api.quota(["one-new"])).rejects.toThrow("quota");
  });
  it("Access onboarding fails before any cloud mutation and discards arbitrary provider diagnostics", async () => {
    const calls: string[] = [];
    const api = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${new URL(url).pathname}`);
      if (url.endsWith("/workers/subdomain")) return ok({ subdomain: settings.subdomain });
      return Response.json({ success: false, errors: [{ code: 9999, message: "access.api.error.not_enabled: Access is not enabled" }] }, { status: 403 });
    }) as unknown as typeof fetch;
    expect(setupPreviews(settings, api)).rejects.toThrow("Zero Trust onboarding");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
    const secret = requiredSecret(settings.apiTokenEnv);
    const failing = new PreviewCloudflare(settings, (async () => Response.json({ errors: [{ message: secret }] }, { status: 403 })) as unknown as typeof fetch);
    let message = ""; try { await failing.api("GET", "/workers/scripts"); } catch (error) { message = String(error); }
    expect(message).not.toContain(secret);
  });
  it("uploads isolated Worker artifacts with SQLite migration and preserves existing secret bindings", async () => {
    let form: FormData | undefined;
    const api = new PreviewCloudflare(settings, (async (_url: string | URL | Request, init?: RequestInit) => { form = init!.body as FormData; return ok({}); }) as unknown as typeof fetch, () => "export default {fetch(){return new Response('preview')}}");
    await api.upload("servers-preview-router", "preview-router", [{ type: "durable_object_namespace", name: "PREVIEWS", class_name: "PreviewRegistry" }]);
    const metadata = JSON.parse(await (form!.get("metadata") as Blob).text());
    expect(metadata.migrations).toEqual({ new_tag: "v1", new_sqlite_classes: ["PreviewRegistry"] });
    expect(metadata.keep_bindings).toEqual(["secret_text"]);
    expect(metadata.main_module).toBe("preview-router.js");
    expect(form!.get("preview-router.js")).toBeInstanceOf(Blob);
    expect(api.upload("unrelated", "preview-router", [], { tags: ["other-owner"] })).rejects.toThrow("another application");
  });
  it("disables version preview URLs when enabling permanent aliases", async () => {
    let body: unknown;
    const api = new PreviewCloudflare(settings, (async (_url: string | URL | Request, init?: RequestInit) => { body = JSON.parse(init!.body as string); return ok({}); }) as unknown as typeof fetch);
    await api.enableWorker("test-alias"); expect(body).toEqual({ enabled: true, previews_enabled: false });
  });
  it("dry run and persisted settings contain references only and never perform requests", async () => {
    const plan = await setupPreviews({ ...settings, dryRun: true }, (async () => { throw new Error("network prohibited"); }) as unknown as typeof fetch);
    expect((plan as { requiredEnv: string[] }).requiredEnv).toContain(settings.controlTokenEnv);
    savePreviewState("settings", settings);
    const serialized = readFileSync(join(root, "settings.json"), "utf8") + JSON.stringify(plan);
    for (const ref of references.slice(1)) expect(serialized).not.toContain(process.env[ref]!);
    expect(serialized).toContain("SERVERS_PREVIEW_CONTROL_TOKEN");
  });
});
