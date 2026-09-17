import { afterEach, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { captureDiscoveryDirectories, resolveAgentDiscovery, verifyAgentDiscovery } from "./agent-discovery.js";
import { verifyDiscoveryDirectories } from "./agent-discovery-directories.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";
import { hermesHookDefinitions } from "./agent-hermes.js";
import { parseManagedSkillPolicy } from "./managed-policy.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function put(path: string, text: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function fixture() { const home = mkdtempSync(join(tmpdir(), "skills-directory-review-")); roots.push(home); return home; }

test("reviewed discovery refuses a new plugin without changes to its known source files", () => {
  const home = fixture(), config = join(home, ".codex/config.toml"), plugins = join(home, "plugins");
  put(config, ""); put(join(plugins, "reviewed/plugin.json"), "{}");
  const reviewed = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], pluginHooks: "reviewed-no-skill-injection" as const,
    sources: [{ path: config, sha256: hash("") }, { path: join(plugins, "reviewed/plugin.json"), sha256: hash("{}") }],
    directories: [{ path: plugins, sha256: hash('["reviewed","directory"]\n["reviewed/plugin.json","file"]\n') }],
  }] };
  const binding = resolveAgentDiscovery({ home, agent: "codex", reviewed });
  expect(() => verifyAgentDiscovery(binding)).not.toThrow();
  put(join(plugins, "new/plugin.json"), "{}");
  expect(() => verifyAgentDiscovery(binding)).toThrow("directory membership changed");
});

test("reviewed discovery refuses a new entrypoint file in an existing distribution", () => {
  const home = fixture(), packages = join(home, "site-packages"), config = join(home, ".codex/config.toml");
  put(config, ""); put(join(packages, "fixture.dist-info/METADATA"), "Name: fixture\n");
  const binding = resolveAgentDiscovery({ home, agent: "codex", reviewed: { version: 1, agents: [{ agent: "codex", roots: [], pluginHooks: "reviewed-no-skill-injection",
    sources: [{ path: config, sha256: hash("") }],
    directories: [{ path: packages, sha256: hash('["fixture.dist-info","directory"]\n["fixture.dist-info/METADATA","file"]\n') }],
  }] } });
  expect(() => verifyAgentDiscovery(binding)).not.toThrow();
  put(join(packages, "fixture.dist-info/entry_points.txt"), "[hermes_agent.plugins]\nfixture = fixture:register\n");
  expect(() => verifyAgentDiscovery(binding)).toThrow("directory membership changed");
});

test("automatic absent Hermes runtime roots remain absent on every guard", () => {
  const home = fixture(), binding = resolveAgentDiscovery({ home, agent: "hermes" });
  expect(() => verifyAgentDiscovery(binding)).not.toThrow();
  put(join(home, ".hermes/plugins/new/plugin.yaml"), "name: new\n");
  expect(() => verifyAgentDiscovery(binding)).toThrow("directory membership changed");
});

test("Hermes explicit source review requires directory membership coverage", () => {
  const home = fixture(), config = join(home, ".hermes/config.yaml"); put(config, "{}");
  expect(() => resolveAgentDiscovery({ home, agent: "hermes", reviewed: { version: 1, agents: [{ agent: "hermes", roots: [], pluginHooks: "reviewed-no-skill-injection", sources: [{ path: config, sha256: hash("{}") }] }] } })).toThrow("directory membership");
});

test("membership covers absent roots, hidden files, nested packages and file type changes", () => {
  const home = fixture(), root = join(home, "plugins");
  const absent = captureDiscoveryDirectories([root]); expect(absent).toEqual([{ path: root, sha256: null }]);
  mkdirSync(root); expect(() => verifyDiscoveryDirectories(absent)).toThrow("directory membership changed");
  const empty = captureDiscoveryDirectories([root]); expect(empty[0]!.sha256).toBe(hash(""));
  put(join(root, ".hidden/node_modules/entry.js"), "fixture");
  expect(() => verifyDiscoveryDirectories(empty)).toThrow("directory membership changed");
  const populated = captureDiscoveryDirectories([root]);
  rmSync(join(root, ".hidden/node_modules/entry.js")); mkdirSync(join(root, ".hidden/node_modules/entry.js"));
  expect(() => verifyDiscoveryDirectories(populated)).toThrow("directory membership changed");
});

