import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, inventoryNativeSkills, archiveNativeSkills, hookContextOutput, assertManagedAgentBridge } from "./agent-integration.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-agent-integration-")); roots.push(home);
  const dataDir = join(home, ".hasna", "skills"); mkdirSync(dataDir, { recursive: true });
  return { home, dataDir };
}
function put(path: string, body: string) { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, body); }

test("native migration covers project ancestors without duplicate archive entries", () => {
  const f = fixture(), parent = join(f.home, "workspace"), project = join(parent, "repo", "src");
  const native = join(parent, ".claude", "skills", "ancestor-copy");
  mkdirSync(project, { recursive: true }); put(join(native, "SKILL.md"), "Synthetic ancestor instructions\n");
  const inventory = inventoryNativeSkills(f.home, { projectDir: project, projectDirs: [parent, project] });
  expect(inventory.map(entry => entry.path)).toEqual([native]);
  expect(inventoryNativeSkills(f.home, { projectDir: project }).map(entry => entry.path)).toEqual([native]);
  const archived = archiveNativeSkills(inventory, { dataDir: f.dataDir, includeUnmanaged: true });
  expect(archived.entries).toHaveLength(1);
  expect(readFileSync(join(archived.entries[0]!.archive, "SKILL.md"), "utf8")).toBe("Synthetic ancestor instructions\n");
});

test("a Claude hook plan does not inspect unrelated Codex plugin roots", () => {
  const f = fixture(), codexPluginRoot = join(f.home, ".codex", "plugins", "cache", "openai-bundled", "chrome", "latest");
  mkdirSync(codexPluginRoot, { recursive: true });
  mkdirSync(join(f.home, ".codex"), { recursive: true });
  symlinkSync(codexPluginRoot, join(f.home, ".codex", "skills"), "dir");
  expect(() => planAgentIntegration({ ...f, agents: ["claude"] })).not.toThrow();
  expect(() => inventoryNativeSkills(f.home, { agents: ["claude"] })).not.toThrow();
  expect(() => inventoryNativeSkills(f.home)).toThrow("symlink");
});

test("Claude planning and guarded loading exclude another agent's populated vendor cache alias", () => {
  const f = fixture(), cache = join(f.home, ".codex", "plugins", "cache", "bundled", "browser");
  const version = join(cache, "1.0.0"), skill = join(version, "skills", "browse", "SKILL.md");
  put(skill, "Synthetic Codex vendor instructions\n");
  symlinkSync(version, join(cache, "latest"), "dir");
  const plan = planAgentIntegration({ ...f, agents: ["claude"] });
  expect(plan.nativeSkills).toEqual([]);
  applyAgentIntegration(plan);
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home })).not.toThrow();
  expect(() => inventoryNativeSkills(f.home, { includeVendor: true, agents: ["codex"] })).toThrow("symlink");
  expect(() => inventoryNativeSkills(f.home, { includeVendor: true })).toThrow("symlink");
  expect(readFileSync(skill, "utf8")).toBe("Synthetic Codex vendor instructions\n");
});

test("selected-agent inventory retains its vendor skills and excludes other vendor surfaces", () => {
  const f = fixture(), claude = join(f.home, ".claude", "plugins", "synced", "review");
  const gemini = join(f.home, ".gemini", "extensions", "extension", "skills", "search");
  put(join(claude, "SKILL.md"), "Synthetic Claude vendor instructions\n");
  put(join(gemini, "SKILL.md"), "Synthetic Gemini vendor instructions\n");
  const selected = inventoryNativeSkills(f.home, { includeVendor: true, agents: ["claude"] });
  expect(selected.map(entry => entry.path)).toEqual([claude]);
  expect(selected[0]).toMatchObject({ agent: "claude", vendor: true });
  expect(inventoryNativeSkills(f.home, { includeVendor: true }).map(entry => entry.path)).toEqual([claude, gemini]);
});

