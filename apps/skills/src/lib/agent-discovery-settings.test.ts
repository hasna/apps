import { afterEach, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as settingsWitness from "./claude-settings-witness.js";
import { captureDiscoveryByteSources, rebindAgentDiscovery, resolveAgentDiscovery, verifyAgentDiscovery, type AgentDiscoveryBinding, type DiscoverySource, type ReviewedDiscoveryInputs } from "./agent-discovery.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";
import { parseManagedSkillPolicy, serializeManagedSkillPolicy } from "./managed-policy.js";

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture(model = "fixture-model") {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-settings-witness-")); homes.push(home);
  mkdirSync(join(home, ".claude"));
  const path = join(home, ".claude/settings.json"), dataDir = join(home, ".hasna/skills");
  writeFileSync(path, JSON.stringify({ enabledPlugins: {}, model, verbose: false }));
  const source = settingsWitness.captureClaudeSettings(path);
  const review: ReviewedDiscoveryInputs = { version: 1, agents: [{ agent: "claude", roots: [], pluginHooks: "reviewed-no-skill-injection", sources: [source] }] };
  applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: ["claude"], command: "/fixture/skills", profileId: "fleet", discoveryInputs: review }));
  const policy = parseManagedSkillPolicy(readFileSync(join(dataDir, "agent-policy.json"), "utf8"));
  return { home, path, dataDir, policy, binding: policy.bridge.discovery.claude as AgentDiscoveryBinding };
}
function change(path: string, edit: (value: any) => void) {
  const value = JSON.parse(readFileSync(path, "utf8")); edit(value); writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
const guard = (f: ReturnType<typeof fixture>) => assertManagedAgentBridge("claude", { home: f.home, dataDir: f.dataDir, profileId: "fleet", projectDir: f.home });

test("ordinary built-in model picker changes preserve hooks and every saved policy byte", () => {
  const f = fixture("sonnet"), before = readFileSync(join(f.dataDir, "agent-policy.json"));
  for (const model of ["opus", "haiku", "opus[1m]", "claude-opus-4-6", "claude-fable-5-1", "default"]) {
    change(f.path, value => { value.model = model; });
    expect(() => guard(f)).not.toThrow();
    expect(readFileSync(join(f.dataDir, "agent-policy.json"))).toEqual(before);
  }
  change(f.path, value => { delete value.model; }); expect(() => guard(f)).not.toThrow();
});

test("documented active legacy model selections also preserve the managed bridge", () => {
  const f = fixture("sonnet");
  for (const model of ["claude-opus-4-8", "claude-opus-4-8[1m]", "claude-opus-4-7", "claude-sonnet-4-6", "claude-opus-4-5-20251101", "claude-opus-4-5", "claude-haiku-4-5", "claude-fable-5-1[1m]", "claude-opus-5[1m]", "claude-opus-4-7[1m]", "claude-opus-4-6[1m]", "claude-sonnet-4-6[1m]"]) {
    change(f.path, value => { value.model = model; });
    expect(() => guard(f)).not.toThrow();
  }
});

test.each(["env", "modelOverrides", "modelSettings", "modelPicker", "availableModels", "enforceAvailableModels"])("model changes never exempt %s", key => {
  const f = fixture("sonnet");
  change(f.path, value => { value.model = "opus"; value[key] = { changed: true }; });
  expect(() => guard(f)).toThrow("NATIVE_SKILL_DRIFT");
});

test("reviewed semantic settings survive normal preferences through the actual managed bridge guard", () => {
  const f = fixture(), policyBefore = readFileSync(join(f.dataDir, "agent-policy.json"));
  change(f.path, value => { value.editorMode = "vim"; value.verbose = true; value.showTurnDuration = false; });
  expect(() => guard(f)).not.toThrow();
  expect(readFileSync(join(f.dataDir, "agent-policy.json"))).toEqual(policyBefore);
  expect(serializeManagedSkillPolicy(f.policy)).toContain('"claude-settings-v1"');
});

test.each([
  ["hook removal", (v: any) => { delete v.hooks.UserPromptSubmit; }],
  ["hook command", (v: any) => { v.hooks.UserPromptSubmit[0].hooks[0].command = "echo replacement"; }],
  ["native Skill re-enable", (v: any) => { v.disableBundledSkills = false; }],
  ["account skill sync", (v: any) => { v.syncClaudeAiSkills = true; }],
  ["hook suppression", (v: any) => { v.disableAllHooks = true; }],
  ["permissions", (v: any) => { v.permissions.allow.push("Skill(other)"); }],
  ["plugin registration", (v: any) => { v.enabledPlugins.other = true; }],
  ["marketplace", (v: any) => { v.extraKnownMarketplaces = { other: { source: { source: "directory", path: "/fixture/other" } } }; }],
  ["root override", (v: any) => { v.skillOverrides = { roots: ["/fixture/other"] }; }],
  ["execution environment", (v: any) => { v.env = { PATH: "/fixture/other" }; }],
  ["command-bearing UI", (v: any) => { v.statusLine = { type: "command", command: "echo other" }; }],
  ["unknown surface", (v: any) => { v.futurePluginInjection = { enabled: true }; }],
] as const)("semantic witness refuses %s without changing policy", (_name, edit) => {
  const f = fixture(), before = readFileSync(join(f.dataDir, "agent-policy.json"));
  change(f.path, edit);
  expect(() => guard(f)).toThrow("NATIVE_SKILL_DRIFT");
  expect(readFileSync(join(f.dataDir, "agent-policy.json"))).toEqual(before);
});

test("raw settings stay exact and require explicit reviewed conversion", () => {
  const f = fixture(), raw = captureDiscoveryByteSources([f.path])[0]!;
  const binding: AgentDiscoveryBinding = { agent: "claude", method: "reviewed", roots: [], sources: [raw] };
  change(f.path, value => { value.verbose = true; });
  expect(() => verifyAgentDiscovery(binding)).toThrow("discovery input changed");
  expect(binding.sources[0]).toEqual(raw);
  expect(() => verifyAgentDiscovery(f.binding)).not.toThrow();
});

test("semantic rebind refuses real security drift before adopting installer changes", () => {
  const f = fixture(), before = readFileSync(f.path, "utf8");
  change(f.path, value => { value.enabledPlugins.other = true; });
  expect(() => rebindAgentDiscovery(f.binding, new Map([[f.path, before]]))).toThrow("discovery input changed");
});

test("normal installation keeps full-byte write preconditions for concurrent preferences", () => {
  const f = fixture();
  const review: ReviewedDiscoveryInputs = { version: 1, agents: [{ agent: "claude", roots: [], pluginHooks: "reviewed-no-skill-injection", sources: [settingsWitness.captureClaudeSettings(f.path)] }] };
  const plan = planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"], command: "/fixture/new-skills", profileId: "fleet", discoveryInputs: review });
  change(f.path, value => { value.verbose = true; });
  const before = readFileSync(f.path), policyBefore = readFileSync(join(f.dataDir, "agent-policy.json"));
  expect(() => applyAgentIntegration(plan)).toThrow();
  expect(readFileSync(f.path)).toEqual(before);
  expect(readFileSync(join(f.dataDir, "agent-policy.json"))).toEqual(policyBefore);
});

test("typed settings mode is restricted to reviewed Claude configuration", () => {
  const f = fixture(), source = f.binding.sources.find(s => s.hashMode === "claude-settings-v1")!;
  for (const patch of [{ sha256: null }, { format: "json", fields: ["model"] }, { fields: [] }, { managedPlugins: [] }, { path: join(f.home, "other.json") }]) {
    const binding: AgentDiscoveryBinding = { agent: "claude", method: "reviewed", roots: [], sources: [{ ...source, ...patch } as DiscoverySource] };
    expect(() => verifyAgentDiscovery(binding)).toThrow();
    expect(() => parseManagedSkillPolicy(JSON.stringify({ version: 1, loading: "cli", bridge: { discovery: { claude: binding } } }))).toThrow();
  }
  for (const patch of [{ agent: "codex" as const }, { method: "automatic" as const }]) {
    const binding: AgentDiscoveryBinding = { agent: "claude", method: "reviewed", roots: [], sources: [source], ...patch };
    expect(() => verifyAgentDiscovery(binding)).toThrow();
    expect(() => rebindAgentDiscovery(binding, new Map())).toThrow();
  }
  const other = join(f.home, "other/settings.json"); mkdirSync(join(f.home, "other")); writeFileSync(other, "{}");
  const review: ReviewedDiscoveryInputs = { version: 1, agents: [{ agent: "claude", roots: [], pluginHooks: "reviewed-no-skill-injection", sources: [settingsWitness.captureClaudeSettings(other), ...captureDiscoveryByteSources([f.path])] }] };
  expect(() => resolveAgentDiscovery({ home: f.home, agent: "claude", reviewed: review })).toThrow("configuration");
});