test("source bytes stay independently bound when directory membership is unchanged", () => {
  const home = fixture(), config = join(home, ".codex/config.toml"), root = join(home, "plugins"), source = join(root, "hook.js");
  put(config, ""); put(source, "reviewed"); const directories = captureDiscoveryDirectories([root]);
  const binding = resolveAgentDiscovery({ home, agent: "codex", reviewed: { version: 1, agents: [{ agent: "codex", roots: [], sources: [{ path: config, sha256: hash("") }, { path: source, sha256: hash("reviewed") }], directories, pluginHooks: "reviewed-no-skill-injection" }] } });
  put(source, "different"); expect(() => verifyDiscoveryDirectories(directories)).not.toThrow();
  expect(() => verifyAgentDiscovery(binding)).toThrow("discovery input changed");
});

test("membership refuses symlink roots, symlink members, regular roots and FIFOs without opening them", () => {
  const home = fixture(), root = join(home, "plugins"), link = join(home, "link"); mkdirSync(root);
  symlinkSync(root, link); expect(() => captureDiscoveryDirectories([link])).toThrow("symlink");
  symlinkSync(join(home, "missing"), join(root, "symlink")); expect(() => captureDiscoveryDirectories([root])).toThrow("symlink or special");
  rmSync(join(root, "symlink")); put(join(root, "file"), "fixture"); expect(() => captureDiscoveryDirectories([join(root, "file")])).toThrow("Unsupported");
  const fifo = join(root, "fifo"); expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
  expect(() => captureDiscoveryDirectories([root])).toThrow("symlink or special");
});

test("directory collection and recursion limits refuse before unbounded work", () => {
  const home = fixture();
  expect(() => captureDiscoveryDirectories(Array.from({ length: 65 }, (_, i) => join(home, String(i))))).toThrow("collection");
  expect(() => captureDiscoveryDirectories([home, home])).toThrow("collection");
  let path = home; for (let i = 0; i < 65; i++) { path = join(path, "nested"); mkdirSync(path); }
  expect(() => captureDiscoveryDirectories([home])).toThrow("depth limit");
  expect(() => verifyDiscoveryDirectories([{ path: home, sha256: "invalid" }])).toThrow("digest");
});

test("entry and metadata budgets bound real directory listings across all roots", () => {
  const home = fixture(), first = join(home, "first"), second = join(home, "second"); mkdirSync(first); mkdirSync(second);
  for (let i = 0; i < 20000; i++) writeFileSync(join(first, String(i)), "");
  expect(() => captureDiscoveryDirectories([first])).not.toThrow();
  writeFileSync(join(second, "extra"), "");
  expect(() => captureDiscoveryDirectories([first, second])).toThrow("entry limit");
  // Exceed the aggregate metadata budget without exceeding macOS' path limit.
  const metadata = join(home, "metadata"), component = "n".repeat(200), deep = join(metadata, component, component);
  const fileCount = 18_000, prefix = "a".repeat(100);
  expect(fileCount + 2).toBeLessThan(20_000);
  expect(fileCount * Buffer.byteLength(JSON.stringify([`${component}/${component}/${prefix}0`, "file"]) + "\n")).toBeGreaterThan(8 * 1024 * 1024);
  mkdirSync(deep, { recursive: true });
  for (let i = 0; i < fileCount; i++) writeFileSync(join(deep, `${prefix}${i}`), "");
  expect(() => captureDiscoveryDirectories([metadata])).toThrow("metadata limit");
});

