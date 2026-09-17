/** Compiled CLI + real selected bundle/API + Secrets SDK HTTP + authenticated synthetic provider. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "node:crypto";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { SqliteSkillsStore } from "../server/sqlite-store.js";
import { SqliteGovernanceStore } from "../sdk/governance-store.js";
import { createSkillsFetchHandler, type SkillsFetchHandler } from "../server/app.js";
import { publicPrincipal } from "../server/auth.js";
import { packSkillBundle } from "../lib/skill-bundle.js";
import type { SelectedSecretBindings } from "../lib/execution-secrets.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-secret-cli-")), binary = join(scratch, "skills.js"), mcpBinary = join(scratch, "skills-mcp.js");
beforeAll(async () => { await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); await buildCliFixture(resolve(import.meta.dir, "../mcp/index.ts"), mcpBinary); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
function put(path: string, value: string) { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, value, { mode: 0o600 }); }

async function fixture() {
  const root = mkdtempSync(join(scratch, "case-")), home = join(root, "home"), project = join(root, "project"), database = join(root, "server.sqlite");
  const token = randomUUID(), vaultToken = randomUUID(); let providerValue = randomUUID();
  const store = new SqliteSkillsStore(database), governanceStore = new SqliteGovernanceStore(database);
  const principal = publicPrincipal({ orgId: "workspace_e2e", orgSlug: "e2e", userId: "actor_e2e", apiKeyId: "key_e2e" });
  await store.ensureBootstrapApiKey(token, principal);
  let handler: SkillsFetchHandler | undefined, vaultReads = 0, providerReads = 0, denied = false, grantsUnavailable = false, corruptGrantScope = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    if (grantsUnavailable && url.pathname.includes("/execution-grants/")) return Response.json({error: providerValue}, {status: 503});
    if (url.pathname === "/vault/v1/secrets/get") {
      vaultReads++;
      if (denied || request.headers.get("authorization") !== `Bearer ${vaultToken}` || url.searchParams.get("key") !== "demo/provider/key") return Response.json({ error: providerValue }, { status: 403 });
      return Response.json({ key: "demo/provider/key", value: providerValue });
    }
    if (url.pathname === "/provider") {
      providerReads++;
      const valid = request.headers.get("authorization") === `Bearer ${providerValue}`;
      return Response.json({ authenticated: valid }, { status: valid ? 200 : 401 });
    }
    if (corruptGrantScope && url.pathname.endsWith("/execution-grants/engineering/resolve")) {
      return handler!(request).then(async response => {
        const value = await response.json() as any;
        if (value.bindings) value.bindings.selection.workspaceId = "wrong-workspace";
        return Response.json(value, {status:response.status});
      });
    }
    return handler ? handler(request) : new Response("Starting", { status: 503 });
  } });
  const origin = `http://127.0.0.1:${server.port}`;
  handler = await createSkillsFetchHandler({ store, governanceStore, runtime: null, config: { publicBaseUrl: origin } });
  const source = join(root, "source"), skillMd = "---\nname: provider-fixture\ndescription: Synthetic authenticated provider fixture\nkind: executable\n---\nSynthetic test only.";
  put(join(source, "SKILL.md"), skillMd);
  put(join(source, "package.json"), JSON.stringify({ name: "provider-fixture", version: "1.0.0", skills: { kind: "executable" } }));
  put(join(source, "skill.json"), JSON.stringify({ kind: "executable", runtime: { runtime: "bun", entrypoint: "src/main.ts", env: ["PROVIDER_TOKEN"], timeout: 5, sandbox: "full", needs_network: true } }));
  put(join(source, "src/main.ts"), 'const input = JSON.parse(process.env.SKILLS_INPUT_JSON!); const response = await fetch(input.url, {headers: {authorization: `Bearer ${process.env.PROVIDER_TOKEN}`}}); console.log(JSON.stringify({status: response.status, ...await response.json(), ambient: process.env.UNRELATED_CREDENTIAL ?? null})); process.exitCode = response.ok ? 0 : 1;');
  const bundle = packSkillBundle(source);
  await store.publishSkill({ principal, slug: "provider-fixture", displayName: "Provider fixture", description: "Synthetic fixture", category: "Development Tools", tags: [], source: "custom", kind: "executable", version: "1.0.0", skillMd, bundle: { sha256: bundle.sha256, byteSize: bundle.bytes.length, contentType: "application/gzip", storageKind: "db", bytes: bundle.bytes } });
  const selection = { slug: "provider-fixture", version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}` };
  const profileFile = join(root, "profile.json"); put(profileFile, JSON.stringify({ selections: [selection] }));
  for (const path of [home, project, join(root, "tmp")]) mkdirSync(path, { recursive: true });
  // Both clients use their normal config-file provider; no override key or local vault fallback.
  put(join(home, ".hasna/skills/config/credentials"), `HASNA_SKILLS_API_URL=${origin}\nHASNA_SKILLS_API_KEY=${token}\n`);
  put(join(home, ".hasna/secrets/config/credentials"), `HASNA_SECRETS_API_URL=${origin}/vault\nHASNA_SECRETS_API_KEY=${vaultToken}\n`);
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_STATION: "fixture-station", NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", TMPDIR: join(root, "tmp"), UNRELATED_CREDENTIAL: randomUUID(), PROVIDER_TOKEN: "stale-ambient-fixture" };
  async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd: project, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    try { const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { stdout, stderr, exitCode }; }
    finally { clearTimeout(timer); }
  }
  const created = await run(["profiles", "set", "engineering", "--file", profileFile, "--json"]);
  expect(created.exitCode).toBe(0);
  const synced = await run(["sync", "--selection-profile", "engineering", "--json"]); expect(synced.exitCode).toBe(0);
  const profile = JSON.parse(synced.stdout).profile;
  const binding: SelectedSecretBindings = { schema: "hasna.skills-secret-bindings.v1", selection: { ...selection, authority: profile.authority, workspaceId: profile.workspaceId, profileId: profile.profileId, profileRevision: profile.profileRevision }, consumer: { stationId: env.HASNA_STATION, workspaceDirectory: realpathSync(project) }, secretsAuthority: `${origin}/vault/v1`, bindings: { PROVIDER_TOKEN: "demo/provider/key" } };
  const bindingFile = join(root, "bindings.json"); put(bindingFile, JSON.stringify(binding));
  const runArgs = ["run", "--target", "local", "--selection-profile", "engineering", "--input", JSON.stringify({ url: `${origin}/provider` }), "--json"];
  async function runMcp() {
    put(join(home, ".hasna/skills/agent-policy.json"), JSON.stringify({loading:"cli",profileId:"engineering"}));
    const client = new Client({name:"grant-fixture",version:"1.0.0"});
    const transport = new StdioClientTransport({command:process.execPath,args:["--no-env-file",mcpBinary,"--stdio"],cwd:project,env,stderr:"pipe"});
    try {
      await client.connect(transport);
      return await client.callTool({name:"run_skill",arguments:{name:"provider-fixture",target:"local",input:{url:`${origin}/provider`}}});
    } finally { await client.close(); }
  }
  return { root, run, runMcp, runArgs, binding, bindingFile, corruptGrant: (value: boolean) => { corruptGrantScope = value; }, grantsOutage: (value: boolean) => { grantsUnavailable = value; },
    updateProfile: async () => { const current = await store.selectionStore.getProfile(principal, "engineering"); return store.selectionStore.saveProfile(principal, "engineering", [{...selection, triggers: {keywords:["unrelated change"]}}], current!.revision); },
     writeBinding: () => put(bindingFile, JSON.stringify(binding)), counts: () => ({ vaultReads, providerReads }), rotate: () => { providerValue = randomUUID(); }, deny: () => { denied = true; }, value: () => providerValue,
    close: async () => { server.stop(true); await handler?.close(); await governanceStore.close(); await store.close(); } };
}

test("compiled CLI resolves a scoped vault reference and authenticates the provider; rotation needs no reinstall", async () => {
  const f = await fixture();
  try {
    const prepared = await f.run([...f.runArgs, "provider-fixture@1.0.0", "--secret-bindings-template"]);
    expect(prepared.exitCode).toBe(0); expect(JSON.parse(prepared.stdout)).toEqual({ ...f.binding, bindings: { PROVIDER_TOKEN: "" } });
    expect(f.counts()).toEqual({ vaultReads: 0, providerReads: 0 });
    for (let i = 0; i < 2; i++) {
      const args = i === 0 ? [...f.runArgs, "--secret-bindings", f.bindingFile, "provider-fixture@1.0.0"] : [...f.runArgs, "provider-fixture@1.0.0", "--secret-bindings", f.bindingFile];
      const result = await f.run(args);
      expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
      const receipt = JSON.parse(result.stdout), output = JSON.parse(receipt.stdout);
      expect(output).toEqual({ status: 200, authenticated: true, ambient: null });
      expect(receipt.secretBinding).toEqual(f.binding);
      expect(result.stdout).not.toContain(f.value());
      expect(readFileSync(join(receipt.runDirectory, ".execution-receipt.json"), "utf8")).not.toContain(f.value());
      expect(f.counts()).toEqual({ vaultReads: i + 1, providerReads: i + 1 });
      f.rotate();
    }
  } finally { await f.close(); }
});

test("compiled CLI refuses missing, stale, unsupported and denied bindings without provider execution", async () => {
  const f = await fixture();
  try {
    const missing = await f.run([...f.runArgs, "provider-fixture"]); expect(missing.exitCode).toBe(1);
    expect(f.counts()).toEqual({ vaultReads: 0, providerReads: 0 });
    const version = f.binding.selection.version; f.binding.selection.version = "0.0.1"; f.writeBinding();
    const stale = await f.run([...f.runArgs, "--secret-bindings", f.bindingFile, "provider-fixture"]); expect(stale.exitCode).toBe(1);
    expect(stale.stdout).toContain("do not match the exact selected");
    expect(f.counts()).toEqual({ vaultReads: 0, providerReads: 0 });
    f.binding.selection.version = version; f.writeBinding();
    for (const extra of [["--cached"], ["--target", "cloud"], ["--remote"]]) {
      const result = await f.run([...f.runArgs, "--secret-bindings", f.bindingFile, "provider-fixture", ...extra]); expect(result.exitCode).toBe(1);
      expect(f.counts()).toEqual({ vaultReads: 0, providerReads: 0 });
    }
    f.deny();
    const denied = await f.run([...f.runArgs, "--secret-bindings", f.bindingFile, "provider-fixture"]);
    expect(denied.exitCode).toBe(1); expect(denied.stdout).toContain("no fallback");
    expect(JSON.stringify(denied)).not.toContain(f.value()); expect(f.counts()).toEqual({ vaultReads: 1, providerReads: 0 });
  } finally { await f.close(); }
});

test("compiled CLI manages shared grants and refreshes authorization before every provider execution", async () => {
  const f = await fixture();
  try {
    const { slug, version, bundleDigest } = f.binding.selection;
    const grant = { id: "provider-access", target: "local", selection: {slug, version, bundleDigest}, actors: ["actor_e2e"], consumers: [f.binding.consumer], secretsAuthority: f.binding.secretsAuthority, bindings: f.binding.bindings };
    const file = join(f.root, "policy.json");
    put(file, JSON.stringify({ grants: [grant] }));
    const created = await f.run(["grants", "set", "engineering", "--file", file, "--json"]);
    expect(created.exitCode).toBe(0);
    const policy = JSON.parse(created.stdout);
    expect(policy.grants).toEqual([grant]);
    let profileRevision = f.binding.selection.profileRevision;
    for (let i = 0; i < 2; i++) {
      const result = await f.run([...f.runArgs, "provider-fixture"]);
      expect(result.exitCode).toBe(0);
      const receipt = JSON.parse(result.stdout);
      expect(JSON.parse(receipt.stdout)).toEqual({status:200, authenticated:true, ambient:null});
      expect(receipt.executionGrant).toEqual({policyRevision:policy.revision, grantId:grant.id});
      expect(receipt.secretBinding.selection.profileRevision).toBe(profileRevision);
      expect(JSON.stringify(result)).not.toContain(f.value());
      if (i === 0) { profileRevision = (await f.updateProfile())!.revision; f.rotate(); }
    }
    expect(f.counts()).toEqual({vaultReads:2, providerReads:2});
    f.corruptGrant(true);
    const malformed = await f.run([...f.runArgs, "provider-fixture"]);
    expect(malformed.exitCode).toBe(1); expect(f.counts()).toEqual({vaultReads:2, providerReads:2});
    f.corruptGrant(false);
    const cached = await f.run([...f.runArgs, "provider-fixture", "--cached"]);
    expect(cached.exitCode).toBe(1);
    expect(f.counts()).toEqual({vaultReads:2, providerReads:2});
    f.grantsOutage(true);
    const unavailable = await f.run([...f.runArgs, "provider-fixture"]);
    expect(unavailable.exitCode).toBe(1);
    expect(JSON.stringify(unavailable)).not.toContain(f.value());
    expect(f.counts()).toEqual({vaultReads:2, providerReads:2});
    f.grantsOutage(false);
    const mcp = await f.runMcp();
    expect(mcp.isError).not.toBe(true);
    const mcpReceipt = JSON.parse((mcp.content as Array<{text:string}>)[0]!.text);
    expect(mcpReceipt.executionGrant).toEqual({policyRevision:policy.revision, grantId:grant.id});
    expect(JSON.parse(mcpReceipt.stdout).authenticated).toBe(true);
    expect(f.counts()).toEqual({vaultReads:3, providerReads:3});
    put(file, JSON.stringify({ grants: [] }));
    const revoked = await f.run(["grants", "set", "engineering", "--file", file, "--if-match", policy.revision, "--json"]);
    expect(revoked.exitCode).toBe(0);
    expect(JSON.parse(revoked.stdout).previousRevision).toBe(policy.revision);
    const history = await f.run(["grants", "show", "engineering", "--revision", policy.revision, "--json"]);
    expect(history.exitCode).toBe(0); expect(JSON.parse(history.stdout)).toEqual(policy);
    const denied = await f.run([...f.runArgs, "provider-fixture"]);
    expect(denied.exitCode).toBe(1);
    const mcpDenied = await f.runMcp(); expect(mcpDenied.isError).toBe(true);
    expect(f.counts()).toEqual({vaultReads:3, providerReads:3});
  } finally { await f.close(); }
});
