import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLaunchProfile } from "../src/direct-launch";
import { prepareHarnessLaunch } from "../src/harnesses";
import { compileModelPolicy, resolvePolicyModel } from "../src/model-policy";
import { SwitcherError, type SwitcherClient } from "../src/sdk";

const models = ["openai/main", "anthropic/alternate"].map(id => ({ id, name: id, supportedParameters: ["tools"] }));

test("direct Codex launches persist catalog selection while explicit policy stays restricted", async () => {
  const stored = new Map<string, any>();
  const client = {
    async getProfile(id: string) { if (!stored.has(id)) throw new SwitcherError(404, "not_found", "Missing"); return stored.get(id); },
    async createProfile(input: any) { const profile = { ...input, version: 1, updatedAt: new Date().toISOString() }; stored.set(input.id, profile); return profile; },
  } as unknown as SwitcherClient;
  const provider = { id: "openrouter-responses" } as any;
  const ordinary = await ensureLaunchProfile(client, provider, "codex", models[0].id);
  expect(ordinary.modelPolicy).toEqual({ version: 1, selection: "catalog" });
  expect(await ensureLaunchProfile(client, provider, "codex", models[0].id)).toEqual(ordinary);
  const restricted = await ensureLaunchProfile(client, provider, "codex", models[0].id, { version: 1 });
  expect(restricted.modelPolicy).toEqual({ version: 1 });
  expect(restricted.id).not.toBe(ordinary.id);
  expect((await ensureLaunchProfile(client, provider, "claude", models[0].id)).modelPolicy).toBeUndefined();
});

test("catalog selection allows only available snapshot IDs and leaves assigned roles pinned", () => {
  const catalog = [...models, { id: "unavailable", name: "Unavailable", available: false }, { id: "expired", name: "Expired", expiresOn: "2000-01-01" }];
  const compiled = compileModelPolicy(models[0].id, catalog, { selection: "catalog" });
  expect(compiled.allowedModels).toEqual(models.map(m => m.id).sort());
  expect(resolvePolicyModel(compiled, models[1].id)).toBe(models[1].id);
  expect(compiled.roles.subagent).toBe(models[0].id);
  expect(compiled.roles.review).toBe(models[0].id);
  for (const id of ["unavailable", "expired", "outside-provider"]) expect(() => resolvePolicyModel(compiled, id)).toThrow("outside");
  expect(() => resolvePolicyModel(compileModelPolicy(models[0].id, models), models[1].id)).toThrow("outside");
});

for (const catalogSelection of [false, true]) test(`Codex picker and gateway agree with ${catalogSelection ? "catalog" : "restricted"} selection`, async () => {
  const root = await mkdtemp(join(tmpdir(), "switcher-codex-selection-"));
  const home = join(root, "codex-home"); await mkdir(home);
  const previousHome = process.env.CODEX_HOME; process.env.CODEX_HOME = home;
  const calls: string[] = [];
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as any; calls.push(body.model);
    return Response.json({ model: body.model, status: "completed", output: [] });
  } });
  let prepared: Awaited<ReturnType<typeof prepareHarnessLaunch>> | undefined;
  try {
    prepared = await prepareHarnessLaunch({ harness: "codex", version: "codex-cli 0.154.0", model: models[0].id, models,
      baseUrl: upstream.url.origin + "/v1", protocol: "openai-responses", cwd: root, stateDir: join(root, "state"),
      modelPolicy: catalogSelection ? { selection: "catalog" } : undefined });
    const picker = JSON.parse(await readFile(prepared.configPaths.find(p => p.endsWith("codex-models.json"))!, "utf8"));
    expect(picker.models.map((m: any) => m.slug)).toEqual(catalogSelection ? models.map(m => m.id) : [models[0].id]);
    expect(prepared.args).toContain(`agents.default_subagent_model=${JSON.stringify(models[0].id)}`);
    const provider = prepared.args.find(arg => arg.startsWith("model_providers.switcher="))!;
    const baseUrl = /base_url = "([^"]+)"/.exec(provider)![1];
    const envKey = /env_key = "([^"]+)"/.exec(provider)![1];
    for (const requested of [models[0].id, models[1].id, "outside-provider"]) {
      const response = await fetch(baseUrl + "/responses", { method: "POST", headers: { authorization: `Bearer ${prepared.env[envKey]}`, "content-type": "application/json" },
        body: JSON.stringify({ model: requested, input: "fixture" }), signal: AbortSignal.timeout(5000) });
      const expected = requested === models[0].id || catalogSelection && requested === models[1].id ? 200 : 403;
      expect(response.status).toBe(expected); await response.text();
    }
    expect(calls).toEqual(catalogSelection ? models.map(m => m.id) : [models[0].id]);
  } finally {
    await prepared?.cleanup?.(); await upstream.stop(true); await rm(root, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
  }
});
