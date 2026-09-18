import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitPlugin, planPluginAdmission, pluginReceiptPath, readPluginAdmissionReceipt, resolveAdmittedPlugin, type PluginAdmissionTarget } from "./plugin-admission.js";
import { pluginFixture } from "./plugin-admission.test-fixtures.js";
import { pluginHash } from "./plugin-projection.js";
import type { ResolvedSkillProfile } from "../types/skill-selection.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skills-plugin-identity-")); roots.push(root);
  const f = pluginFixture(root);
  let transform = (profile: ResolvedSkillProfile) => profile;
  const client = { ...f.client, get authority() { return f.state.authority; }, async resolveProfile(id: string) { return transform(await f.client.resolveProfile(id)); } };
  const options = { ...f.options, client };
  return { ...f, options, transform(fn: typeof transform) { transform = fn; }, plan(spec = "synthetic-integration", target = f.target) { return planPluginAdmission(spec, "synthetic-profile", target, options); } };
}
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

test("revision and unrelated selection changes preserve admission while evidence stays fresh and immutable", async () => {
  const f = fixture(), first = await f.plan();
  const receipt = await admitPlugin("synthetic-integration", "synthetic-profile", f.target, first.planDigest, f.options);
  const path = pluginReceiptPath(f.options.storeRoot, first.bindingId, first.planDigest), bytes = readFileSync(path);
  for (const change of ["revision", "addition", "removal", "reordering", "property-order"]) {
    f.state.revision = `revision-${change}`;
    f.transform(profile => {
      if (change === "addition") profile.selections.push({ ...profile.selections[1]!, slug: "unrelated-skill" });
      if (change === "reordering") profile.selections.reverse();
      if (change === "property-order") profile.selections = profile.selections.map(selection => Object.fromEntries(Object.entries(selection).reverse()) as typeof selection);
      return profile;
    });
    const next = await f.plan();
    expect(next.planDigest).toBe(first.planDigest); expect(next.evidenceDigest).not.toBe(first.evidenceDigest);
    expect(next.observation.profileRevision).toBe(f.state.revision);
    const before = { profiles: f.state.profileCalls, bundles: f.state.bundleCalls };
    expect(await resolveAdmittedPlugin(first.bindingId, f.options)).toBe(receipt.materializedPath);
    expect(f.state.profileCalls - before.profiles).toBe(1); expect(f.state.bundleCalls - before.bundles).toBe(2);
    expect(await admitPlugin("synthetic-integration", "synthetic-profile", f.target, first.planDigest, f.options)).toEqual(receipt);
    expect(readFileSync(path)).toEqual(bytes);
  }
});
test("admission accepts unrelated profile edits between review and materialization", async () => {
  const f = fixture(), reviewed = await f.plan(); f.state.revision = "r2";
  const receipt = await admitPlugin("synthetic-integration", "synthetic-profile", f.target, reviewed.planDigest, f.options);
  expect(receipt.schemaVersion).toBe(2); expect(receipt.plan.schemaVersion).toBe(2);
  expect(receipt.plan.observation.profileRevision).toBe("r2"); expect(receipt.plan.evidenceDigest).not.toBe(reviewed.evidenceDigest);
  expect(receipt.plan.planDigest).toBe(reviewed.planDigest);
});
test("integration and mapped aliases and triggers are observed routing metadata, not admission identities", async () => {
  const f = fixture(), reviewed = await f.plan();
  const receipt = await admitPlugin("synthetic-integration", "synthetic-profile", f.target, reviewed.planDigest, f.options);
  for (const index of [0, 1]) for (const field of ["aliases", "triggers"]) {
    f.state.revision = `r-${index}-${field}`;
    f.transform(profile => { if (field === "aliases") profile.selections[index]!.aliases = [`alias-${index}`]; else profile.selections[index]!.triggers = { keywords: ["synthetic"], paths: ["**/*.fixture"], always: true }; return profile; });
    const next = await f.plan(); expect(next.planDigest).toBe(reviewed.planDigest); expect(next.evidenceDigest).not.toBe(reviewed.evidenceDigest);
    expect(await resolveAdmittedPlugin(reviewed.bindingId, f.options)).toBe(receipt.materializedPath);
  }
});
test("target object and registration ordering preserve binding, command and immutable persistence", async () => {
  const f = fixture(); f.target.registrations.push({ scope: "project", projectPath: join(roots.at(-1)!, "project") });
  const first = await f.plan(), receipt = await admitPlugin("synthetic-integration", "synthetic-profile", f.target, first.planDigest, f.options);
  const reordered = JSON.parse(JSON.stringify({ resolver: Object.fromEntries(Object.entries(f.target.resolver).reverse()), native: Object.fromEntries(Object.entries(f.target.native).reverse()), registrations: [...f.target.registrations].reverse().map(row => ({ projectPath: row.projectPath, scope: row.scope })), pluginId: f.target.pluginId, schemaVersion: 1 })) as PluginAdmissionTarget;
  const next = await f.plan("synthetic-integration", reordered);
  expect(next.bindingId).toBe(first.bindingId); expect(next.planDigest).toBe(first.planDigest); expect(next.sourceCommand).toBe(first.sourceCommand);
  expect(await admitPlugin("synthetic-integration", "synthetic-profile", reordered, first.planDigest, f.options)).toEqual(receipt);
});
test("human integration aliases bind canonically and neither canonical target can be substituted by an alias", async () => {
  const f = fixture(); f.transform(profile => { profile.selections[0]!.aliases = ["integration-alias"]; return profile; });
  const first = await f.plan("integration-alias"); expect(first.binding.bundleSlug).toBe("synthetic-integration");
  await admitPlugin("integration-alias", "synthetic-profile", f.target, first.planDigest, f.options);
  for (const index of [0, 1]) {
    const name = index === 0 ? "synthetic-integration" : "synthetic-payload";
    f.bundles.set("replacement@1.0.0", f.bundles.get(`${name}@1.0.0`)!);
    f.transform(profile => { profile.selections[index]!.slug = "replacement"; profile.selections[index]!.aliases = [name]; return profile; });
    await expect(resolveAdmittedPlugin(first.bindingId, f.options)).rejects.toThrow();
    if (index === 1) await expect(f.plan()).rejects.toThrow("reviewed digest");
  }
});
test("unknown authorization metadata, malformed triggers and invalid aliases cannot be discarded", async () => {
  const f = fixture();
  for (const change of ["profile-unknown", "selection-unknown", "trigger-unknown", "trigger-type", "trigger-overflow", "alias-collision"]) {
    f.transform(profile => {
      if (change === "profile-unknown") Object.assign(profile, { permissions: { revoked: true } });
      if (change === "selection-unknown") Object.assign(profile.selections[1]!, { permissions: { revoked: true } });
      if (change === "trigger-unknown") Object.assign(profile.selections[1]!, { triggers: { execute: true } });
      if (change === "trigger-type") Object.assign(profile.selections[1]!, { triggers: { always: "true" } });
      if (change === "trigger-overflow") profile.selections[1]!.triggers = { keywords: Array(33).fill("synthetic") };
      if (change === "alias-collision") profile.selections[1]!.aliases = ["synthetic-integration"];
      return profile;
    });
    await expect(f.plan()).rejects.toThrow();
  }
});
test("relevant membership, version, digest and authority changes still refuse existing admission", async () => {
  for (const change of ["payload-missing", "payload-version", "payload-digest", "container-version", "workspace", "authority", "profile-id", "revoked", "offline", "timeout"]) {
    const f = fixture(), first = await f.plan(); await admitPlugin("synthetic-integration", "synthetic-profile", f.target, first.planDigest, f.options);
    f.transform(profile => {
      if (change === "payload-missing") profile.selections.pop();
      if (change === "payload-version") profile.selections[1]!.version = "1.0.1";
      if (change === "payload-digest") profile.selections[1]!.bundleDigest = `sha256:${"a".repeat(64)}`;
      if (change === "profile-id") profile.profileId = "different-profile";
      return profile;
    });
    if (change === "container-version") f.update("1.0.1");
    if (change === "workspace") f.state.workspace = "different-workspace";
    if (change === "authority") f.state.authority = "https://other.example.com/skills/v1";
    if (change === "revoked") f.state.revoked = true;
    if (change === "offline") f.state.offline = true;
    const options = change === "timeout" ? { ...f.options, timeoutMs: 10, client: { ...f.options.client, resolveProfile: () => new Promise<ResolvedSkillProfile>(() => {}) } } : f.options;
    await expect(resolveAdmittedPlugin(first.bindingId, options)).rejects.toThrow();
  }
});
test("receipt v2 validates both hashes and exact observed identity even when evidence is rehashed", async () => {
  for (const change of ["schema-v1", "plan-v1", "missing-evidence", "identity", "evidence", "observation-revision", "observed-alias", "observed-slug", "observed-workspace", "observed-authority", "observed-unknown", "observed-trigger", "payload-membership", "duplicate-payload", "unknown-plan", "missing-observation", "mapped-source"]) {
    const f = fixture(), plan = await f.plan();
    await admitPlugin("synthetic-integration", "synthetic-profile", f.target, plan.planDigest, f.options);
    const path = pluginReceiptPath(f.options.storeRoot, plan.bindingId, plan.planDigest), receipt = JSON.parse(readFileSync(path, "utf8"));
    const p = receipt.plan;
    if (change === "schema-v1") receipt.schemaVersion = 1;
    if (change === "plan-v1") p.schemaVersion = 1;
    if (change === "missing-evidence") delete p.evidenceDigest;
    if (change === "identity") p.selection.version = "9.9.9";
    if (change === "evidence") p.observation.profileRevision = "changed-evidence";
    if (change === "observation-revision") p.observation.payloads[0].profileRevision = "inconsistent";
    if (change === "observed-alias") p.observation.payloads[0].aliases = ["synthetic-integration"];
    if (change === "observed-slug") p.observation.payloads[0].slug = "replacement";
    if (change === "observed-workspace") p.observation.payloads[0].workspaceId = "other";
    if (change === "observed-authority") p.observation.payloads[0].authority = "https://other.example.com/skills/v1";
    if (change === "observed-unknown") p.observation.payloads[0].permissions = { revoked: true };
    if (change === "observed-trigger") p.observation.payloads[0].triggers = { always: "true" };
    if (change === "payload-membership") p.payloadSelections = [];
    if (change === "duplicate-payload") p.payloadSelections.push(p.payloadSelections[0]);
    if (change === "unknown-plan") p.unknown = true;
    if (change === "missing-observation") delete p.observation;
    if (change === "mapped-source") p.manifest.payloads[0].sourceDigest = `sha256:${"f".repeat(64)}`;
    if (!["missing-evidence", "evidence"].includes(change)) { const { evidenceDigest: _, ...unsigned } = p; p.evidenceDigest = `sha256:${pluginHash(canonical(unsigned))}`; }
    writeFileSync(path, JSON.stringify(receipt));
    expect(() => readPluginAdmissionReceipt(f.options.storeRoot, plan.bindingId, plan.planDigest)).toThrow();
  }
});

test("canonical JSON receipt roundtrip preserves content identity and immutable replay", async () => {
  const f = fixture(), plan = await f.plan();
  const receipt = await admitPlugin("synthetic-integration", "synthetic-profile", f.target, plan.planDigest, f.options);
  const path = pluginReceiptPath(f.options.storeRoot, plan.bindingId, plan.planDigest), bytes = canonical(receipt);
  writeFileSync(path, bytes);
  expect(readPluginAdmissionReceipt(f.options.storeRoot, plan.bindingId, plan.planDigest)).toEqual(receipt);
  expect(await resolveAdmittedPlugin(plan.bindingId, f.options)).toBe(receipt.materializedPath);
  expect(await admitPlugin("synthetic-integration", "synthetic-profile", f.target, plan.planDigest, f.options)).toEqual(receipt);
  expect(readFileSync(path, "utf8")).toBe(bytes);
});