test("retained policy directory witnesses use the same collection and digest bounds", () => {
  const directory = { path: "/fixture/plugins", sha256: null }, policy = (directories: unknown) => JSON.stringify({ loading: "cli", bridge: { discovery: { codex: { agent: "codex", roots: [], sources: [], directories } } } });
  expect(() => parseManagedSkillPolicy(policy(Array(64).fill(directory)))).not.toThrow();
  expect(() => parseManagedSkillPolicy(policy(Array(65).fill(directory)))).toThrow("collection bounds");
  expect(() => parseManagedSkillPolicy(policy([{ ...directory, sha256: "invalid" }]))).toThrow("collection bounds");
});

test("an added native discovery member invalidates an approved plan before bridge writes", () => {
  const home = fixture(), dataDir = join(home, ".hasna/skills"); mkdirSync(dataDir, { recursive: true });
  const plan = planAgentIntegration({ home, dataDir, agents: ["hermes"], command: "/fixture/skills" });
  put(join(home, ".hermes/plugins/new/plugin.yaml"), "name: new\n");
  expect(() => applyAgentIntegration(plan)).toThrow("directory membership changed");
  expect(captureDiscoveryDirectories([join(home, ".hermes/skills")])[0]!.sha256).toBeNull();
});

test("normal hook installation upgrades a 0.7.1 Hermes policy without manual policy repair", () => {
  const home = fixture(), dataDir = join(home, ".hasna/skills"), options = { home, dataDir, agents: ["hermes" as const], command: "/fixture/skills", profileId: "engineering" };
  mkdirSync(dataDir, { recursive: true }); applyAgentIntegration(planAgentIntegration(options));
  const approvals = Object.entries(hermesHookDefinitions({ runtime: process.execPath, path: join(dataDir, "agent-hooks/hermes.js") })).map(([event, hook]) => ({ event, command: hook.command }));
  put(join(home, ".hermes/shell-hooks-allowlist.json"), JSON.stringify({ approvals }));
  const policyPath = join(dataDir, "agent-policy.json"), legacy = JSON.parse(readFileSync(policyPath, "utf8"));
  // Version 0.7.1 stored the same automatic binding without directory witnesses.
  delete legacy.bridge.discovery.hermes.directories; put(policyPath, JSON.stringify(legacy));
  const guard = () => assertManagedAgentBridge("hermes", { home, dataDir, projectDir: home });
  expect(guard).toThrow("directory membership");
  const upgrade = planAgentIntegration(options);
  expect(upgrade.changes.map(change => change.path)).toEqual([policyPath]);
  expect(upgrade.discoveryAfter?.[0]?.directories).toHaveLength(2);
  applyAgentIntegration(upgrade);
  expect(guard).not.toThrow();
  expect(JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.hermes.directories).toHaveLength(2);
  expect(readFileSync(join(home, ".hermes/shell-hooks-allowlist.json"), "utf8")).toBe(JSON.stringify({ approvals }));
});

test("post-write membership drift restores owned bridge changes and preserves the new external plugin", () => {
  const home = fixture(), dataDir = join(home, ".hasna/skills"), config = join(home, ".hermes/config.yaml");
  mkdirSync(dataDir, { recursive: true }); put(config, "model: original\n");
  const plan = planAgentIntegration({ home, dataDir, agents: ["hermes"], command: "/fixture/skills" }), after = plan.discoveryAfter;
  const bridge = join(home, ".hermes/skills/skills-cli/SKILL.md"), added = join(home, ".hermes/plugins/new/plugin.yaml");
  Object.defineProperty(plan, "discoveryAfter", { get() { expect(existsSync(bridge)).toBe(true); put(added, "name: new\n"); return after; } });
  expect(() => applyAgentIntegration(plan)).toThrow("directory membership changed");
  expect(readFileSync(added, "utf8")).toBe("name: new\n");
  expect(readFileSync(config, "utf8")).toBe("model: original\n");
  expect(existsSync(bridge)).toBe(false);
  expect(existsSync(join(dataDir, "agent-policy.json"))).toBe(false);
});
