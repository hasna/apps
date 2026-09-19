import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAgentIntegration, planAgentIntegration } from "./agent-integration.js";
import { createHash } from "node:crypto";
import { enrollCodexNativeHooks, reconcileCodexNativeHooks } from "./agent-codex-trust.js";

const roots: string[] = [];
const initialPath = process.env.PATH;
afterEach(() => { process.env.PATH = initialPath; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hash = `sha256:${"a".repeat(64)}`;
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-native-trust-")); roots.push(home);
  const dataDir = join(home, ".hasna/skills"), root = join(home, ".codex"), command = join(home, "bin/skills");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const packageDir = join(home, "package"), cli = join(packageDir, "bin/index.js");
  mkdirSync(join(packageDir, "bin"), { recursive: true, mode: 0o700 }); mkdirSync(join(home, "bin"), { mode: 0o700 });
  writeFileSync(cli, "#!/usr/bin/env bun\n// Synthetic published CLI fixture\n", { mode: 0o700 });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.8.9", bin: { skills: "bin/index.js" } }), { mode: 0o600 });
  symlinkSync(cli, command); process.env.PATH = join(home, "bin") + ":" + initialPath;
  const reviewedSkillsCli = { path: command, version: "0.8.9", sha256: createHash("sha256").update(readFileSync(cli)).digest("hex") };
  const configPath = join(root, "config.toml"), hooksPath = join(root, "hooks.json");
  writeFileSync(configPath, '# preserve this comment\nmodel = "synthetic"\n', { mode: 0o600 });
  applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: ["codex"], command, profileId: "synthetic" }));
  const hooks = JSON.parse(readFileSync(hooksPath, "utf8"));
  const names = { UserPromptSubmit: "user_prompt_submit", SessionStart: "session_start", SubagentStart: "subagent_start" };
  const events = { UserPromptSubmit: "userPromptSubmit", SessionStart: "sessionStart", SubagentStart: "subagentStart" };
  const entries = Object.entries(hooks.hooks).map(([event, groups]: [string, any]) => ({ key: `${hooksPath}:${names[event as keyof typeof names]}:0:0`, eventName: events[event as keyof typeof events], handlerType: "command", command: groups[0].hooks[0].command, async: false, matcher: null, timeoutSec: 15, statusMessage: null, additionalContextLimit: null, sourcePath: hooksPath, source: "user", pluginId: null, displayOrder: 0, enabled: false, isManaged: false, currentHash: hash, trustStatus: "trusted" }));
  const before = readFileSync(configPath, "utf8") + '\n[hooks.state."unrelated"]\nenabled = false # preserve unrelated\ntrusted_hash = "sha256:unrelated"\n' + entries.map(h => `\n[hooks.state.${JSON.stringify(h.key)}]\nenabled = false # preserve managed comment\ntrusted_hash = ${JSON.stringify(hash)}\n`).join("");
  writeFileSync(configPath, before); chmodSync(configPath, 0o600);
  const calls: Array<{ method: string; params: any }> = [];
  let mode = "success", closed = false;
  const connect = async () => ({
    version: "codex-cli 0.154.0",
    async request(method: string, params: any) {
      calls.push({ method, params });
      if (method === "hooks/list") {
        const items = structuredClone(entries);
        if (mode === "modified" && !items[0]!.enabled) items[0]!.trustStatus = "modified";
        if (mode === "missing") items.pop();
        if (mode === "unknownTrust") items[0]!.trustStatus = "new-native-status";
        if (mode === "changedHash") items[0]!.currentHash = `sha256:${"c".repeat(64)}`;
        if (mode === "duplicateCommand") items.push({ ...items[0], key: "unmanaged-duplicate" });
        if (mode === "duplicate") items.push(items[0]!);
        if (mode === "changedCommand") items[0]!.command += " --changed";
        return { data: [{ cwd: home, hooks: items, warnings: [], errors: [] }] };
      }
      if (method === "config/read") {
        const config = Bun.TOML.parse(readFileSync(configPath, "utf8"));
        const layer = { name: { type: "user", file: configPath }, version: `sha256:${"b".repeat(64)}`, config };
        if (mode === "override") return { config, layers: [{ name: { type: "sessionFlags" }, config: { hooks: { state: {} } } }, layer] };
        if (mode === "disabled") return { config: { features: { hooks: false } }, layers: [layer] };
        return { config, layers: [layer] };
      }
      if (method === "config/batchWrite") {
        if (mode === "writeOverride") return { status: "okOverridden", filePath: configPath };
        if (mode === "conflict") throw new Error("Native response may contain sensitive configuration");
        expect(params.expectedVersion).toBe(`sha256:${"b".repeat(64)}`); expect(params.filePath).toBe(configPath); expect(params.reloadUserConfig).toBe(true);
        expect(params.edits).toEqual([{ keyPath: "hooks.state", mergeStrategy: "upsert", value: Object.fromEntries(entries.map(h => [h.key, { enabled: true, trusted_hash: hash }])) }]);
        writeFileSync(configPath, readFileSync(configPath, "utf8").replaceAll("enabled = false # preserve managed comment", "enabled = true # preserve managed comment"));
        if (mode === "reorder") {
          const text = readFileSync(configPath, "utf8"), bundled = text.indexOf("[skills.bundled]");
          const block = text.slice(bundled).trim();
          const without = text.slice(0, bundled).trimEnd();
          writeFileSync(configPath, without + "\n\n" + block + "\n");
        }
        if (mode === "array") writeFileSync(configPath, readFileSync(configPath, "utf8") + "\n[[fruits]]\nname = \"apple\"\n[[fruits]]\nname = \"pear\"\n");
        if (mode === "nested") writeFileSync(configPath, readFileSync(configPath, "utf8") + "\n[parent]\nvalue = \"one\"\n[parent.child]\nvalue = \"two\"\n");
        for (const entry of entries) entry.enabled = true;
        return { status: "ok", filePath: configPath, version: `sha256:${"d".repeat(64)}` };
      }
      throw new Error("Unexpected synthetic RPC");
    },
    async close() { closed = true; },
  });
  return { home, dataDir, reviewedSkillsCli, cli, command, configPath, hooksPath, entries, before, calls, connect, setMode: (value: string) => { mode = value; }, isClosed: () => closed };
}