test("selected-agent inventory limits configured discovery before reading other agent settings", () => {
  const f = fixture();
  put(join(f.home, ".codex", "config.toml"), "invalid = [\n");
  expect(inventoryNativeSkills(f.home, { configured: true, agents: ["claude"] })).toEqual([]);
  expect(inventoryNativeSkills(f.home, { configured: true, includeVendor: true, agents: [] })).toEqual([]);
  expect(() => inventoryNativeSkills(f.home, { configured: true, agents: ["codex"] })).toThrow("Invalid native discovery configuration");
  expect(() => inventoryNativeSkills(f.home, { configured: true })).toThrow("Invalid native discovery configuration");
});

test("selected-agent inventory limits explicit roots while keeping selected root safety", () => {
  const f = fixture(), claude = join(f.home, "claude-extra"), codex = join(f.home, "codex-extra");
  put(join(claude, "SKILL.md"), "Synthetic selected instructions\n");
  symlinkSync(claude, codex, "dir");
  const agentRoots = [{ agent: "claude", path: claude }, { agent: "codex", path: codex }];
  expect(inventoryNativeSkills(f.home, { agents: ["claude"], agentRoots }).map(entry => entry.path)).toEqual([claude]);
  expect(() => inventoryNativeSkills(f.home, { agents: ["codex"], agentRoots })).toThrow("symlink");
  expect(() => inventoryNativeSkills(f.home, { agentRoots })).toThrow("symlink");
});

