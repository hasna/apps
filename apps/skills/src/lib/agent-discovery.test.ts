import { afterEach, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { assertProjectDiscovery, resolveAgentDiscovery, verifyAgentDiscovery, type ReviewedDiscoveryInputs } from "./agent-discovery.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function put(path: string, text: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function fixture() { const home = mkdtempSync(join(tmpdir(), "skills-discovery-")); roots.push(home); return home; }

test("known Claude registrations resolve enabled local plugins outside the cache and bind relevant config", () => {
  const home = fixture(), plugin = join(home, "local-plugin"), settings = join(home, ".claude/settings.json");
  put(settings, JSON.stringify({ enabledPlugins: { "local@personal": true, "inactive@personal": false }, unrelated: 1 }));
  put(join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "local@personal": [{ scope: "user", installPath: plugin }] } }));
  put(join(plugin, ".claude-plugin/plugin.json"), JSON.stringify({ name: "local" }));
  put(join(plugin, "skills/review/SKILL.md"), "Fixture skill\n");
  const binding = resolveAgentDiscovery({ home, agent: "claude" });
  expect(binding.roots).toContain(join(plugin, "skills"));
  put(settings, JSON.stringify({ enabledPlugins: { "local@personal": true, "inactive@personal": false }, unrelated: 2 }));
  expect(() => verifyAgentDiscovery(binding)).not.toThrow();
  put(settings, JSON.stringify({ enabledPlugins: { "local@personal": true, "inactive@personal": true } }));
  expect(() => verifyAgentDiscovery(binding)).toThrow("discovery input changed");
});

test("Claude binds duplicate user/project plugin scopes and rejects conflicting records within one scope", () => {
  const home = fixture(), user = join(home, "user-plugin"), project = join(home, "project-plugin"), projectPath = join(home, "repo");
  put(join(home, ".claude/settings.json"), '{"enabledPlugins":{"local@personal":true}}');
  const path = join(home, ".claude/plugins/installed_plugins.json");
  const records = [{ scope: "user", installPath: user }, { scope: "project", projectPath, installPath: project }];
  for (const root of [user, project]) put(join(root, ".claude-plugin/plugin.json"), '{"name":"local"}');
  const write = (values: unknown[]) => put(path, JSON.stringify({ version: 2, plugins: { "local@personal": values } }));
  write(records);
  const binding = resolveAgentDiscovery({ home, agent: "claude" });
  expect(binding.roots).toEqual([join(project, "skills"), join(user, "skills")].sort());
  write([...records, { scope: "user", installPath: project }]);
  expect(() => resolveAgentDiscovery({ home, agent: "claude" })).toThrow("ambiguous within its scope");
  expect(() => verifyAgentDiscovery(binding)).toThrow("discovery input changed");
  write([...records, { scope: "project", projectPath, installPath: user }]);
  expect(() => resolveAgentDiscovery({ home, agent: "claude" })).toThrow("ambiguous within its scope");
  write([{ scope: "project", projectPath: "relative", installPath: project }]);
  expect(() => resolveAgentDiscovery({ home, agent: "claude" })).toThrow("absolute project path");
});

test("project native permission rules preserve independent skills while bridge denials still fail", () => {
  const home = fixture(), project = join(home, "project"), path = join(project, ".claude/settings.local.json");
  for (const rule of ["Skill(deploy)", "Skill(deploy:*)", "Skill(other-*)"]) {
    put(path, JSON.stringify({ permissions: { deny: [rule] } }));
    expect(() => assertProjectDiscovery("claude", [project], home)).not.toThrow();
  }
  for (const rule of ["Skill", "Skill(*)", "Skill(skills-cli)", "Skill(skills-*)", "Skill(skills-cli:*)"]) {
    put(path, JSON.stringify({ permissions: { deny: [rule] } }));
    expect(() => assertProjectDiscovery("claude", [project], home)).toThrow("NATIVE_SKILL_DRIFT");
  }
});

test("an unresolved enabled plugin refuses a cache-only claim and explicit reviewed sources cannot become stale", () => {
  const home = fixture(), config = join(home, ".codex/config.toml"), plugin = join(home, "runtime-plugin");
  const original = '[plugins."local@personal"]\nenabled = true\n'; put(config, original);
  put(join(plugin, ".codex-plugin/plugin.json"), '{"name":"local","skills":"./skills"}');
  mkdirSync(join(plugin, "skills"));
  expect(() => resolveAgentDiscovery({ home, agent: "codex" })).toThrow("--discovery-inputs");
  const reviewed: ReviewedDiscoveryInputs = { version: 1, agents: [{ agent: "codex", roots: [join(plugin, "skills")], pluginHooks: "reviewed-no-skill-injection", sources: [{ path: config, sha256: hash(original) }, { path: join(plugin, ".codex-plugin/plugin.json"), sha256: hash('{"name":"local","skills":"./skills"}') }] }] };
  const binding = resolveAgentDiscovery({ home, agent: "codex", reviewed });
  expect(binding.roots).toEqual([join(plugin, "skills")]);
  put(config, original + '\n[plugins."new@personal"]\nenabled = true\n');
  expect(() => verifyAgentDiscovery(binding)).toThrow("discovery input changed");
  expect(() => resolveAgentDiscovery({ home, agent: "codex", reviewed })).toThrow("discovery input changed");
});

