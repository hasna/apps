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

test("profile revision CAS and unrelated profile edits require a new approval", async () => {
  for (const change of ["revision", "addition", "removal", "reordering", "property-order"]) {
    const f = fixture(), reviewed = await f.plan();
    f.state.revision = `revision-${change}`;
    f.transform(profile => {
      if (change === "addition") profile.selections.push({ ...profile.selections[1]!, slug: "unrelated-skill" });
      if (change === "removal") profile.selections.push({ ...profile.selections[1]!, slug: "unrelated-skill" });
      if (change === "reordering") profile.selections.reverse();
      if (change === "property-order") profile.selections = profile.selections.map(selection => Object.fromEntries(Object.entries(selection).reverse()) as typeof selection);
      return profile;
    });
    const current = await f.plan();
    expect(current.profileRevision).toBe(f.state.revision);
    expect(current.planDigest).not.toBe(reviewed.planDigest);
    expect(current.evidenceDigest).not.toBe(reviewed.evidenceDigest);
    await expect(admitPlugin("synthetic-integration", "synthetic-profile", f.target, reviewed.planDigest, reviewed.evidenceDigest, f.options)).rejects.toThrow("plan changed");
    const receipt = await admitPlugin("synthetic-integration", "synthetic-profile", f.target, current.planDigest, current.evidenceDigest, f.options);
    expect(receipt.plan.profileRevision).toBe(f.state.revision);
  }
});
test("post-review integration and mapped alias or trigger mutations require new approval", async () => {
  const cases: Array<{ name: string; prepare?: (profile: ReturnType<ReturnType<typeof fixture>["profile"]>) => void; mutate: (profile: ReturnType<ReturnType<typeof fixture>["profile"]>) => void }> = [
    { name: "integration alias", mutate: profile => { profile.selections[0]!.aliases = ["integration-alias"]; } },
    { name: "payload alias", mutate: profile => { profile.selections[1]!.aliases = ["payload-alias"]; } },
    { name: "keyword", mutate: profile => { profile.selections[0]!.triggers = { keywords: ["changed"] }; } },
    { name: "path", mutate: profile => { profile.selections[1]!.triggers = { paths: ["**/*.changed"] }; } },
    { name: "always", mutate: profile => { profile.selections[0]!.triggers = { always: true }; } },
    { name: "trigger ordering", prepare: profile => { profile.selections[0]!.triggers = { keywords: ["first", "second"] }; }, mutate: profile => { profile.selections[0]!.triggers = { keywords: ["second", "first"] }; } },
  ];
  for (const item of cases) {
    const f = fixture();
    if (item.prepare) f.transform(profile => { item.prepare!(profile); return profile; });
    const reviewed = await f.plan();
    const receipt = await admitPlugin("synthetic-integration", "synthetic-profile", f.target, reviewed.planDigest, reviewed.evidenceDigest, f.options);
    f.transform(profile => { item.mutate(profile); return profile; });
    const current = await f.plan();
    expect(current.profileRevision).toBe(reviewed.profileRevision);
    expect(current.planDigest, item.name).not.toBe(reviewed.planDigest);
    expect(current.evidenceDigest, item.name).not.toBe(reviewed.evidenceDigest);
    await expect(resolveAdmittedPlugin(reviewed.bindingId, f.options)).rejects.toThrow();
    await expect(admitPlugin("synthetic-integration", "synthetic-profile", f.target, reviewed.planDigest, reviewed.evidenceDigest, f.options)).rejects.toThrow("plan changed");
    const renewed = await admitPlugin("synthetic-integration", "synthetic-profile", f.target, current.planDigest, current.evidenceDigest, f.options);
    expect(renewed.plan.planDigest).toBe(current.planDigest);
    expect(renewed.materializedPath).not.toBe(receipt.materializedPath);
  }
});
test("admission requires explicit approval of both plan and routing evidence digests", async () => {
  const f = fixture(), reviewed = await f.plan();
  await expect(admitPlugin("synthetic-integration", "synthetic-profile", f.target, reviewed.planDigest, `sha256:${"f".repeat(64)}`, f.options)).rejects.toThrow("routing evidence changed");
  await expect(admitPlugin("synthetic-integration", "synthetic-profile", f.target, `sha256:${"e".repeat(64)}`, reviewed.evidenceDigest, f.options)).rejects.toThrow("plan changed");
  const receipt = await admitPlugin("synthetic-integration", "synthetic-profile", f.target, reviewed.planDigest, reviewed.evidenceDigest, f.options);
  expect(receipt.schemaVersion).toBe(3); expect(receipt.plan.schemaVersion).toBe(3);
});
test("target object and registration ordering preserve binding, command and immutable persistence", async () => {
  const f = fixture(); f.target.registrations.push({ scope: "project", projectPath: join(roots.at(-1)!, "project") });
  const first = await f.plan(), receipt = await admitPlugin("synthetic-integration", "synthetic-profile", f.target, first.planDigest, first.evidenceDigest, f.options);
  const reordered = JSON.parse(JSON.stringify({ resolver: Object.fromEntries(Object.entries(f.target.resolver).reverse()), native: Object.fromEntries(Object.entries(f.target.native).reverse()), registrations: [...f.target.registrations].reverse().map(row => ({ projectPath: row.projectPath, scope: row.scope })), pluginId: f.target.pluginId, schemaVersion: 1 })) as PluginAdmissionTarget;
  const next = await f.plan("synthetic-integration", reordered);
  expect(next.bindingId).toBe(first.bindingId); expect(next.planDigest).toBe(first.planDigest); expect(next.sourceCommand).toBe(first.sourceCommand);
  expect(await admitPlugin("synthetic-integration", "synthetic-profile", reordered, first.planDigest, first.evidenceDigest, f.options)).toEqual(receipt);
});
test("human integration aliases bind canonically and neither canonical target can be substituted by an alias", async () => {
  const f = fixture(); f.transform(profile => { profile.selections[0]!.aliases = ["integration-alias"]; return profile; });
  const first = await f.plan("integration-alias"); expect(first.binding.bundleSlug).toBe("synthetic-integration");
  await admitPlugin("integration-alias", "synthetic-profile", f.target, first.planDigest, first.evidenceDigest, f.options);
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
    const f = fixture(), first = await f.plan(); await admitPlugin("synthetic-integration", "synthetic-profile", f.target, first.planDigest, first.evidenceDigest, f.options);
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
test("receipt v3 rejects legacy schemas and any rehashed routing or principal mutation", async () => {
  for (const change of ["receipt-v2", "plan-v2", "binding-v1", "missing-evidence", "identity", "profile-revision", "principal", "observed-alias", "observed-slug", "observed-trigger", "payload-membership", "duplicate-payload", "unknown-plan", "missing-observation", "mapped-source"]) {
    const f = fixture(), plan = await f.plan();
    await admitPlugin("synthetic-integration", "synthetic-profile", f.target, plan.planDigest, plan.evidenceDigest, f.options);
    const path = pluginReceiptPath(f.options.storeRoot, plan.bindingId, plan.planDigest), receipt = JSON.parse(readFileSync(path, "utf8"));
    const p = receipt.plan;
    if (change === "receipt-v2") receipt.schemaVersion = 2;
    if (change === "plan-v2") p.schemaVersion = 2;
    if (change === "binding-v1") p.binding.schemaVersion = 1;
    if (change === "missing-evidence") delete p.evidenceDigest;
    if (change === "identity") p.selection.version = "9.9.9";
    if (change === "profile-revision") { p.profileRevision = "changed"; p.observation.profileRevision = "changed"; }
    if (change === "principal") { p.binding.principal.userId = "other-owner"; p.observation.principal.userId = "other-owner"; }
    if (change === "observed-alias") { p.selection.aliases = ["new-alias"]; p.observation.integration.aliases = ["new-alias"]; }
    if (change === "observed-slug") p.observation.payloads[0].slug = "replacement";
    if (change === "observed-trigger") { p.payloadSelections[0].triggers = { always: true }; p.observation.payloads[0].triggers = { always: true }; }
    if (change === "payload-membership") p.payloadSelections = [];
    if (change === "duplicate-payload") p.payloadSelections.push(p.payloadSelections[0]);
    if (change === "unknown-plan") p.unknown = true;
    if (change === "missing-observation") delete p.observation;
    if (change === "mapped-source") p.manifest.payloads[0].sourceDigest = `sha256:${"f".repeat(64)}`;
    if (["profile-revision", "principal", "observed-alias", "observed-trigger"].includes(change)) {
      p.evidenceDigest = `sha256:${pluginHash(canonical(p.observation))}`;
      const identity = { ...p }; delete identity.observation; delete identity.planDigest;
      p.planDigest = `sha256:${pluginHash(canonical(identity))}`;
    }
    writeFileSync(path, JSON.stringify(receipt));
    expect(() => readPluginAdmissionReceipt(f.options.storeRoot, plan.bindingId, plan.planDigest)).toThrow();
  }
});

test("canonical JSON receipt roundtrip preserves content identity and immutable replay", async () => {
  const f = fixture(), plan = await f.plan();
  const receipt = await admitPlugin("synthetic-integration", "synthetic-profile", f.target, plan.planDigest, plan.evidenceDigest, f.options);
  const path = pluginReceiptPath(f.options.storeRoot, plan.bindingId, plan.planDigest), bytes = canonical(receipt);
  writeFileSync(path, bytes);
  expect(readPluginAdmissionReceipt(f.options.storeRoot, plan.bindingId, plan.planDigest)).toEqual(receipt);
  expect(await resolveAdmittedPlugin(plan.bindingId, f.options)).toBe(receipt.materializedPath);
  expect(await admitPlugin("synthetic-integration", "synthetic-profile", f.target, plan.planDigest, plan.evidenceDigest, f.options)).toEqual(receipt);
  expect(readFileSync(path, "utf8")).toBe(bytes);
});