test("native trust dry run identifies disabled exact owned hooks without writing", async () => {
  const f = fixture(); const result = await enrollCodexNativeHooks(f, f.connect);
  expect(result.applied).toBe(false); expect(result.planned).toHaveLength(3); expect(result.existingSessionsReloaded).toBe(false);
  expect(f.calls.some(c => c.method === "config/batchWrite")).toBe(false); expect(readFileSync(f.configPath, "utf8")).toBe(f.before); expect(f.isClosed()).toBe(true);
});
test("native trust accepts Codex table reordering while preserving unrelated config", async () => {
  const f = fixture(); f.setMode("reorder"); const plan = await enrollCodexNativeHooks(f, f.connect);
  const result = await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect);
  expect(result.applied).toBe(true); expect(result.nativeEligible).toBe(true);
  expect(readFileSync(f.configPath, "utf8")).toContain("preserve unrelated");
});
test("native CAS enrollment preserves other trust/comments and becomes idempotent", async () => {
  const f = fixture(); const plan = await enrollCodexNativeHooks(f, f.connect); const result = await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect);
  expect(result.applied).toBe(true); expect(result.nativeEligible).toBe(true); expect(result.existingSessionsReloaded).toBe(false);
  expect(readFileSync(f.configPath, "utf8")).toContain('enabled = false # preserve unrelated');
  expect(readFileSync(f.configPath, "utf8")).toContain('# preserve this comment');
  expect((await enrollCodexNativeHooks(f, f.connect)).planned).toHaveLength(0);
});
for (const layout of ["array", "nested"]) test(`native trust fails closed for ${layout} table layouts`, async () => {
  const f = fixture(); f.setMode(layout); const plan = await enrollCodexNativeHooks(f, f.connect);
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST");
});
for (const [mode, error] of Object.entries({ duplicate: "AMBIGUOUS_IDENTITY", duplicateCommand: "AMBIGUOUS_IDENTITY", changedCommand: "NATIVE_IDENTITY_CHANGED", missing: "AMBIGUOUS_IDENTITY", unknownTrust: "UNKNOWN_TRUST_STATUS", override: "NATIVE_CONFIG_OVERRIDDEN", disabled: "NATIVE_HOOKS_DISABLED" })) test(`refuses ${mode} native identities before write`, async () => {
  const f = fixture(); f.setMode(mode);
  await expect(enrollCodexNativeHooks(f, f.connect)).rejects.toThrow(`CODEX_HOOK_TRUST_${error}`);
  expect(f.calls.some(c => c.method === "config/batchWrite")).toBe(false); expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});
test("native errors never expose configuration-bearing responses", async () => {
  const f = fixture(); const plan = await enrollCodexNativeHooks(f, f.connect); f.setMode("conflict");
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_NATIVE_WRITE_FAILED");
  expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});


