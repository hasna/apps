import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { afterEach, expect, test } from "bun:test";
import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, readSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { admitPlugin, planPluginAdmission, type PluginAdmissionReceipt } from "./plugin-admission.js";
import { pluginFixture, putSynthetic } from "./plugin-admission.test-fixtures.js";
import { pluginExecutableDigest } from "./plugin-projection-store.js";
import { HttpProfileClient } from "./profile-client.js";
import { captureManagedPluginRegistry } from "./plugin-discovery.js";
import { verifyAgentDiscovery, type AgentDiscoveryBinding } from "./agent-discovery.js";

/** Opt-in real-runtime proof. Run the entire test process in a fresh Linux network namespace. */
const enabled = Boolean(process.env.SKILLS_TEST_CLAUDE_BIN && process.env.SKILLS_TEST_NETWORK_ISOLATED === "1");
const nativeTest = enabled ? test : test.skip;
const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });
nativeTest.each([false, true])("Claude command sources install and update freshly authorized projections (versionless=%s)", async (versionless) => {
  expect(process.platform).toBe("linux");
  expect(readlinkSync("/proc/self/ns/net")).toMatch(/^net:\[\d+\]$/);
  expect(Object.keys(networkInterfaces())).toEqual(["lo"]);
  expect(readFileSync("/proc/net/route", "utf8").trim().split("\n")).toHaveLength(1);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "skills-native-admission-"))), home = join(root, "home");
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(home, { mode: 0o700 }); mkdirSync(join(root, "tmp"), { mode: 0o700 });
  // Publish the fixture only after its complete copy matches the reviewed binary.
  // A live updater can replace/rewrite the source while this test is preparing.
  const source = realpathSync(process.env.SKILLS_TEST_CLAUDE_BIN!), native = join(root, "claude"), staging = `${native}.staging`;
  expect(process.env.SKILLS_TEST_CLAUDE_SHA256).toMatch(/^[a-f0-9]{64}$/);
  const expectedDigest = `sha256:${process.env.SKILLS_TEST_CLAUDE_SHA256}`, sourceBefore = lstatSync(source), beforeDigest = pluginExecutableDigest(source);
  copyFileSync(source, staging); chmodSync(staging, 0o755);
  const fd = openSync(staging, "r"), header = Buffer.alloc(64);
  try { fsyncSync(fd); expect(readSync(fd, header, 0, header.length, 0)).toBe(header.length); } finally { closeSync(fd); }
  const copied = lstatSync(staging), copyDigest = pluginExecutableDigest(staging), sourceAfter = lstatSync(source), afterDigest = pluginExecutableDigest(source);
  const describe = (stat: NonNullable<ReturnType<typeof lstatSync>>) => ({ size: stat.size, ino: stat.ino, dev: stat.dev, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
  console.info(JSON.stringify({ nativePluginProof: "verified-fixture-copy", architecture: process.arch, sourceBefore: describe(sourceBefore), sourceAfter: describe(sourceAfter), copied: describe(copied), beforeDigest, afterDigest, copyDigest, expectedDigest, elfHeader: header.toString("hex") }));
  expect(beforeDigest).toBe(expectedDigest); expect(afterDigest).toBe(expectedDigest); expect(copyDigest).toBe(expectedDigest);
  expect(copied.size).toBe(sourceBefore.size); expect(sourceAfter.size).toBe(sourceBefore.size);
  expect(header.subarray(0, 6).toString("hex")).toBe("7f454c460201");
  expect(header.readUInt16LE(18)).toBe(process.arch === "arm64" ? 183 : 62);
  renameSync(staging, native);
  const resolver = realpathSync(resolve(import.meta.dir, "../..", "bin/index.js"));
  const env = { HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LANG: "C.UTF-8", TMPDIR: join(root, "tmp"), DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" };
  putSynthetic(join(home, ".claude/settings.json"), JSON.stringify({ disableBundledSkills: true, syncClaudeAiSkills: false, syncClaudeAiPlugins: false }));
  const fixture = pluginFixture(join(root, "packages"), { versionless }), credential = "synthetic-native-admission-fixture";
  let unrelatedSelection = false;
  const calls: Array<{ path: string; status: number }> = [], steps: Array<{ label: string; exitCode: number }> = [];
  const fetchSynthetic = async (request: Request) => {
    const path = new URL(request.url).pathname;
    const respond = (body: BodyInit | null, status = 200) => { calls.push({ path, status }); return new Response(body, { status }); };
    if (request.method !== "GET") return respond("Synthetic writes are forbidden", 405);
    if (request.headers.get("Authorization") !== `Bearer ${credential}`) return respond(null, 401);
    if (fixture.state.offline) return respond(null, 503);
    if (fixture.state.revoked) return respond(null, 403);
    if (path === "/skills/api/auth/whoami") return respond(JSON.stringify({
      user: { id: fixture.state.principal.userId, email: "owner@synthetic.test", role: fixture.state.principal.role },
      organization: { id: fixture.state.principal.accountId, slug: "synthetic-workspace", name: "Synthetic workspace" },
    }));
    if (path === "/skills/api/v1/profiles/synthetic-profile/resolve") {
      const profile = fixture.profile();
      if (unrelatedSelection) profile.selections.push({ ...profile.selections[1]!, slug: "unrelated-skill" });
      return respond(JSON.stringify(profile));
    }
    const match = /^\/skills\/api\/v1\/skills\/([^/]+)\/versions\/([^/]+)\/bundle$/.exec(path);
    if (match) { const bytes = fixture.bundles.get(`${match[1]}@${match[2]}`); return bytes ? respond(new Uint8Array(bytes)) : respond(null, 404); }
    return respond(null, 404);
  };
  let server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: fetchSynthetic });
  cleanup.push(() => { server.stop(true); });
  const base = `http://127.0.0.1:${server.port}/skills`;
  // Custom instances retain /api/v1; the fleet gateway alone uses its /v1 rewrite.
  const client = new HttpProfileClient(credential, base); fixture.state.authority = client.authority;
  putSynthetic(join(home, ".hasna/skills/config/credentials"), `HASNA_SKILLS_API_URL=${base}\nHASNA_SKILLS_API_KEY=${credential}\n`, 0o600);
  const nativeVersion = process.env.SKILLS_TEST_CLAUDE_VERSION ?? "2.1.274";
  expect(["2.1.274", "2.1.276"]).toContain(nativeVersion);
  fixture.target.native = { version: nativeVersion as "2.1.274" | "2.1.276", executable: native, digest: pluginExecutableDigest(native) };
  fixture.target.resolver = { executable: resolver, digest: pluginExecutableDigest(resolver) };
  const options = { client, storeRoot: join(home, ".hasna/skills/plugin-admission") };
  async function run(label: string, args: string[], binary = native) {
    const child = Bun.spawn([binary, ...args], { cwd: home, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), 25_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(stdout.includes(credential) || stderr.includes(credential)).toBe(false);
      steps.push({ label, exitCode });
      // Raw exit status and output are useful when a future native runtime changes the contract.
      console.info(JSON.stringify({ nativePluginProof: label, exitCode, stdout, stderr }));
      return { stdout, stderr, exitCode };
    } finally { clearTimeout(timer); }
  }
  const registry = join(home, ".claude/plugins/installed_plugins.json");
  const document = () => JSON.parse(readFileSync(registry, "utf8")) as { version: number; plugins: Record<string, Array<Record<string, unknown>>> };
  const registration = () => document().plugins["fixture@synthetic"]![0]!;
  const lastJson = (stdout: string): Record<string, any> => JSON.parse(stdout.trim().split("\n").at(-1)!);
  const admit = async (): Promise<PluginAdmissionReceipt> => {
    const plan = await planPluginAdmission("synthetic-integration", "synthetic-profile", fixture.target, options);
    return admitPlugin("synthetic-integration", "synthetic-profile", fixture.target, plan.planDigest, plan.evidenceDigest, options);
  };
  try {
    const version = await run("certified-version", ["--version"]);
    expect(version.exitCode).toBe(0); expect(version.stdout.trim()).toBe(`${nativeVersion} (Claude Code)`);
    const baseline = join(root, "baseline");
    cpSync(join(root, "packages/bundle-1.0.0/original"), join(baseline, "original"), { recursive: true });
    putSynthetic(join(baseline, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "baseline", owner: { name: "Synthetic fixture" }, plugins: [{ name: "fixture", source: "./original" }] }));
    expect((await run("baseline-marketplace", ["plugin", "marketplace", "add", baseline])).exitCode).toBe(0);
    expect((await run("baseline-install", ["plugin", "install", "fixture@baseline", "--json"])).exitCode).toBe(0);
    const original = await run("baseline-two-prompts", ["plugin", "details", "fixture@baseline"]);
    expect(original.exitCode).toBe(0); expect(original.stdout).toContain("Skills (2)"); expect(original.stdout).toContain("command-example");
    const first = await admit(), market = join(root, "market");
    const catalog = { name: "synthetic", owner: { name: "Synthetic fixture" }, plugins: [{ name: "fixture", source: { source: "command", command: first.plan.sourceCommand, timeout: 10, mode: "copy" } }] };
    const marketPath = join(market, ".claude-plugin/marketplace.json"); putSynthetic(marketPath, JSON.stringify(catalog));
    expect((await run("projection-marketplace", ["plugin", "marketplace", "add", market])).exitCode).toBe(0);
    const beforeAcceptance = calls.length, unaccepted = await run("unaccepted-install", ["plugin", "install", "fixture@synthetic", "--json"]);
    expect(unaccepted.exitCode).not.toBe(0); expect(calls.length).toBe(beforeAcceptance);
    const acceptance = lastJson(unaccepted.stdout).shownCommand.sha256;
    expect(typeof acceptance).toBe("string");
    expect((await run("accepted-install", ["plugin", "install", "fixture@synthetic", "--json", "--accept-command", acceptance])).exitCode).toBe(0);
    const initial = registration(); expect(initial.sourceProducerPath).toBe(first.materializedPath);
    const details = await run("projected-components", ["plugin", "details", "fixture@synthetic"]);
    expect(details.exitCode).toBe(0);
    for (const component of ["Skills (0)", "Agents (1)", "Hooks (1)", "MCP servers (1)", "LSP servers (1)"]) expect(details.stdout).toContain(component);
    expect(details.stdout).not.toContain("command-example");
    console.info(JSON.stringify({ nativePluginProof: "native-cache-shape", registration: initial, members: readdirSync(join(home, ".claude/plugins/cache/synthetic/fixture"), { recursive: true }) }));
    const witness: AgentDiscoveryBinding = { agent: "claude", method: "reviewed", roots: [], sources: [captureManagedPluginRegistry(registry, [{ bindingId: first.plan.bindingId, storeRoot: options.storeRoot }])] };
    expect(() => verifyAgentDiscovery(witness)).not.toThrow();
    const direct = await run("single-line-cli-resolution", ["integration", "plugin", "resolve", "--binding", first.plan.bindingId], resolver);
    expect(direct.exitCode).toBe(0); expect(direct.stdout).toBe(`${first.materializedPath}\n`);
    const receiptPath = join(options.storeRoot, "receipts", first.plan.bindingId, `${first.plan.planDigest.slice(7)}.json`), firstReceiptBytes = readFileSync(receiptPath);
    fixture.state.revision = "unrelated-r2"; unrelatedSelection = true;
    const beforeUnrelated = calls.length;
    expect((await run("unrelated-profile-update-refused", ["plugin", "update", "fixture@synthetic", "--json"])).exitCode).not.toBe(0);
    expect(registration()).toEqual(initial); expect(registration().sourceProducerPath).toBe(first.materializedPath);
    expect(calls.slice(beforeUnrelated).map(call => call.path)).toEqual(["/skills/api/auth/whoami", "/skills/api/v1/profiles/synthetic-profile/resolve", "/skills/api/v1/skills/synthetic-integration/versions/1.0.0/bundle", "/skills/api/v1/skills/synthetic-payload/versions/1.0.0/bundle", "/skills/api/v1/profiles/synthetic-profile/resolve", "/skills/api/auth/whoami"]);
    expect(readFileSync(receiptPath)).toEqual(firstReceiptBytes); expect(() => verifyAgentDiscovery(witness)).not.toThrow();
    const freshPlan = await planPluginAdmission("synthetic-integration", "synthetic-profile", fixture.target, options);
    expect(freshPlan.planDigest).not.toBe(first.plan.planDigest); expect(freshPlan.evidenceDigest).not.toBe(first.plan.evidenceDigest);
    expect(freshPlan.observation.profileRevision).toBe("unrelated-r2");
    fixture.state.revision = "relevant-r3"; fixture.update("1.0.1");
    const unapproved = await run("unapproved-update", ["plugin", "update", "fixture@synthetic", "--json"]);
    expect(unapproved.exitCode).not.toBe(0); expect(registration()).toEqual(initial);
    const second = await admit(); expect(second.plan.bindingId).toBe(first.plan.bindingId);
    expect((await run("approved-update", ["plugin", "update", "fixture@synthetic", "--json"])).exitCode).toBe(0);
    const updated = registration(); expect(updated.sourceProducerPath).toBe(second.materializedPath); expect(updated.version).not.toBe(initial.version);
    const cacheRoot = join(home, ".claude/plugins/cache/synthetic/fixture");
    console.info(JSON.stringify({ nativePluginProof: "updated-cache-shape", registration: updated, members: readdirSync(cacheRoot, { recursive: true }).map(path => { const entry = join(cacheRoot, path as string), stat = lstatSync(entry); return { path, mode: stat.mode & 0o7777, size: stat.size, ...(stat.isFile() && String(path).endsWith(".orphaned_at") ? { metadata: readFileSync(entry, "utf8") } : {}) }; }) }));
    expect(() => verifyAgentDiscovery(witness)).not.toThrow();
    expect((await run("unchanged-update", ["plugin", "update", "fixture@synthetic", "--json"])).exitCode).toBe(0);
    expect(registration()).toEqual(updated);
    for (const state of ["revoked", "offline"] as const) {
      fixture.state[state] = true;
      expect((await run(`${state}-update`, ["plugin", "update", "fixture@synthetic", "--json"])).exitCode).not.toBe(0);
      expect(registration()).toEqual(updated); fixture.state[state] = false;
    }
    const port = server.port; server.stop(true);
    expect((await run("network-offline-update", ["plugin", "update", "fixture@synthetic", "--json"])).exitCode).not.toBe(0);
    expect(registration()).toEqual(updated);
    server = Bun.serve({ hostname: "127.0.0.1", port, fetch: fetchSynthetic });
    const beforeChangedCommand = calls.length;
    catalog.plugins[0]!.source.command += " --changed"; putSynthetic(marketPath, JSON.stringify(catalog));
    expect((await run("changed-command-old-acceptance", ["plugin", "update", "fixture@synthetic", "--json", "--accept-command", acceptance])).exitCode).not.toBe(0);
    expect(calls.length).toBe(beforeChangedCommand); expect(registration()).toEqual(updated);
    const cache = updated.installPath as string;
    putSynthetic(join(cache, "skills/reseeded/SKILL.md"), "---\nname: reseeded\ndescription: Synthetic cache mutation\n---\nSynthetic fixture only.\n");
    expect(() => verifyAgentDiscovery(witness)).toThrow();
    const mutated = await run("native-cache-mutation-visible", ["plugin", "details", "fixture@synthetic"]);
    expect(mutated.exitCode).toBe(0); expect(mutated.stdout).toContain("reseeded"); expect(registration()).toEqual(updated);
    expect(existsSync(first.materializedPath) && existsSync(second.materializedPath)).toBe(true);
    expect(calls.some(call => call.status === 403) && calls.some(call => call.status === 503)).toBe(true);
    console.info(JSON.stringify({ nativePluginProof: "passed", certifiedNative: nativeVersion, versionless, nativeDigest: fixture.target.native.digest, resolverDigest: fixture.target.resolver.digest, isolatedNetwork: true, ownerFileCredential: true, originalPrompts: 2, projectedPrompts: 0, preservedComponents: ["agent", "hook", "mcp", "lsp", "asset"], unrelatedProfileUpdateRequiresApproval: true, approvedUpdateAcceptedByDiscovery: true, cacheMutationRejectedByDiscovery: true, apiReads: calls.length, steps }));
  } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
});
