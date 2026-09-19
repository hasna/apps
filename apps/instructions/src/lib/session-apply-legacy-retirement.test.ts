import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applySessionRender, restoreSessionRenderSnapshot, type SessionApplyOptions } from "./session-apply.js";
import { planSessionRender, type SessionInstructionSource, type SessionHostedProfileSelector } from "./session-render.js";
import { makeTempRoot } from "./test-temp-root.js";
const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const targetHome = makeTempRoot("instructions-legacy-retirement-"); roots.push(targetHome);
  const source: SessionInstructionSource = { id: "replacement", content: "Canonical reviewed rule.",
    provenance: { profileBinding: { configId: "config-id", configVersion: 3 } } };
  const selector: SessionHostedProfileSelector = { schema: "hasna.instructions.hosted-profile-selector/v1", authority: "https://instructions.example.test/v1",
    profileId: "reviewed-profile", providerVersion: "2.1.278", manual: [], codewithNativeImports: false, allowEmptySources: false, stationProfile: false, checkGlobalCoverage: false };
  const make = () => planSessionRender({ tool: "claude", profile: "reviewed", targetHome, sources: [source], refreshSelector: selector,
    generatedAt: "2026-09-19T00:00:00.000Z" });
  const initial = make(); expect(applySessionRender(initial).applied).toBe(true);
  mkdirSync(join(targetHome, "rules"), { recursive: true });
  const path = join(targetHome, "rules/legacy.md"), content = "Reviewed old instruction.\r\n";
  writeFileSync(path, content, { mode: 0o600 });
  const unrelated = join(targetHome, "rules/unrelated.md"); writeFileSync(unrelated, "Unrelated user rule.");
  const manifest = readFileSync(initial.manifestFile.path, "utf8");
  const pin = { id: source.id, configId: "config-id", configVersion: 3, renderedPayloadSha256: initial.manifest.sources[0]!.renderedPayloadSha256 };
  const request = { relativePath: "rules/legacy.md", sha256: hash(content), coverageReviewSha256: hash("Reviewed exact clause coverage evidence."), replacementSources: [pin] };
  const options: SessionApplyOptions = { expectedManifestSha256: hash(manifest), retireLegacyFiles: [request] };
  return { targetHome, initial, make, source, selector, path, content, unrelated, manifest, pin, request, options };
}

