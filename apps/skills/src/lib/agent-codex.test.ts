import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(text?: string) {
  const home = mkdtempSync(join(tmpdir(), "skills-codex-policy-")); roots.push(home);
  const dataDir = join(home, ".hasna", "skills"), path = join(home, ".codex", "config.toml");
  mkdirSync(join(home, ".codex"), { recursive: true });
  if (text !== undefined) writeFileSync(path, text);
  return { home, dataDir, path, agents: ["codex"] as ["codex"] };
}

for (const text of [undefined, 'model = "preserved"\n', '[skills]\ninclude_instructions = true\n', '[skills.bundled]\nenabled = true # preserved comment\n', '[skills.bundled]\n# empty table\n', '[skills.bundled]\nenabled = false\n', '[[skills.config]]\npath = "/fixture/retired/SKILL.md"\nenabled = false\n']) {
  test(`hook installation disables Codex bundled reseeding (${text === undefined ? "new config" : text.split("\n")[0]})`, () => {
    const f = fixture(text), plan = planAgentIntegration(f);
    expect(existsSync(f.path)).toBe(text !== undefined);
    if (text !== undefined) expect(readFileSync(f.path, "utf8")).toBe(text);
    applyAgentIntegration(plan);
    const config = Bun.TOML.parse(readFileSync(f.path, "utf8")) as any;
    expect(config.skills.bundled.enabled).toBe(false);
    expect(config.skills.config?.some((entry: any) => entry.path?.includes("skills-cli") && !entry.enabled) ?? false).toBe(false);
    expect(readFileSync(join(f.home, ".codex", "skills", "skills-cli", "SKILL.md"), "utf8")).toContain("Skills CLI");
    expect(() => assertManagedAgentBridge("codex", { ...f, projectDir: f.home })).not.toThrow();
    expect(planAgentIntegration(f).changes).toHaveLength(0);
  });
}

test("Codex bundled policy and discovery witness are updated together, preserving unrelated TOML", () => {
  const unrelated = 'model = "preserved"\n[other]\nenabled = true\nnote = """\n[skills.bundled]\nenabled = true\n"""\n';
  const f = fixture(unrelated); applyAgentIntegration(planAgentIntegration(f));
  expect(readFileSync(f.path, "utf8")).toContain(unrelated);
  const before = Bun.TOML.parse(unrelated), after = Bun.TOML.parse(readFileSync(f.path, "utf8")) as any;
  delete after.skills; expect(after).toEqual(before);
  const policy = JSON.parse(readFileSync(join(f.dataDir, "agent-policy.json"), "utf8"));
  expect(policy.bridge.discovery.codex.sources.find((source: any) => source.path === f.path).fields).toContain("skills");
  writeFileSync(f.path, readFileSync(f.path, "utf8").replace(/enabled = false/, "enabled = true"));
  expect(() => assertManagedAgentBridge("codex", { ...f, projectDir: f.home })).toThrow("bundled skill reseeding");
  // Remove the managed setting explicitly; no known native copies are needed to detect recurrence risk.
  writeFileSync(f.path, unrelated);
  expect(() => assertManagedAgentBridge("codex", { ...f, projectDir: f.home })).toThrow("bundled skill reseeding");
  applyAgentIntegration(planAgentIntegration(f));
  expect(() => assertManagedAgentBridge("codex", { ...f, projectDir: f.home })).not.toThrow();
});

test("Codex reseeding protection leaves the CLI bridge enabled when repairing an old disabled path", () => {
  const f = fixture(), bridge = join(f.home, ".codex", "skills", "skills-cli", "SKILL.md");
  writeFileSync(f.path, `[[skills.config]]\npath = ${JSON.stringify(bridge)}\nenabled = false\n`);
  applyAgentIntegration(planAgentIntegration(f));
  const config = Bun.TOML.parse(readFileSync(f.path, "utf8")) as any;
  expect(config.skills.bundled.enabled).toBe(false);
  expect(config.skills.config).toEqual([{ path: bridge, enabled: true }]);
  expect(() => assertManagedAgentBridge("codex", { ...f, projectDir: f.home })).not.toThrow();
});

for (const text of ['skills = { config = [] }\n', 'skills.bundled.enabled = true\n', '[skills]\nbundled = {}\n', '[skills.bundled]\nenabled = "false"\n', 'skills = { bundled = { enabled = false } }\n', '"skills" = { bundled = { enabled = false } }\n', '"sk\\u0069lls" = { config = [] }\n', '"sk\\u0069lls" = { bundled = { enabled = false } }\n']) {
  test(`unsupported Codex TOML shapes refuse without partial enrollment (${text.trim()})`, () => {
    const f = fixture(text);
    const native = join(f.home, ".codex", "skills", "synthetic-copy");
    mkdirSync(native, { recursive: true }); writeFileSync(join(native, "SKILL.md"), "Synthetic native copy\n");
    expect(() => planAgentIntegration(f)).toThrow("Codex bundled skills");
    expect(readFileSync(f.path, "utf8")).toBe(text);
    expect(existsSync(join(f.dataDir, "agent-policy.json"))).toBe(false);
    expect(existsSync(join(f.home, ".codex", "skills", "skills-cli"))).toBe(false);
});
}

