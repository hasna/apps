import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PreviewCloudflare, setupPreviews } from "./cloudflare.js";
import { requiredSecret, savePreviewState, settingsSchema } from "./state.js";
const settings = settingsSchema.parse({ version: 1, accountId: "a".repeat(32), subdomain: "test-account", accessTeamDomain: "https://test-team.cloudflareaccess.com", accessEmails: ["developer@example.com"] });
const references = ["SERVERS_PREVIEW_STATE_DIR", "CLOUDFLARE_API_TOKEN", "SERVERS_PREVIEW_CONTROL_TOKEN", "SERVERS_PREVIEW_ROUTER_TOKEN", "SERVERS_PREVIEW_GATEWAY_TOKEN"];
let before: Record<string, string | undefined>, root: string;
beforeEach(() => { before = Object.fromEntries(references.map((key) => [key, process.env[key]])); root = mkdtempSync(join(tmpdir(), "preview-cloudflare-")); process.env.SERVERS_PREVIEW_STATE_DIR = root; for (const key of references.slice(1)) process.env[key] = crypto.randomUUID(); });
afterEach(() => { for (const key of references) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; rmSync(root, { recursive: true, force: true }); });
const ok = (result: unknown) => Response.json({ success: true, result });
describe("Cloudflare provisioning contract", () => {
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