test("reviewed modified managed hooks enroll with their current native hashes", async () => {
  const f = fixture(); f.setMode("modified");
  const plan = await enrollCodexNativeHooks(f, f.connect);
  expect(plan.planned[0]!.trustStatus).toBe("modified");
  expect((await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect)).nativeEligible).toBe(true);
});
for (const drift of ["changedHash", "config", "cli", "digest"]) test(`reviewed plan refuses ${drift} drift before write`, async () => {
  const f = fixture(); const plan = await enrollCodexNativeHooks(f, f.connect);
  if (drift === "changedHash") f.setMode(drift);
  if (drift === "config") writeFileSync(f.configPath, f.before + "\n# concurrent edit\n");
  if (drift === "cli") writeFileSync(f.cli, readFileSync(f.cli, "utf8") + "// changed CLI\n");
  const before = readFileSync(f.configPath, "utf8");
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: drift === "digest" ? "0".repeat(64) : plan.planDigest }, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST");
  expect(f.calls.some(c => c.method === "config/batchWrite")).toBe(false); expect(readFileSync(f.configPath, "utf8")).toBe(before);
});
test("native override status stops and leaves an incomplete reconciliation journal", async () => {
  const f = fixture(); const plan = await enrollCodexNativeHooks(f, f.connect); f.setMode("writeOverride");
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect)).rejects.toThrow("NATIVE_WRITE_OVERRIDDEN");
  f.setMode("success");
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect)).rejects.toThrow("RECONCILE_REQUIRED");
  expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});

test("native reconciliation resolves an effective partial write only after native readback", async () => {
  const f = fixture(), plan = await enrollCodexNativeHooks(f, f.connect), journal = join(f.dataDir, "native-hook-trust", "11111111-1111-4111-8111-111111111111");
  mkdirSync(journal, { recursive: true, mode: 0o700 });
  const policyPath = join(f.dataDir, "agent-policy.json"), hooksText = readFileSync(f.hooksPath), policyText = readFileSync(policyPath);
  writeFileSync(join(journal, "config.before.toml"), f.before, { mode: 0o600 }); writeFileSync(join(journal, "hooks.before.json"), hooksText, { mode: 0o600 }); writeFileSync(join(journal, "policy.before.json"), policyText, { mode: 0o600 });
  writeFileSync(join(journal, "stopped.json"), JSON.stringify({ error: "CODEX_HOOK_TRUST_PRESERVATION_FAILED", automaticRollback: false, reconcileBeforeRetry: true }) + "\n", { mode: 0o600 });
  const configAfter = f.before.replaceAll("enabled = false # preserve managed comment", "enabled = true # preserve managed comment"); writeFileSync(f.configPath, configAfter, { mode: 0o600 }); f.entries.forEach(entry => { entry.enabled = true; });
  writeFileSync(join(journal, "intent.json"), JSON.stringify({ version: 1, planDigest: plan.planDigest, skillsCli: plan.skillsCli, nativeVersion: "codex-cli 0.154.0", configPath: f.configPath, beforeSha256: createHash("sha256").update(f.before).digest("hex"), hooksSha256: createHash("sha256").update(hooksText).digest("hex"), policySha256: createHash("sha256").update(policyText).digest("hex"), expectedVersion: `sha256:${"b".repeat(64)}`, hooks: plan.planned }) + "\n", { mode: 0o600 });
  const receipt = await reconcileCodexNativeHooks({ home: f.home, dataDir: f.dataDir, codexCommand: "codex", journal, reviewedSkillsCli: f.reviewedSkillsCli }, f.connect);
  expect(receipt.reconciled).toBe(true); expect(JSON.parse(readFileSync(join(journal, "receipt.json"), "utf8")).nativeExecutionVerified).toBe(true); expect(f.calls.some(call => call.method === "config/batchWrite")).toBe(false);
});

