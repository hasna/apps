import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitPlugin, planPluginAdmission, type PluginAdmissionReceipt } from "./plugin-admission.js";
import { pluginFixture, putSynthetic } from "./plugin-admission.test-fixtures.js";
import { captureManagedPluginRegistry } from "./plugin-discovery.js";
import { assertProjectDiscovery, captureDiscoveryByteSources, verifyAgentDiscovery, type AgentDiscoveryBinding } from "./agent-discovery.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skills-plugin-registry-")); roots.push(root);
  const f = pluginFixture(root), registry = join(root, ".claude/plugins/installed_plugins.json");
  f.target.registrations.push({ scope: "project", projectPath: join(root, "project") });
  async function admit() { const plan = await planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, f.options); return admitPlugin("synthetic-integration", "synthetic-profile", f.target, plan.planDigest, f.options); }
  let current: PluginAdmissionReceipt = await admit(); const previous: string[] = [];
  let document: any;
  function install() {
    const version = `${current.plan.manifest.upstream.version}-${current.plan.projectionTreeDigest.slice(7, 19)}`, installPath = join(root, ".claude/plugins/cache/synthetic/fixture", version);
    cpSync(current.materializedPath, installPath, { recursive: true });
    document = { version: 2, plugins: { "unmanaged@other": [{ scope: "user", installPath: "/synthetic/unmanaged", unknown: "must-remain-exact" }], "fixture@synthetic": f.target.registrations.map(scope => ({ scope: scope.scope, ...(scope.projectPath ? { projectPath: scope.projectPath } : {}), installPath, version, installedAt: "2026-01-01T00:00:00.000Z", lastUpdated: "2026-01-01T00:00:00.000Z", sourceCommand: current.plan.sourceCommand, sourceProducerPath: current.materializedPath, previousProducerPaths: [...previous] })) } };
    write();
  }
  function write() { putSynthetic(registry, JSON.stringify(document)); }
  install();
  const source = captureManagedPluginRegistry(registry, [{ bindingId: current.plan.bindingId, storeRoot: f.options.storeRoot }]);
  const binding: AgentDiscoveryBinding = { agent: "claude", method: "reviewed", roots: [], sources: [source] };
  return { ...f, root, registry, binding, get document() { return document; }, write, async update(upstreamVersion = "1.0.1") { previous.push(current.materializedPath); f.state.revision = "r2"; f.update("1.0.1", upstreamVersion); current = await admit(); install(); } };
}
test("a reviewed immutable update across exact user/project scopes keeps the discovery witness valid", async () => {
  const f = await fixture(); expect(() => verifyAgentDiscovery(f.binding)).not.toThrow(); await f.update(); expect(() => verifyAgentDiscovery(f.binding)).not.toThrow();
});
test("retained older native cache versions remain covered after an approved update", async () => {
  const f = await fixture(), oldPath = f.document.plugins["fixture@synthetic"][0].installPath;
  await f.update(); putSynthetic(join(oldPath, "commands/reseeded.md"), "Synthetic old-session command");
  expect(() => verifyAgentDiscovery(f.binding)).toThrow();
});
test("current registration cannot substitute another approved projection of the same upstream version", async () => {
  const f = await fixture(), oldProducer = f.document.plugins["fixture@synthetic"][0].sourceProducerPath;
  await f.update("1.0.0");
  for (const row of f.document.plugins["fixture@synthetic"]) row.sourceProducerPath = oldProducer;
  f.write(); expect(() => verifyAgentDiscovery(f.binding)).toThrow("exact registered producer");
});
test("only the exact native process pin schema is admitted as runtime cache metadata", async () => {
  const f = await fixture(), pins = join(f.document.plugins["fixture@synthetic"][0].installPath, ".in_use");
  mkdirSync(pins); expect(() => verifyAgentDiscovery(f.binding)).not.toThrow();
  putSynthetic(join(pins, "123"), '{"pid":123,"procStart":"synthetic-start"}', 0o600);
  expect(() => verifyAgentDiscovery(f.binding)).not.toThrow();
  for (const body of ['{"pid":124}', '{"pid":123,"unknown":"prompt"}', 'not-json']) {
    putSynthetic(join(pins, "123"), body, 0o600); expect(() => verifyAgentDiscovery(f.binding)).toThrow();
  }
  rmSync(join(pins, "123")); putSynthetic(join(pins, "SKILL.md"), "Synthetic hidden prompt");
  expect(() => verifyAgentDiscovery(f.binding)).toThrow(); rmSync(join(pins, "SKILL.md"));
  symlinkSync(f.root, join(pins, "123")); expect(() => verifyAgentDiscovery(f.binding)).toThrow();
});
test("native orphan timestamps accept the observed umask mode without admitting package content", async () => {
  const f = await fixture(), path = join(f.document.plugins["fixture@synthetic"][0].installPath, ".orphaned_at");
  putSynthetic(path, "1700000000000", 0o664); expect(() => verifyAgentDiscovery(f.binding)).not.toThrow();
  putSynthetic(path, "Synthetic hidden prompt", 0o664); expect(() => verifyAgentDiscovery(f.binding)).toThrow();
  rmSync(path); symlinkSync(join(f.root, "synthetic-executable"), path); expect(() => verifyAgentDiscovery(f.binding)).toThrow();
});
test("exact reviewed project settings admit only their managed registration scopes", async () => {
  const f = await fixture(), project = join(f.root, "project"), settings = join(project, ".claude/settings.json");
  putSynthetic(settings, '{"enabledPlugins":{"fixture@synthetic":true}}');
  expect(() => assertProjectDiscovery("claude", [project], f.root)).toThrow();
  f.binding.sources.push(...captureDiscoveryByteSources([settings]));
  expect(() => assertProjectDiscovery("claude", [project], f.root, undefined, f.binding)).not.toThrow();
  putSynthetic(settings, '{"enabledPlugins":{"other@synthetic":true}}');
  expect(() => assertProjectDiscovery("claude", [project], f.root, undefined, f.binding)).toThrow();
  const other = join(f.root, "other"), otherSettings = join(other, ".claude/settings.json");
  putSynthetic(otherSettings, '{"enabledPlugins":{"fixture@synthetic":true}}'); f.binding.sources.push(...captureDiscoveryByteSources([otherSettings]));
  expect(() => assertProjectDiscovery("claude", [other], f.root, undefined, f.binding)).toThrow();
});
test("unmanaged rows and unknown managed fields retain exact discovery coverage", async () => {
  for (const failure of ["unmanaged", "unknown", "scope", "command", "history", "extra-registration", "cache-prompt", "cache-mode"]) {
    const f = await fixture(), row = f.document.plugins["fixture@synthetic"][0];
    if (failure === "unmanaged") f.document.plugins["unmanaged@other"][0].unknown = "changed";
    if (failure === "unknown") row.futureField = true;
    if (failure === "scope") row.scope = "local";
    if (failure === "command") row.sourceCommand += " --other";
    if (failure === "history") row.previousProducerPaths = [join(f.root, "unapproved")];
    if (failure === "extra-registration") f.document.plugins["fixture@synthetic"].push({ ...row });
    if (failure === "cache-prompt") putSynthetic(join(row.installPath, "skills/reseeded/SKILL.md"), "Synthetic reseed");
    if (failure === "cache-mode") putSynthetic(join(row.installPath, "assets/retained.txt"), "Synthetic ordinary asset 1.0.0\n", 0o755);
    f.write(); expect(() => verifyAgentDiscovery(f.binding)).toThrow();
  }
});

test("canonical JSON receipt serialization preserves exact current and retained cache witnesses", async () => {
  const f = await fixture(); await f.update();
  const root = join(f.options.storeRoot, "receipts");
  for (const relative of readdirSync(root, { recursive: true })) {
    if (!String(relative).endsWith(".json")) continue;
    const path = join(root, String(relative)), receipt = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify(receipt, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item));
  }
  expect(() => verifyAgentDiscovery(f.binding)).not.toThrow();
});
