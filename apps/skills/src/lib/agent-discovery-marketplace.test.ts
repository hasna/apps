import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureClaudeMarketplaceRegistry } from "./claude-marketplace-registry.js";
import { captureDiscoveryByteSources, rebindAgentDiscovery, resolveAgentDiscovery, verifyAgentDiscovery, type AgentDiscoveryBinding, type DiscoverySource, type ReviewedDiscoveryInputs } from "./agent-discovery.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";
import { parseManagedSkillPolicy, serializeManagedSkillPolicy } from "./managed-policy.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-marketplace-discovery-")); homes.push(home);
  const directory = join(home, ".claude/plugins"); mkdirSync(directory, { recursive: true });
  const path = join(directory, "known_marketplaces.json"), settings = join(home, ".claude/settings.json"), installed = join(directory, "installed_plugins.json"), catalog = join(directory, "catalog.json"), loader = join(directory, "loader.js");
  const registry = { fixture: { source: { source: "github", repo: "example/fixture" }, installLocation: join(directory, "marketplaces/fixture"), lastUpdated: "2026-09-18T00:00:00.000Z" } };
  writeFileSync(path, JSON.stringify(registry)); writeFileSync(settings, '{"enabledPlugins":{}}'); writeFileSync(installed, '{"version":2,"plugins":{}}'); writeFileSync(catalog, '{"plugins":[]}'); writeFileSync(loader, "// Synthetic loader fixture\n");
  const source = captureClaudeMarketplaceRegistry(path);
  const review: ReviewedDiscoveryInputs = { version: 1, agents: [{ agent: "claude", roots: [], pluginHooks: "reviewed-no-skill-injection", sources: [...captureDiscoveryByteSources([settings, installed, catalog, loader]), source] }] };
  return { home, path, settings, installed, catalog, loader, registry, source, review, binding: resolveAgentDiscovery({ home, agent: "claude", reviewed: review }) };
}
const wire = (binding: AgentDiscoveryBinding, agent = binding.agent) => JSON.stringify({ version: 1, loading: "cli", bridge: { discovery: { [agent]: binding } } });

test("explicit marketplace capture survives planning, policy serialization and the actual bridge guard", () => {
  const f = fixture(), dataDir = join(f.home, ".hasna/skills");
  const plan = planAgentIntegration({ home: f.home, dataDir, agents: ["claude"], command: "/fixture/skills", profileId: "fleet", discoveryInputs: f.review });
  applyAgentIntegration(plan);
  const policy = parseManagedSkillPolicy(readFileSync(join(dataDir, "agent-policy.json"), "utf8"));
  expect(serializeManagedSkillPolicy(policy)).toContain('"claude-marketplace-registry"');
  expect(policy.bridge.discovery.claude.sources.find((s: DiscoverySource) => s.path === f.path)).toEqual(f.source);
  f.registry.fixture.lastUpdated = "2026-09-19T01:02:03.004Z"; writeFileSync(f.path, JSON.stringify(f.registry));
  expect(() => assertManagedAgentBridge("claude", { home: f.home, dataDir, profileId: "fleet", projectDir: f.home })).not.toThrow();
  expect(rebindAgentDiscovery(policy.bridge.discovery.claude, new Map()).sources.find((s: DiscoverySource) => s.path === f.path)).toEqual(f.source);
  f.registry.fixture.source.repo = "example/changed"; writeFileSync(f.path, JSON.stringify(f.registry));
  expect(() => assertManagedAgentBridge("claude", { home: f.home, dataDir, profileId: "fleet", projectDir: f.home })).toThrow("discovery input changed");
});

test("existing raw witnesses still reject timestamp drift and are never automatically converted", () => {
  const f = fixture(), raw = captureDiscoveryByteSources([f.path])[0]!;
  const binding: AgentDiscoveryBinding = { agent: "claude", method: "reviewed", roots: [], sources: [raw] };
  f.registry.fixture.lastUpdated = "2026-09-19T00:00:00.000Z"; writeFileSync(f.path, JSON.stringify(f.registry));
  expect(() => verifyAgentDiscovery(binding)).toThrow("discovery input changed");
  expect(binding.sources[0]).toEqual(raw);
  expect(() => verifyAgentDiscovery(f.binding)).not.toThrow();
});

test.each(["settings", "installed", "catalog", "loader"] as const)("timestamp witness leaves the independent %s source guard intact", kind => {
  const f = fixture();
  writeFileSync(f[kind], kind === "loader" ? "// Changed synthetic loader\n" : '{"changed":true}');
  expect(() => verifyAgentDiscovery(f.binding)).toThrow("discovery input changed");
});

test("immediate verification and policy decoding reject incompatible typed witness metadata", () => {
  const f = fixture();
  for (const patch of [
    { sha256: null }, { format: "json", fields: ["fixture"] }, { fields: [] }, { managedPlugins: [] },
    { path: join(f.home, "installed_plugins.json") }, { path: f.path.replace("/plugins/", "/plugins/../plugins/") }, { path: join(f.home, "invalid\u0001", "known_marketplaces.json") },
  ]) {
    const invalid: AgentDiscoveryBinding = { agent: "claude", method: "reviewed", roots: [], sources: [{ ...f.source, ...patch } as DiscoverySource] };
    expect(() => verifyAgentDiscovery(invalid)).toThrow();
    expect(() => parseManagedSkillPolicy(wire(invalid))).toThrow();
  }
  for (const patch of [{ agent: "codex" as const }, { method: "automatic" as const }]) {
    const invalid: AgentDiscoveryBinding = { agent: "claude", method: "reviewed", roots: [], sources: [f.source], ...patch };
    expect(() => verifyAgentDiscovery(invalid)).toThrow("explicit reviewed Claude");
    expect(() => rebindAgentDiscovery(invalid, new Map())).toThrow("explicit reviewed Claude");
    expect(() => parseManagedSkillPolicy(wire(invalid))).toThrow();
  }
  expect(() => parseManagedSkillPolicy(wire({ agent: "claude", method: "reviewed", roots: [], sources: [f.source] }, "codex"))).toThrow();
});

test("rebind cannot synthesize marketplace contents during hook installation", () => {
  const f = fixture(), before = readFileSync(f.path);
  expect(() => rebindAgentDiscovery(f.binding, new Map([[f.path, before.toString()]]))).toThrow("without synthetic changes");
  expect(readFileSync(f.path)).toEqual(before);
});

test("rebind refuses a real registration change instead of silently adopting its digest", () => {
  const f = fixture();
  f.registry.fixture.source.repo = "example/concurrent-change"; writeFileSync(f.path, JSON.stringify(f.registry));
  expect(() => rebindAgentDiscovery(f.binding, new Map())).toThrow("discovery input changed");
});

test("unknown row fields remain guarded even when an update timestamp also changes", () => {
  const f = fixture(), row = { ...f.registry.fixture, autoUpdate: false }; writeFileSync(f.path, JSON.stringify({ fixture: row }));
  const binding: AgentDiscoveryBinding = { agent: "claude", method: "reviewed", roots: [], sources: [captureClaudeMarketplaceRegistry(f.path)] };
  row.lastUpdated = "2026-09-19T00:00:00.000Z"; writeFileSync(f.path, JSON.stringify({ fixture: row }));
  expect(() => verifyAgentDiscovery(binding)).toThrow("discovery input changed");
  expect(() => verifyAgentDiscovery(f.binding)).toThrow("discovery input changed");
});