describe("reviewed legacy prompt retirement", () => {
  test("preserves unrequested files and snapshots exact legacy bytes and mode for restore", () => {
    const f = fixture();
    expect(applySessionRender(f.make(), { dryRun: true }).files.some((x) => x.path === f.path)).toBe(false);
    const preview = applySessionRender(f.make(), { ...f.options, dryRun: true });
    expect(preview.applied).toBe(false); expect(preview.legacyRetirements).toHaveLength(1); expect(existsSync(f.path)).toBe(true);
    const result = applySessionRender(f.make(), f.options); expect(result.applied).toBe(true); expect(existsSync(f.path)).toBe(false);
    const snapshot = JSON.parse(readFileSync(result.snapshotPath!, "utf8"));
    expect(snapshot.legacyRetirements).toEqual(result.legacyRetirements);
    expect(snapshot.files.find((x: { relativePath: string }) => x.relativePath === f.request.relativePath)).toMatchObject({ content: f.content, mode: 0o600 });
    const currentManifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(currentManifest.legacyRetirements[0]).not.toHaveProperty("previousManagedSha256");
    expect(currentManifest.legacyRetirements[0]).toMatchObject({ replacementAuthority: f.selector.authority, replacementProfileId: f.selector.profileId });
    expect(currentManifest.files.some((x: { relativePath: string }) => x.relativePath === f.request.relativePath)).toBe(false);
    expect(readFileSync(f.unrelated, "utf8")).toBe("Unrelated user rule.");
    expect(restoreSessionRenderSnapshot(result.snapshotPath!).restored).toBe(true);
    expect(readFileSync(f.path, "utf8")).toBe(f.content); expect(statSync(f.path).mode & 0o777).toBe(0o600);
    expect(readFileSync(result.manifestPath, "utf8")).toBe(f.manifest);
  });
  test("retains provenance through ordinary refresh and refuses a repeated deletion", () => {
    const f = fixture(); const first = applySessionRender(f.make(), f.options);
    const manifest = readFileSync(first.manifestPath, "utf8");
    const second = applySessionRender(f.make()); expect(second.legacyRetirements).toEqual([]);
    expect(JSON.parse(readFileSync(second.manifestPath, "utf8")).legacyRetirements).toEqual(JSON.parse(manifest).legacyRetirements);
    expect(() => applySessionRender(f.make(), { ...f.options, expectedManifestSha256: hash(readFileSync(second.manifestPath)) })).toThrow("does not exist");
  });
  test("requires manifest CAS, exact preimages, coverage, unique requests and no force", () => {
    const f = fixture();
    expect(() => applySessionRender(f.make(), { retireLegacyFiles: [f.request] })).toThrow("requires an expected manifest");
    expect(() => applySessionRender(f.make(), { ...f.options, expectedManifestSha256: "0".repeat(64) })).toThrow("manifest SHA-256 precondition");
    expect(() => applySessionRender(f.make(), { ...f.options, force: true })).toThrow("cannot be combined with force");
    for (const request of [{ ...f.request, sha256: "0".repeat(64) }, { ...f.request, coverageReviewSha256: "" },
      { ...f.request, replacementSources: [] }, { ...f.request, replacementSources: [f.pin, f.pin] }]) {
      expect(() => applySessionRender(f.make(), { ...f.options, retireLegacyFiles: [request] })).toThrow();
    }
    expect(() => applySessionRender(f.make(), { ...f.options, retireLegacyFiles: [f.request, f.request] })).toThrow("Duplicate");
    expect(readFileSync(f.path, "utf8")).toBe(f.content);
  });
  test("requires exact rendered compiled hosted sources; rejects missing, stale and nonemitted pins", () => {
    const f = fixture();
    for (const pin of [{ ...f.pin, id: "skipped" }, { ...f.pin, configId: "other" }, { ...f.pin, configVersion: 2 },
      { ...f.pin, renderedPayloadSha256: "0".repeat(64) }]) {
      expect(() => applySessionRender(f.make(), { ...f.options, retireLegacyFiles: [{ ...f.request, replacementSources: [pin] }] })).toThrow("exact selected rendered source");
    }
    const noHosted = f.make(); delete noHosted.manifest.refreshSelector;
    expect(() => applySessionRender(noHosted, f.options)).toThrow("compiled hosted replacement");
    const noBinding = f.make(); noBinding.manifest.sources[0]!.provenance = null;
    expect(() => applySessionRender(noBinding, f.options)).toThrow("exact selected rendered source");
    const notEmitted = f.make(); notEmitted.files.forEach((file) => { file.sourceIds = []; });
    expect(() => applySessionRender(notEmitted, f.options)).toThrow("exact selected rendered source");
  });
  test("refuses retained, owned, noninstruction, aliased and escaped paths", () => {
    const f = fixture();
    const fragment = f.initial.files.find((x) => x.role === "fragment")!;
    const changedPlan = f.make(); changedPlan.allFiles = changedPlan.allFiles.filter((x) => x.relativePath !== fragment.relativePath);
    expect(() => applySessionRender(changedPlan, { ...f.options, retireLegacyFiles: [{ ...f.request, relativePath: fragment.relativePath }] })).toThrow("already managed");
    for (const relativePath of [fragment.relativePath, "CLAUDE.md", "settings.json", "rules/hook.sh", "../outside.md", "/outside.md", "rules/../outside.md", "rules//legacy.md", "rules/./legacy.md", "rules\\legacy.md", ".hasna/session-render-manifest.json"]) {
      expect(() => applySessionRender(f.make(), { ...f.options, retireLegacyFiles: [{ ...f.request, relativePath }] })).toThrow();
    }
    expect(readFileSync(f.path, "utf8")).toBe(f.content);
  });
  test("refuses symlinks, directories, hard links, special permissions and invalid UTF-8", () => {
    const f = fixture(); rmSync(f.path); symlinkSync(f.unrelated, f.path);
    expect(() => applySessionRender(f.make(), f.options)).toThrow("symlink"); rmSync(f.path);
    mkdirSync(f.path); expect(() => applySessionRender(f.make(), f.options)).toThrow("regular file"); rmSync(f.path, { recursive: true });
    writeFileSync(f.path, f.content); linkSync(f.path, join(f.targetHome, "hardlink"));
    expect(() => applySessionRender(f.make(), f.options)).toThrow("one link"); rmSync(join(f.targetHome, "hardlink"));
    expect(Bun.spawnSync(["chmod", "1644", f.path]).exitCode).toBe(0);
    expect(statSync(f.path).mode & 0o1000).toBe(0o1000);
    expect(() => applySessionRender(f.make(), f.options)).toThrow("ordinary file"); chmodSync(f.path, 0o644);
    const bytes = Buffer.from([0xff, 0xfe]); writeFileSync(f.path, bytes);
    expect(() => applySessionRender(f.make(), { ...f.options, retireLegacyFiles: [{ ...f.request, sha256: hash(bytes) }] })).toThrow("losslessly restorable UTF-8");
  });
  test("refuses concurrent legacy or manifest edits before the first payload write", () => {
    for (const mutateManifest of [false, true]) {
      const f = fixture(); const originalPrimary = readFileSync(join(f.targetHome, "CLAUDE.md"));
      f.source.content = "New canonical replacement."; const next = f.make();
      const pin = { ...f.pin, renderedPayloadSha256: next.manifest.sources[0]!.renderedPayloadSha256 };
      expect(() => applySessionRender(next, { ...f.options, retireLegacyFiles: [{ ...f.request, replacementSources: [pin] }],
        test_hooks: { before_apply_writes: () => writeFileSync(mutateManifest ? next.manifestFile.path : f.path, "Concurrent edit.") } })).toThrow();
      expect(readFileSync(join(f.targetHome, "CLAUDE.md"))).toEqual(originalPrimary);
      expect(readFileSync(mutateManifest ? f.path : next.manifestFile.path, "utf8")).toBe(mutateManifest ? f.content : f.manifest);
    }
  });
  test("rollback refuses recreated legacy files and preserves the concurrent bytes", () => {
    const f = fixture(); const applied = applySessionRender(f.make(), f.options);
    writeFileSync(f.path, "New user file."); const restore = restoreSessionRenderSnapshot(applied.snapshotPath!);
    expect(restore.restored).toBe(false); expect(restore.conflicts.some((x) => x.path === f.path)).toBe(true);
    expect(readFileSync(f.path, "utf8")).toBe("New user file.");
  });
  test("refuses portable removal when the coordinated target requires anchored operations", () => {
    const f = fixture();
    expect(() => applySessionRender(f.make(), { ...f.options, test_hooks: { force_portable_file_ops: true } })).toThrow("directory-anchored managed-file removal");
    expect(readFileSync(f.path, "utf8")).toBe(f.content);
    expect(readFileSync(f.initial.manifestFile.path, "utf8")).toBe(f.manifest);
  });
  test("retiring Claude AGENTS still requires independent exact registered authority", () => {
    const f = fixture(); const path = join(f.targetHome, "AGENTS.md"); writeFileSync(path, f.content);
    expect(f.make().blocked).toBe(true);
    const authority = { slug: "legacy-agent", targetPath: path, content: f.content };
    const plan = planSessionRender({ tool: "claude", profile: "reviewed", targetHome: f.targetHome, sources: [f.source], refreshSelector: f.selector, ownedClaudeAuthorities: [authority] });
    const options = { ...f.options, retireLegacyFiles: [{ ...f.request, relativePath: "AGENTS.md" }] };
    expect(() => applySessionRender(plan, options)).toThrow();
    const applied = applySessionRender(plan, { ...options, ownedClaudeAuthorities: [authority] });
    expect(applied.applied).toBe(true); expect(existsSync(path)).toBe(false);
    expect(readFileSync(f.path, "utf8")).toBe(f.content);
    expect(restoreSessionRenderSnapshot(applied.snapshotPath!).restored).toBe(true); expect(readFileSync(path, "utf8")).toBe(f.content);
  });
});
