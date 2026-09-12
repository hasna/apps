/** Release-compiled CLI over real HTTP/SQLite; every station/config mutation is confined to fixture homes. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { SqliteSkillsStore } from "../server/sqlite-store.js";
import { SqliteGovernanceStore } from "../sdk/governance-store.js";
import { createSkillsFetchHandler, type SkillsFetchHandler } from "../server/app.js";
import { publicPrincipal } from "../server/auth.js";
import { packSkillBundle } from "../lib/skill-bundle.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-profile-hooks-cli-")), binary = join(scratch, "skills.js"), executable = join(scratch, "skills");
beforeAll(async () => {
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
  writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${binary.replace(/'/g, "'\\''")}' "$@"\n`); chmodSync(executable, 0o700);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
function put(path: string, value: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value, { mode: 0o600 }); }
function json(path: string) { return JSON.parse(readFileSync(path, "utf8")); }
function objectHashes(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? objectHashes(join(path, entry.name)) : entry.name.endsWith(".tar.gz") ? [createHash("sha256").update(readFileSync(join(path, entry.name))).digest("hex")] : []).sort();
}
async function fixture() {
  const root = mkdtempSync(join(scratch, "case-")), database = join(root, "server.sqlite"), token = randomUUID();
  const store = new SqliteSkillsStore(database), governanceStore = new SqliteGovernanceStore(database);
  const principal = publicPrincipal({ orgId: "workspace_e2e", orgSlug: "e2e", userId: "actor_e2e", apiKeyId: "key_e2e" });
  await store.ensureBootstrapApiKey(token, principal);
  const versions = [];
  let previous: string | undefined;
  for (const version of ["1.0.0", "2.0.0"]) {
    const source = join(root, `source-${version}`), skillMd = `---\nname: review-code\ndescription: Review changed code\nkind: instruction\n---\nPublished ${version} review instructions.\n`;
    put(join(source, "SKILL.md"), skillMd); put(join(source, "references", "example.txt"), `asset-${version}`);
    put(join(source, "package.json"), JSON.stringify({ name: "review-code", version, skills: { kind: "instruction" } }));
    const bundle = packSkillBundle(source);
    const published = await store.publishSkill({ principal, slug: "review-code", displayName: "Review code", description: "E2E fixture", category: "Development Tools", tags: ["review"], source: "custom", kind: "instruction", version, skillMd, expectedRevisionId: previous, bundle: { sha256: bundle.sha256, byteSize: bundle.bytes.length, contentType: "application/gzip", storageKind: "db", bytes: bundle.bytes } });
    previous = published.revisionId;
    const selection = { slug: "review-code", version, bundleDigest: `sha256:${bundle.sha256}`, triggers: { keywords: ["review"] } };
    const file = join(root, `profile-${version}.json`); put(file, JSON.stringify({ selections: [selection] })); versions.push({ version, file, selection, skillMd });
  }
  let handler: SkillsFetchHandler | undefined;
  const requests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { requests.push(`${request.method} ${new URL(request.url).pathname}`); return handler ? handler(request) : new Response("Starting", { status: 503 }); } });
  const origin = `http://127.0.0.1:${server.port}`;
  handler = await createSkillsFetchHandler({ store, governanceStore, runtime: null, config: { publicBaseUrl: origin } });
  function station(id: string) {
    const home = join(root, id, "home"), data = join(home, ".hasna", "skills"), project = join(root, id, "project");
    const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, HASNA_SKILLS_API_KEY: token, HASNA_SKILLS_API_URL: origin, HASNA_STATION: id, NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", TMPDIR: join(root, id, "tmp") };
    for (const path of [home, data, project, env.TMPDIR]) mkdirSync(path, { recursive: true });
    async function run(args: string[], options: { stdin?: unknown; env?: Record<string, string>; cwd?: string; shellCommand?: string } = {}) {
      const child = Bun.spawn(options.shellCommand ? ["/bin/sh", "-c", options.shellCommand] : [process.execPath, "--no-env-file", binary, ...args], { cwd: options.cwd ?? project, env: { ...env, ...options.env }, stdin: options.stdin === undefined ? "ignore" : new Blob([JSON.stringify(options.stdin)]), stdout: "pipe", stderr: "pipe" });
      const timer = setTimeout(() => child.kill("SIGKILL"), 12_000);
      try { const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { stdout, stderr, exitCode }; }
      finally { clearTimeout(timer); }
    }
    async function ok(args: string[], options?: Parameters<typeof run>[1]) { const result = await run(args, options); expect(result.stderr).toBe(""); expect(result.exitCode).toBe(0); return JSON.parse(result.stdout); }
    async function install() { return ok(["hook", "install", "--agent", "all", "--selection-profile", "engineering", "--command", executable, "--apply", "--json"]); }
    async function hook(agent: "claude" | "codex", event: string, input: Record<string, unknown>, extra?: Record<string, string>) {
      const config = json(join(home, `.${agent}`, agent === "claude" ? "settings.json" : "hooks.json"));
      const command = config.hooks[event].flatMap((entry: any) => entry.hooks).find((entry: any) => entry.command.includes("hook user-prompt"))?.command;
      expect(typeof command).toBe("string");
      return ok([], { stdin: { cwd: project, session_id: "parent-session", hook_event_name: event, ...input }, env: extra, shellCommand: command });
    }
    return { home, data, project, env, run, ok, install, hook };
  }
  return { root, store, versions, requests, a: station("station-a"), b: station("station-b"), close: async () => { server.stop(true); await handler?.close(); await governanceStore.close(); await store.close(); } };
}

test("built CLI performs profile CAS/rollback, two-station sync, pinned hook restore and subagent inheritance over HTTP", async () => {
  const f = await fixture();
  try {
    const v1 = f.versions[0]!, v2 = f.versions[1]!;
    await f.a.install(); await f.b.install();
    const created = await f.a.ok(["profiles", "set", "engineering", "--file", v1.file, "--json"]);
    const saved = join(f.root, "rollback.json");
    const shown = await f.a.ok(["profiles", "show", "engineering", "--save", saved, "--json"]); expect(shown.revision).toBe(created.revision); expect(json(saved).selections).toEqual(created.selections);
    const duplicate = await f.a.run(["profiles", "set", "engineering", "--file", v1.file, "--json"]); expect(duplicate.exitCode).toBe(1); expect(duplicate.stderr).toContain("409");
    await f.a.ok(["sync", "--project", "--json"]); await f.b.ok(["sync", "--json"]);
    const firstHashes = objectHashes(join(f.a.data, "selection-cache")); expect(firstHashes).toEqual([v1.selection.bundleDigest.slice(7)]); expect(objectHashes(join(f.b.data, "selection-cache"))).toEqual(firstHashes);
    const receiptA = await f.a.ok(["station-state", "station-a", "--json"]), receiptB = await f.b.ok(["station-state", "station-b", "--json"]); expect(receiptA.profileRevision).toBe(created.revision); expect(receiptB.profileRevision).toBe(created.revision);
    for (const [station, agent] of [[f.a, "claude"], [f.b, "codex"]] as const) {
      const positional = await station.run(["context", "review this patch", "--cached", "--json"]); expect(positional.stdout).toContain("Published 1.0.0");
      const diagnostic = await station.run(["context", "--stdin", "--cached", "--json"], { stdin: { prompt: "review this patch", cwd: station.project } }); expect(diagnostic.stdout).toContain("Published 1.0.0");
      const context = await station.hook(agent, "UserPromptSubmit", { prompt: "review this patch" }); expect(context.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit"); expect(context.hookSpecificOutput.additionalContext).toContain(v1.skillMd);
      const duplicate = await station.hook(agent, "UserPromptSubmit", { prompt: "review this patch again" }); expect(duplicate).toEqual({});
    }
    const updated = await f.a.ok(["profiles", "set", "engineering", "--file", v2.file, "--if-match", created.revision, "--json"]); expect(updated.revision).not.toBe(created.revision);
    const stale = await f.a.run(["profiles", "set", "engineering", "--file", v1.file, "--if-match", created.revision, "--json"]); expect(stale.exitCode).toBe(1); expect(stale.stderr).toContain("409");
    await f.a.ok(["sync", "--json"]); await f.b.ok(["sync", "--json"]);
    expect((await f.a.ok(["load", "review-code@1.0.0", "--json"])).content).toBe(v1.skillMd);
    expect((await f.b.ok(["load", "review-code@2.0.0", "--json"])).content).toBe(v2.skillMd);
    expect(json(join(f.a.project, ".skills", "selection.lock.json")).profile.profileRevision).toBe(created.revision);
    for (const [station, agent] of [[f.a, "claude"], [f.b, "codex"]] as const) {
      const restored = await station.hook(agent, "SessionStart", { source: "compact" }); expect(restored.hookSpecificOutput.hookEventName).toBe("SessionStart"); expect(restored.hookSpecificOutput.additionalContext).toContain(v1.skillMd); expect(restored.hookSpecificOutput.additionalContext).not.toContain(v2.skillMd);
      const child = await station.hook(agent, "SubagentStart", { agent_id: "child-one", agent_type: "explorer" }); expect(child.hookSpecificOutput.hookEventName).toBe("SubagentStart"); expect(child.hookSpecificOutput.additionalContext).toContain(v1.skillMd);
    }
    const rollback = await f.a.ok(["profiles", "set", "engineering", "--file", saved, "--if-match", updated.revision, "--json"]); expect(rollback.revision).not.toBe(updated.revision); expect(rollback.selections).toEqual(created.selections);
    await f.b.ok(["sync", "--json"]); expect((await f.b.ok(["load", "review-code@1.0.0", "--json"])).content).toBe(v1.skillMd);
    expect(f.requests.some(path => path.startsWith("PUT /api/v1/profiles/"))).toBe(true); expect(f.requests.some(path => path.startsWith("PUT /api/v1/stations/"))).toBe(true);
    expect(existsSync(join(f.a.home, ".claude", "skills"))).toBe(false); expect(existsSync(join(f.b.home, ".codex", "skills"))).toBe(false);
  } finally { await f.close(); }
});

test("built CLI refuses revoked HTTP access without silent cache fallback and blocks failed SessionStart refresh", async () => {
  const f = await fixture();
  try {
    await f.a.install(); await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]); await f.a.ok(["sync", "--json"]);
    const before = objectHashes(join(f.a.data, "selection-cache")), invalid = { HASNA_SKILLS_API_KEY: "revoked-fixture-credential" };
    const refused = await f.a.run(["load", "review-code@1.0.0", "--json"], { env: invalid }); expect(refused.exitCode).toBe(1); expect(refused.stdout).not.toContain("Published 1.0.0"); expect(refused.stdout).toContain("SKILLS_CONTEXT_FAILED");
    const context = await f.a.run(["context", "review this patch", "--json"], { env: invalid }); expect(context.exitCode).toBe(1); expect(context.stdout).not.toContain("Published 1.0.0");
    const denied = await f.a.hook("claude", "SessionStart", { source: "startup" }, invalid); expect(denied.continue).toBe(false); expect(denied.stopReason).toContain("unavailable");
    // Prompt hooks explicitly request verified cached mode; auth is checked at session refresh.
    const cached = await f.a.hook("claude", "UserPromptSubmit", { prompt: "review this patch" }, invalid); expect(cached.hookSpecificOutput.additionalContext).toContain("Published 1.0.0");
    expect(objectHashes(join(f.a.data, "selection-cache"))).toEqual(before);
  } finally { await f.close(); }
});

test("built hook installation preserves config and migration preserves unique edited skills and vendor separation", async () => {
  const f = await fixture();
  try {
    const settings = join(f.a.home, ".claude", "settings.json"), codex = join(f.a.home, ".codex", "config.toml");
    const original = JSON.stringify({ model: "preserved-model", permissions: { allow: ["Bash(git status)"], deny: ["Read(.env)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "existing-stop-command" }] }] } });
    put(settings, original); put(codex, 'model = "preserved-codex-model"\n\n[mcp_servers.existing]\ncommand = "preserved-mcp"\n');
    const managed = join(f.a.home, ".claude", "skills", "managed"), unique = join(f.a.home, ".agents", "skills", "unique"), vendor = join(f.a.home, ".codex", "skills", ".system", "vendor");
    put(join(managed, "SKILL.md"), "Managed copy with a unique edit."); put(join(managed, ".hasna-skills.json"), JSON.stringify({ managedBy: "@hasna/skills" })); put(join(managed, "references", "asset.txt"), "Unique managed asset.");
    put(join(unique, "SKILL.md"), "Unmanaged authoring draft."); put(join(vendor, "SKILL.md"), "Vendor-provided system skill.");
    const plan = await f.a.ok(["hook", "install", "--selection-profile", "engineering", "--command", executable, "--json"]); expect(plan.applied).toBe(false); expect(readFileSync(settings, "utf8")).toBe(original);
    const installed = await f.a.install(); expect(installed.backups.some((path: string) => readFileSync(path, "utf8") === original)).toBe(true);
    const configured = json(settings); expect(configured.model).toBe("preserved-model"); expect(configured.permissions.allow).toEqual(["Bash(git status)"]); expect(configured.permissions.deny).toEqual(["Read(.env)", "Skill"]); expect(configured.hooks.Stop[0].hooks[0].command).toBe("existing-stop-command");
    const codexConfig = Bun.TOML.parse(readFileSync(codex, "utf8")) as any; expect(codexConfig.model).toBe("preserved-codex-model"); expect(codexConfig.mcp_servers.existing.command).toBe("preserved-mcp"); expect(codexConfig.skills.config).toEqual([{ path: join(unique, "SKILL.md"), enabled: false }]);
    expect((await f.a.install()).changed).toEqual([]);
    const archived = await f.a.ok(["migrate", "native", "--apply", "--json"]); expect(archived.entries).toHaveLength(1); expect(readFileSync(join(archived.entries[0].archive, "SKILL.md"), "utf8")).toBe("Managed copy with a unique edit."); expect(readFileSync(join(archived.entries[0].archive, "references", "asset.txt"), "utf8")).toBe("Unique managed asset."); expect(existsSync(managed)).toBe(false); expect(existsSync(unique)).toBe(true); expect(existsSync(vendor)).toBe(true);
    const authored = await f.a.ok(["migrate", "native", "--include-unmanaged", "--apply", "--json"]); expect(authored.entries).toHaveLength(1); expect(readFileSync(join(authored.entries[0].archive, "SKILL.md"), "utf8")).toBe("Unmanaged authoring draft."); expect(existsSync(vendor)).toBe(true);
  } finally { await f.close(); }
});

// Explicit local proof only: CI does not require a separately installed Codex binary.
// All hook sources are this test's generated configuration. No production provider or credential is used.
const nativeCodex = process.env.HASNA_SKILLS_NATIVE_CODEX_BIN;
test.skipIf(!nativeCodex)("installed Codex delivers the managed UserPromptSubmit body to a local mock model", async () => {
  const f = await fixture(); let modelServer: ReturnType<typeof Bun.serve> | undefined;
  try {
    await f.a.install(); await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    const requests: string[] = [];
    modelServer = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      if (request.method !== "POST") return Response.json({ data: [] });
      requests.push(await request.text());
      const message = { id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Fixture complete.", annotations: [] }] };
      const events = [
        { type: "response.created", response: { id: "resp_fixture", object: "response", status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } },
        { type: "response.output_item.done", output_index: 0, item: message },
        { type: "response.completed", response: { id: "resp_fixture", object: "response", status: "completed", output: [message], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
    } });
    const codexHome = join(f.a.home, ".codex"), localProvider = `http://127.0.0.1:${modelServer.port}/v1`;
    put(join(codexHome, "config.toml"), `model = "fixture-model"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Local fixture"\nbase_url = ${JSON.stringify(localProvider)}\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`);
    const child = Bun.spawn([nativeCodex!, "exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-hook-trust", "--sandbox", "read-only", "review this fixture; respond without tools"], { cwd: f.a.project, env: { ...f.a.env, CODEX_HOME: codexHome }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect({ code, stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) }).toMatchObject({ code: 0 });
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.some(body => body.includes("Published 1.0.0 review instructions."))).toBe(true);
      expect(f.requests.some(path => path === "PUT /api/v1/stations/station-a/state")).toBe(true);
    } finally { clearTimeout(timer); }
  } finally { modelServer?.stop(true); await f.close(); }
});

const nativeClaude = process.env.HASNA_SKILLS_NATIVE_CLAUDE_BIN;
test.skipIf(!nativeClaude)("installed Claude delivers selected context and omits the denied native Skill tool", async () => {
  const f = await fixture(); let modelServer: ReturnType<typeof Bun.serve> | undefined;
  try {
    put(join(f.a.home, ".claude", "skills", "native-sentinel", "SKILL.md"), "---\nname: native-sentinel\ndescription: Review fixture using native instructions\n---\nNative sentinel instructions must not be loaded.\n");
    await f.a.install(); await f.a.ok(["profiles", "set", "engineering", "--file", f.versions[0]!.file, "--json"]);
    const requests: any[] = [];
    modelServer = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const route = new URL(request.url).pathname;
      if (route.endsWith("/count_tokens")) return Response.json({ input_tokens: 1 });
      if (!route.endsWith("/messages")) return Response.json({ data: [] });
      const body = await request.json() as any; requests.push(body);
      const message = { id: "msg_fixture", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "Fixture complete." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
      if (!body.stream) return Response.json(message);
      const events = [
        { type: "message_start", message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Fixture complete." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
    } });
    const child = Bun.spawn([nativeClaude!, "--print", "--output-format", "json", "--model", "fixture-model", "review this fixture; respond without tools"], { cwd: f.a.project, env: { ...f.a.env, CLAUDE_CONFIG_DIR: join(f.a.home, ".claude"), ANTHROPIC_BASE_URL: `http://127.0.0.1:${modelServer.port}`, ANTHROPIC_API_KEY: "fixture-local-provider", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect({ code, stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) }).toMatchObject({ code: 0 });
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.some(body => JSON.stringify(body).includes("Published 1.0.0 review instructions."))).toBe(true);
      expect(requests.every(body => !body.tools?.some((tool: any) => tool.name === "Skill"))).toBe(true);
      expect(requests.every(body => !JSON.stringify(body).includes("Native sentinel instructions must not be loaded."))).toBe(true);
      expect(f.requests.some(route => route === "PUT /api/v1/stations/station-a/state")).toBe(true);
    } finally { clearTimeout(timer); }
  } finally { modelServer?.stop(true); await f.close(); }
});