test("plugin hook declarations require a separate review and newly added hook files invalidate coverage", () => {
  const home = fixture(), plugin = join(home, "local-plugin");
  put(join(home, ".claude/settings.json"), JSON.stringify({ enabledPlugins: { "local@personal": true } }));
  put(join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "local@personal": [{ scope: "user", installPath: plugin }] } }));
  put(join(plugin, ".claude-plugin/plugin.json"), '{"name":"local"}');
  mkdirSync(join(plugin, "skills"));
  const binding = resolveAgentDiscovery({ home, agent: "claude" });
  put(join(plugin, "hooks/hooks.json"), '{"hooks":{"SessionStart":[]}}');
  expect(() => verifyAgentDiscovery(binding)).toThrow("discovery input changed");
  expect(() => resolveAgentDiscovery({ home, agent: "claude" })).toThrow("plugin hooks");
});

test("Codex resolves local catalog paths against the marketplace root, including its home personal catalog", () => {
  const home = fixture(), market = join(home, "marketplace"), plugin = join(market, "plugins/review"), personal = join(home, "plugins/personal-review");
  put(join(home, ".codex/config.toml"), `[marketplaces."fixture"]\nsource_type = "local"\nsource = ${JSON.stringify(market)}\n[plugins."review@fixture"]\nenabled = true\n[plugins."personal-review@personal"]\nenabled = true\n`);
  for (const [root, name, path, source] of [[market, "review", "./plugins/review", plugin], [home, "personal-review", "./plugins/personal-review", personal]]) {
    put(join(root!, ".agents/plugins/marketplace.json"), JSON.stringify({ name: "fixture", plugins: [{ name, source: { source: "local", path } }] }));
    put(join(source!, ".codex-plugin/plugin.json"), JSON.stringify({ name, skills: "./skills" }));
  }
  expect(resolveAgentDiscovery({ home, agent: "codex" }).roots).toEqual([join(market, "plugins/review/skills"), join(home, "plugins/personal-review/skills")].sort());
});

test("Claude custom plugin skills are additive to defaults and root skills, while legacy command loaders refuse", () => {
  const home = fixture(), plugin = join(home, "local-plugin"), manifest = join(plugin, ".claude-plugin/plugin.json");
  put(join(home, ".claude/settings.json"), '{"enabledPlugins":{"local@personal":true}}');
  put(join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify({ plugins: { "local@personal": [{ scope: "user", installPath: plugin }] } }));
  put(manifest, '{"name":"local","skills":"./custom"}');
  put(join(plugin, "SKILL.md"), "Root skill fixture\n");
  put(join(plugin, "skills/hidden/SKILL.md"), "Default directory fixture\n");
  const binding = resolveAgentDiscovery({ home, agent: "claude" });
  expect(binding.roots).toContain(join(plugin, "skills"));
  expect(binding.roots).toContain(join(plugin, "custom"));
  expect(binding.roots).toContain(plugin);
  put(join(plugin, "commands/review.md"), "Legacy command instructions\n");
  expect(() => resolveAgentDiscovery({ home, agent: "claude" })).toThrow("legacy command");
});

test("higher-precedence project skill settings cannot evade the home discovery binding", () => {
  const home = fixture(), project = join(home, "project"), settings = join(project, ".claude/settings.local.json");
  put(settings, '{"model":"preserved","hooks":{"Stop":[]}}');
  expect(() => assertProjectDiscovery("claude", [project], home)).not.toThrow();
  put(settings, '{"enabledPlugins":{"outside@personal":true}}');
  expect(() => assertProjectDiscovery("claude", [project], home)).toThrow("higher-precedence");
  put(settings, '{"disableAllHooks":true}');
  expect(() => assertProjectDiscovery("claude", [project], home)).toThrow("higher-precedence");
  put(join(home, ".claude/settings.local.json"), '{"enabledPlugins":{"home-local@personal":true}}');
  expect(() => assertProjectDiscovery("claude", [home], home)).toThrow("higher-precedence");
});