test("unrelated skills keys and multiline strings cannot masquerade as root skills definitions", () => {
  const text = 'note = """\n[unrelated]\nskills = {}\n"""\n[skills]\ninclude_instructions = true\n[other]\nskills = { preserved = true }\n';
  const f = fixture(text); applyAgentIntegration(planAgentIntegration(f));
  const after = Bun.TOML.parse(readFileSync(f.path, "utf8")) as any;
  expect(after.skills.bundled.enabled).toBe(false);
  expect(after.other.skills).toEqual({ preserved: true });
  expect(readFileSync(f.path, "utf8")).toContain(text);
});

for (const config of ['config = []', 'config = [{ path = "/fixture/retired/SKILL.md", enabled = false }]', '"conf\\u0069g" = []']) {
  test(`Codex refuses rewriting a noncanonical path array (${config})`, () => {
    const f = fixture(`[skills]\n${config}\n`);
    const native = join(f.home, ".codex", "skills", "synthetic-copy");
    mkdirSync(native, { recursive: true }); writeFileSync(join(native, "SKILL.md"), "Synthetic native copy\n");
    const before = readFileSync(f.path, "utf8");
    expect(() => planAgentIntegration(f)).toThrow("Codex skill path controls");
    expect(readFileSync(f.path, "utf8")).toBe(before);
    expect(existsSync(join(f.dataDir, "agent-policy.json"))).toBe(false);
    expect(existsSync(join(f.home, ".codex", "skills", "skills-cli"))).toBe(false);
  });
}

test("an empty inline path array stays intact when enrollment needs no path edits", () => {
  const f = fixture('[skills]\nconfig = []\n'); applyAgentIntegration(planAgentIntegration(f));
  const config = Bun.TOML.parse(readFileSync(f.path, "utf8")) as any;
  expect(config.skills.config).toEqual([]);
  expect(config.skills.bundled.enabled).toBe(false);
  expect(() => assertManagedAgentBridge("codex", { ...f, projectDir: f.home })).not.toThrow();
});

test("an inline array that disables the bridge refuses before enrollment even without native copies", () => {
  const f = fixture(), bridge = join(f.home, ".codex", "skills", "skills-cli", "SKILL.md");
  const text = `[skills]\nconfig = [{ path = ${JSON.stringify(bridge)}, enabled = false }]\n`;
  writeFileSync(f.path, text);
  expect(() => planAgentIntegration(f)).toThrow("Codex skill path controls");
  expect(readFileSync(f.path, "utf8")).toBe(text);
  expect(existsSync(join(f.home, ".codex", "skills", "skills-cli"))).toBe(false);
});

for (const name of ["skills-cli", " skills-cli "]) test("Codex enrollment repairs an exact bridge-name disable selector", () => {
  const f = fixture(`[[skills.config]]\nname = ${JSON.stringify(name)}\nenabled = false\n`);
  applyAgentIntegration(planAgentIntegration(f));
  const config = Bun.TOML.parse(readFileSync(f.path, "utf8")) as any;
  expect(config.skills.config).toEqual([{ name, enabled: true }]);
  expect(() => assertManagedAgentBridge("codex", { ...f, projectDir: f.home })).not.toThrow();
});

test("Codex enrollment refuses combined name and path selectors that the native client ignores", () => {
  const text = '[[skills.config]]\nname = "skills-cli"\npath = "/fixture/unrelated/SKILL.md"\nenabled = false\n', f = fixture(text);
  expect(() => planAgentIntegration(f)).toThrow("one path or name selector");
  expect(readFileSync(f.path, "utf8")).toBe(text);
  expect(existsSync(join(f.home, ".codex", "skills", "skills-cli"))).toBe(false);
});

test("a concurrent Codex config edit refuses the complete planned enrollment", () => {
  const f = fixture('model = "initial"\n'), plan = planAgentIntegration(f);
  writeFileSync(f.path, 'model = "changed"\n');
  expect(() => applyAgentIntegration(plan)).toThrow("changed");
  expect(readFileSync(f.path, "utf8")).toBe('model = "changed"\n');
  expect(existsSync(join(f.dataDir, "agent-policy.json"))).toBe(false);
  expect(existsSync(join(f.home, ".codex", "skills", "skills-cli"))).toBe(false);
});