test("native drift identifies bounded escaped paths without exposing document contents", () => {
  const f = fixture(); applyAgentIntegration(planAgentIntegration({ ...f, agents: ["claude"] }));
  const projectDir = join(f.home, ...Array.from({ length: 5 }, () => "long-parent".repeat(18)));
  for (let index = 0; index < 12; index++) {
    put(join(projectDir, ".claude", "skills", `copy-${String(index).padStart(2, "0")}\ncontrol\u0085\u2028\u2029\u202e`, "SKILL.md"), "PRIVATE_DOCUMENT_MUST_NOT_APPEAR");
  }
  let reason = "";
  try { assertManagedAgentBridge("claude", { ...f, projectDir }); } catch (error) { reason = (error as Error).message; }
  expect(reason).toContain("NATIVE_SKILL_DRIFT");
  expect(reason).toContain("12 unexpected native skill copies");
  expect(reason).toContain("copy-00\\ncontrol");
  expect(reason).not.toContain("\n");
  for (const character of ["\u0085", "\u2028", "\u2029", "\u202e"]) {
    expect(reason).not.toContain(character);
    expect(reason).toContain(`\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  }
  expect(reason).not.toContain("PRIVATE_DOCUMENT_MUST_NOT_APPEAR");
  expect(reason).not.toContain("copy-11");
  expect(reason).toContain("...");
  expect(reason.length).toBeLessThanOrEqual(4096);
  expect(reason).toContain("--project");
  expect(reason).toContain("--json");
});

test("native invocation profile must match the adapter binding, including retained adapter profiles", () => {
  const f = fixture();
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["claude"], profileId: "engineering", command: "/opt/bin/skills" }));
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"], profileId: "research", command: "/opt/bin/skills" }));
  const options = { ...f, projectDir: f.home };
  expect(() => assertManagedAgentBridge("claude", { ...options, profileId: "engineering" })).not.toThrow();
  expect(() => assertManagedAgentBridge("codex", { ...options, profileId: "research" })).not.toThrow();
  expect(() => assertManagedAgentBridge("claude", { ...options, profileId: "research" })).toThrow("hook selection profile differs");
  expect(() => assertManagedAgentBridge("codex", { ...options, profileId: "retired-profile" })).toThrow("hook selection profile differs");
  // Read-only SDK callers that verify the installed bridge without invoking a profile retain their contract.
  expect(() => assertManagedAgentBridge("claude", options)).not.toThrow();
});

test("omitted reinstall options preserve the existing fleet binding and policy default", () => {
  const f = fixture();
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["claude", "codex"], command: "/opt/bin/skills", profileId: "fleet" }));
  const plan = planAgentIntegration({ ...f, agents: ["claude"] });
  expect(plan.profileId).toBe("fleet");
  expect(plan.changes).toEqual([]);
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home, profileId: "fleet" })).not.toThrow();
});

test("mixed-agent reinstalls preserve each binding, including generated plugins and supervisors", () => {
  const f = fixture();
  const agents = ["claude", "codex", "gemini", "opencode", "cursor", "hermes"] as const;
  for (const agent of agents) applyAgentIntegration(planAgentIntegration({ ...f, agents: [agent], command: `/opt/${agent}/skills`, profileId: `${agent}-profile` }));
  const plan = planAgentIntegration({ ...f, agents: [...agents] });
  expect(plan.profileId).toBe("hermes-profile");
  expect(plan.changes).toEqual([]);
  for (const agent of agents) {
    const verify = () => assertManagedAgentBridge(agent, { ...f, projectDir: f.home, profileId: `${agent}-profile` });
    // Installing unchanged Hermes hooks still requires its separate native trust.
    if (agent === "hermes") expect(verify).toThrow("approve the exact managed commands");
    else expect(verify).not.toThrow();
  }
});

test("explicit profile and command overrides independently replace only the requested binding", () => {
  const f = fixture(), policyPath = join(f.dataDir, "agent-policy.json");
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["claude", "codex"], command: "/opt/bin/skills", profileId: "fleet" }));
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["claude"], profileId: "default" }));
  let policy = JSON.parse(readFileSync(policyPath, "utf8"));
  expect(policy.bridge.commands).toEqual({ claude: "/opt/bin/skills", codex: "/opt/bin/skills" });
  expect(policy.bridge.profiles).toEqual({ claude: "default", codex: "fleet" });
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"], command: "skills" }));
  policy = JSON.parse(readFileSync(policyPath, "utf8"));
  expect(policy.bridge.commands).toEqual({ claude: "/opt/bin/skills", codex: "skills" });
  expect(policy.bridge.profiles).toEqual({ claude: "default", codex: "fleet" });
  expect(policy.profileId).toBe("default");
  for (const [agent, profileId] of [["claude", "default"], ["codex", "fleet"]] as const)
    expect(() => assertManagedAgentBridge(agent, { ...f, projectDir: f.home, profileId })).not.toThrow();
});

test("new bindings use installation defaults without resetting other agents or the policy default", () => {
  const f = fixture(), policyPath = join(f.dataDir, "agent-policy.json");
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["claude"], command: "/opt/bin/skills", profileId: "fleet" }));
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["claude", "codex"] }));
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  expect(policy.bridge.commands).toEqual({ claude: "/opt/bin/skills", codex: "skills" });
  expect(policy.bridge.profiles).toEqual({ claude: "fleet", codex: "default" });
  expect(policy.profileId).toBe("fleet");
  expect(() => assertManagedAgentBridge("codex", { ...f, projectDir: f.home, profileId: "default" })).not.toThrow();
});

test("legacy managed agents retain the global profile when per-agent profiles are absent", () => {
  const f = fixture(), policyPath = join(f.dataDir, "agent-policy.json");
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["claude"], command: "/opt/bin/skills", profileId: "fleet" }));
  const policy = JSON.parse(readFileSync(policyPath, "utf8")); delete policy.bridge.profiles;
  writeFileSync(policyPath, JSON.stringify(policy));
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["claude", "codex"] }));
  expect(JSON.parse(readFileSync(policyPath, "utf8")).bridge.profiles).toEqual({ claude: "fleet", codex: "default" });
  expect(() => assertManagedAgentBridge("claude", { ...f, projectDir: f.home, profileId: "fleet" })).not.toThrow();
});

test("a retained invalid per-agent profile refuses planning before writing hooks", () => {
  const f = fixture(), policyPath = join(f.dataDir, "agent-policy.json"), settingsPath = join(f.home, ".claude", "settings.json");
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["claude"], profileId: "fleet" }));
  const policy = JSON.parse(readFileSync(policyPath, "utf8")); policy.bridge.profiles.claude = "invalid profile";
  writeFileSync(policyPath, JSON.stringify(policy));
  const before = readFileSync(settingsPath, "utf8");
  expect(() => planAgentIntegration({ ...f, agents: ["claude"] })).toThrow("Invalid selection profile id");
  expect(readFileSync(settingsPath, "utf8")).toBe(before);
});

test("hook install plans without writes, preserves unrelated hooks and is idempotent", () => {
  const f = fixture(), path = join(f.home, ".claude", "settings.json");
  put(path, JSON.stringify({ permissions: { allow: ["Bash(git status)"], deny: ["Read(.env)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "existing-stop" }] }] } }));
  const before = readFileSync(path, "utf8");
  const plan = planAgentIntegration({ ...f, agents: ["claude", "codex"], command: "/opt/bin/skills" });
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(existsSync(join(f.home, ".codex", "hooks.json"))).toBe(false);
  const applied = applyAgentIntegration(plan);
  const config = JSON.parse(readFileSync(path, "utf8"));
  expect(config.hooks.Stop[0].hooks[0].command).toBe("existing-stop");
  expect(config.permissions.allow).toEqual(["Bash(git status)", "Skill(skills-cli)"]);
  expect(config.permissions.deny).toEqual(["Read(.env)"]);
  expect(config.hooks.UserPromptSubmit[0].hooks[0].command).toContain("hook user-prompt --agent claude");
  expect(applied.backups.length).toBe(1);
  expect(readFileSync(applied.backups[0]!, "utf8")).toBe(before);
  const again = planAgentIntegration({ ...f, agents: ["claude", "codex"], command: "/opt/bin/skills" });
  expect(again.changes).toHaveLength(0);
  expect(inventoryNativeSkills(f.home).filter(entry => entry.agent === "claude")).toMatchObject([{ bridge: true }]);
});

test("an intervening edit refuses the entire plan before writing any config", () => {
  const f = fixture(), path = join(f.home, ".claude", "settings.json"); put(path, "{}\n");
  const plan = planAgentIntegration({ ...f, agents: ["claude", "codex"] });
  writeFileSync(path, '{"userEdit":true}\n');
  expect(() => applyAgentIntegration(plan)).toThrow("changed after planning");
  expect(existsSync(join(f.home, ".codex", "hooks.json"))).toBe(false);
});

test("hook planning refuses dangling symlinks before creating their targets", () => {
  const f = fixture(), path = join(f.home, ".claude", "settings.json");
  mkdirSync(join(f.home, ".claude"));
  const target = join(f.home, "missing-config.json");
  symlinkSync(target, path);
  expect(() => planAgentIntegration({ ...f, agents: ["claude"] })).toThrow("symlink");
  expect(existsSync(target)).toBe(false);
});

test("Codex overrides disable native skills while preserving unrelated TOML and existing entries", () => {
  const f = fixture(), path = join(f.home, ".codex", "config.toml"), skill = join(f.home, ".agents", "skills", "review", "SKILL.md");
  put(skill, "---\nname: review\ndescription: Review code\n---\nReview instructions\n");
  put(path, `model = "test-model"\n\n[[skills.config]]\npath = ${JSON.stringify(skill)}\nenabled = true\n\n[mcp_servers.example]\ncommand = "example"\n`);
  const plan = planAgentIntegration({ ...f, agents: ["codex"] }); applyAgentIntegration(plan);
  const text = readFileSync(path, "utf8"), parsed = Bun.TOML.parse(text) as any;
  expect(parsed.model).toBe("test-model");
  expect(parsed.mcp_servers.example.command).toBe("example");
  expect(parsed.skills.config).toEqual([{ path: skill, enabled: false }]);
  expect(planAgentIntegration({ ...f, agents: ["codex"] }).changes).toHaveLength(0);
});

test("native migration archives exact user bytes and refuses changed plans", () => {
  const f = fixture(), skill = join(f.home, ".claude", "skills", "review");
  put(join(skill, "SKILL.md"), "Unique user instructions\n"); put(join(skill, "references", "example.txt"), "User reference\n");
  const inventory = inventoryNativeSkills(f.home);
  expect(inventory).toHaveLength(1); expect(inventory[0]!.managed).toBe(false);
  const archived = archiveNativeSkills(inventory, { dataDir: f.dataDir, includeUnmanaged: true });
  expect(existsSync(skill)).toBe(false);
  expect(readFileSync(join(archived.entries[0]!.archive, "SKILL.md"), "utf8")).toBe("Unique user instructions\n");
  expect(readFileSync(join(archived.entries[0]!.archive, "references", "example.txt"), "utf8")).toBe("User reference\n");
  put(join(skill, "SKILL.md"), "Original\n"); const stale = inventoryNativeSkills(f.home);
  writeFileSync(join(skill, "SKILL.md"), "New edit\n");
  expect(() => archiveNativeSkills(stale, { dataDir: f.dataDir, includeUnmanaged: true })).toThrow("changed after planning");
  expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toBe("New edit\n");
});

test("migration never follows symlinked content or automatically archives unowned skills", () => {
  const f = fixture(), skill = join(f.home, ".claude", "skills", "review"); put(join(skill, "SKILL.md"), "Review\n");
  let inventory = inventoryNativeSkills(f.home);
  expect(archiveNativeSkills(inventory, { dataDir: f.dataDir }).entries).toHaveLength(0);
  symlinkSync(join(f.home, ".hasna"), join(skill, "outside"));
  expect(() => inventoryNativeSkills(f.home)).toThrow("symlink");
});

test("Gemini global and project skills are inventoried and preserved without implicit ownership", () => {
  const f = fixture(), projectDir = join(f.home, "project");
  const global = join(f.home, ".gemini", "skills", "review"), project = join(projectDir, ".gemini", "skills", "project-review");
  put(join(global, "SKILL.md"), "Global Gemini instructions\n");
  put(join(global, "references", "source.txt"), "Unique reference bytes\n");
  put(join(project, "SKILL.md"), "Project Gemini instructions\n");
  const inventory = inventoryNativeSkills(f.home, { projectDir });
  expect(inventory.map(entry => ({ agent: entry.agent, path: entry.path, managed: entry.managed }))).toEqual([
    { agent: "gemini", path: global, managed: false }, { agent: "gemini", path: project, managed: false },
  ]);
  expect(archiveNativeSkills(inventory, { dataDir: f.dataDir }).entries).toHaveLength(0);
  const preserved = archiveNativeSkills(inventory, { dataDir: f.dataDir, includeUnmanaged: true });
  expect(preserved.entries).toHaveLength(2);
  expect(readFileSync(join(preserved.entries[0]!.archive, "references", "source.txt"), "utf8")).toBe("Unique reference bytes\n");
  expect(readFileSync(join(preserved.entries[1]!.archive, "SKILL.md"), "utf8")).toBe("Project Gemini instructions\n");
  expect(existsSync(global)).toBe(false); expect(existsSync(project)).toBe(false);
});

test("hook output injects selected context but cannot execute a matched skill", () => {
  expect(hookContextOutput("UserPromptSubmit", { context: "review@1.2.3\nReview this diff", receipt: {} })).toEqual({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "review@1.2.3\nReview this diff" } });
  expect(hookContextOutput("UserPromptSubmit", { context: "" })).toEqual({});
  expect(() => hookContextOutput("PostToolUse", { context: "Unexpected" })).toThrow("Unsupported");
  expect(JSON.stringify(hookContextOutput("SessionStart", { context: "" }))).toContain("Skills loading policy");
});

test("explicit vendor inventory disables cached plugin skills without moving plugin files", () => {
  const f = fixture(), skill = join(f.home, ".codex", "plugins", "cache", "market", "review-plugin", "1.0.0", "skills", "review", "SKILL.md");
  put(skill, "Vendor plugin instructions\n");
  expect(inventoryNativeSkills(f.home)).toHaveLength(0);
  const plan = planAgentIntegration({ ...f, agents: ["codex"], includeVendor: true });
  expect(plan.nativeSkills).toMatchObject([{ path: join(skill, ".."), vendor: true }]);
  applyAgentIntegration(plan);
  expect(readFileSync(join(f.home, ".codex", "config.toml"), "utf8")).toContain(JSON.stringify(skill));
  expect(archiveNativeSkills(plan.nativeSkills, { dataDir: f.dataDir, includeUnmanaged: true }).entries).toHaveLength(0);
  expect(readFileSync(skill, "utf8")).toBe("Vendor plugin instructions\n");
});
