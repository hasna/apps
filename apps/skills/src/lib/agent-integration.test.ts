import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, inventoryNativeSkills, archiveNativeSkills, hookContextOutput } from "./agent-integration.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-agent-integration-")); roots.push(home);
  const dataDir = join(home, ".hasna", "skills"); mkdirSync(dataDir, { recursive: true });
  return { home, dataDir };
}
function put(path: string, body: string) { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, body); }

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
  expect(config.permissions.allow).toEqual(["Bash(git status)"]);
  expect(config.permissions.deny).toEqual(["Read(.env)", "Skill"]);
  expect(config.hooks.UserPromptSubmit[0].hooks[0].command).toContain("hook user-prompt --agent claude");
  expect(applied.backups.length).toBe(1);
  expect(readFileSync(applied.backups[0]!, "utf8")).toBe(before);
  const again = planAgentIntegration({ ...f, agents: ["claude", "codex"], command: "/opt/bin/skills" });
  expect(again.changes).toHaveLength(0);
  expect(existsSync(join(f.home, ".claude", "skills"))).toBe(false);
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