test("native reconciliation refuses unrelated effective configuration drift", async () => {
  const f = fixture(), plan = await enrollCodexNativeHooks(f, f.connect), journal = join(f.dataDir, "native-hook-trust", "22222222-2222-4222-8222-222222222222");
  mkdirSync(journal, { recursive: true, mode: 0o700 }); const policyPath = join(f.dataDir, "agent-policy.json"), hooksText = readFileSync(f.hooksPath), policyText = readFileSync(policyPath);
  writeFileSync(join(journal, "config.before.toml"), f.before, { mode: 0o600 }); writeFileSync(join(journal, "hooks.before.json"), hooksText, { mode: 0o600 }); writeFileSync(join(journal, "policy.before.json"), policyText, { mode: 0o600 }); writeFileSync(join(journal, "stopped.json"), "{}\n", { mode: 0o600 });
  writeFileSync(join(journal, "intent.json"), JSON.stringify({ version: 1, planDigest: plan.planDigest, skillsCli: plan.skillsCli, nativeVersion: "codex-cli 0.154.0", configPath: f.configPath, beforeSha256: createHash("sha256").update(f.before).digest("hex"), hooksSha256: createHash("sha256").update(hooksText).digest("hex"), policySha256: createHash("sha256").update(policyText).digest("hex"), hooks: plan.planned }) + "\n", { mode: 0o600 });
  writeFileSync(f.configPath, f.before + "\nmodel_provider = \"drift\"\n", { mode: 0o600 });
  await expect(reconcileCodexNativeHooks({ home: f.home, dataDir: f.dataDir, journal, reviewedSkillsCli: f.reviewedSkillsCli }, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_");
  expect(readFileSync(join(journal, "receipt.json"), { encoding: "utf8", flag: "a+" })).toBe("");
});

for (const profile of ["synthetic; true #", "../synthetic", "synthetic\ntrue", ""]) test(`coherent policy and declaration profile tampering refuses ${JSON.stringify(profile)}`, async () => {
  const f = fixture(), policyPath = join(f.dataDir, "agent-policy.json"), policy = JSON.parse(readFileSync(policyPath, "utf8"));
  policy.bridge.profiles.codex = profile; writeFileSync(policyPath, JSON.stringify(policy));
  const hooks = JSON.parse(readFileSync(f.hooksPath, "utf8"));
  for (const groups of Object.values(hooks.hooks) as any[]) groups[0].hooks[0].command = groups[0].hooks[0].command.replace("--selection-profile synthetic", "--selection-profile " + profile);
  writeFileSync(f.hooksPath, JSON.stringify(hooks));
  await expect(enrollCodexNativeHooks(f, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_REFUSED");
  expect(f.calls).toHaveLength(0); expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});

test("native discovery changed after planning refuses immediately before write", async () => {
  const f = fixture(); const plan = await enrollCodexNativeHooks(f, f.connect);
  const racing = async () => {
    const rpc = await f.connect(); return { ...rpc, async request(method: string, params: any) {
      const result = await rpc.request(method, params); if (method === "config/read") f.setMode("changedHash"); return result;
    } };
  };
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, racing)).rejects.toThrow("NATIVE_DISCOVERY_CHANGED");
  expect(f.calls.some(c => c.method === "config/batchWrite")).toBe(false); expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});
test("an unverified native release refuses before discovery", async () => {
  const f = fixture();
  await expect(enrollCodexNativeHooks(f, async () => ({ ...await f.connect(), version: "codex-cli 0.999.0" }))).rejects.toThrow("NATIVE_UNSUPPORTED_VERSION");
  expect(f.calls).toHaveLength(0); expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});


test("read-only package witnesses admit stable Bun cache hardlinks", async () => {
  const f = fixture();
  linkSync(f.cli, join(f.home, "cached-cli.js"));
  linkSync(join(f.home, "package/package.json"), join(f.home, "cached-package.json"));
  const plan = await enrollCodexNativeHooks(f, f.connect);
  expect((await enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, f.connect)).nativeEligible).toBe(true);
});
for (const kind of ["cli", "manifest"]) for (const drift of ["bytes", "link count"]) test(`changed hardlinked ${kind} ${drift} refuses before native write`, async () => {
  const f = fixture(), source = kind === "cli" ? f.cli : join(f.home, "package/package.json"), cached = join(f.home, "cached-package-file");
  linkSync(source, cached);
  const plan = await enrollCodexNativeHooks(f, f.connect);
  const racing = async () => {
    const rpc = await f.connect(); return { ...rpc, async request(method: string, params: any) {
      const result = await rpc.request(method, params);
      if (method === "config/read") {
        if (drift === "bytes") writeFileSync(cached, readFileSync(cached, "utf8") + "\n");
        else linkSync(cached, join(f.home, "another-package-link"));
      }
      return result;
    } };
  };
  await expect(enrollCodexNativeHooks({ ...f, apply: true, reviewedPlanDigest: plan.planDigest }, racing)).rejects.toThrow("CODEX_HOOK_TRUST_INPUT_CHANGED");
  expect(f.calls.some(c => c.method === "config/batchWrite")).toBe(false); expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});
for (const kind of ["config", "hooks", "policy"]) test(`hardlinked ${kind} remains refused before native discovery`, async () => {
  const f = fixture(), source = kind === "config" ? f.configPath : kind === "hooks" ? f.hooksPath : join(f.dataDir, "agent-policy.json");
  linkSync(source, join(f.home, "linked-private-file"));
  await expect(enrollCodexNativeHooks(f, f.connect)).rejects.toThrow("CODEX_HOOK_TRUST_UNSAFE_FILE");
  expect(f.calls).toHaveLength(0); expect(readFileSync(f.configPath, "utf8")).toBe(f.before);
});
