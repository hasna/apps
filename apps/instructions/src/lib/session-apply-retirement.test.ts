import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applySessionRender, restoreSessionRenderSnapshot } from "./session-apply.js";
import { planSessionRender } from "./session-render.js";
import { makeTempRoot } from "./test-temp-root.js";
const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const targetHome = makeTempRoot("instructions-retirement-"); roots.push(targetHome);
  const plan = (old: boolean) => planSessionRender({ tool: "claude", profile: "reviewed", targetHome,
    sources: [{ id: old ? "old-rule" : "new-rule", content: old ? "Original rule." : "Reviewed replacement." }],
    generatedAt: "2026-09-18T00:00:00.000Z" });
  const initial = plan(true); expect(applySessionRender(initial).applied).toBe(true);
  const file = initial.files.find((f) => f.role === "fragment")!;
  const content = "Reviewed obsolete fragment with preserved edits.\r\n"; writeFileSync(file.path, content);
  const manifest = readFileSync(initial.manifestFile.path, "utf8");
  const options = { expectedManifestSha256: hash(manifest), retireFiles: [{ relativePath: file.relativePath, sha256: hash(content) }] };
  return { targetHome, initial, next: plan(false), make: plan, file, content, manifest, options };
}
describe("exact obsolete managed-file retirement", () => {
  test("requires review for drift, snapshots exact bytes and restores old manifest", () => {
    const f = fixture(); expect(applySessionRender(f.next, { dryRun: true }).conflicts).toHaveLength(1);
    const preview = applySessionRender(f.next, { ...f.options, dryRun: true });
    expect(preview.applied).toBe(false); expect(preview.retirements).toHaveLength(1); expect(existsSync(f.file.path)).toBe(true);
    const applied = applySessionRender(f.next, f.options); expect(applied.applied).toBe(true); expect(existsSync(f.file.path)).toBe(false);
    expect(applied.retirements[0]).toMatchObject({ relativePath: f.file.relativePath, preimageSha256: hash(f.content), previousManagedSha256: f.file.sha256 });
    const snapshot = JSON.parse(readFileSync(applied.snapshotPath!, "utf8"));
    expect(snapshot.retirements).toEqual(applied.retirements);
    expect(snapshot.files.find((x: { relativePath: string }) => x.relativePath === f.file.relativePath).content).toBe(f.content);
    const manifest = JSON.parse(readFileSync(applied.manifestPath, "utf8")); expect(manifest.retirements).toHaveLength(1);
    expect(restoreSessionRenderSnapshot(applied.snapshotPath!).restored).toBe(true);
    expect(readFileSync(f.file.path, "utf8")).toBe(f.content); expect(readFileSync(applied.manifestPath, "utf8")).toBe(f.manifest);
  });
  test("refuses missing manifest hash, wrong preimages, retained files, duplicates and force", () => {
    const f = fixture();
    expect(() => applySessionRender(f.next, { retireFiles: f.options.retireFiles })).toThrow("requires an expected manifest");
    expect(() => applySessionRender(f.next, { ...f.options, expectedManifestSha256: "0".repeat(64) })).toThrow("manifest SHA-256 precondition");
    expect(() => applySessionRender(f.next, { ...f.options, retireFiles: [{ relativePath: f.file.relativePath, sha256: "0".repeat(64) }] })).toThrow("retirement SHA-256 precondition");
    expect(() => applySessionRender(f.make(true), f.options)).toThrow("retained by the new plan");
    expect(() => applySessionRender(f.next, { ...f.options, retireFiles: [...f.options.retireFiles, ...f.options.retireFiles] })).toThrow("Duplicate");
    expect(() => applySessionRender(f.next, { ...f.options, force: true })).toThrow("cannot be combined with force");
    expect(readFileSync(f.file.path, "utf8")).toBe(f.content);
  });
  test("refuses unmanaged paths, entrypoints, traversal and another writer", () => {
    const f = fixture();
    for (const relativePath of ["unmanaged.md", "CLAUDE.md", "../outside.md", ".hasna/session-render-manifest.json"]) {
      expect(() => applySessionRender(f.next, { ...f.options, retireFiles: [{ relativePath, sha256: hash(f.content) }] })).toThrow();
    }
    const changed = JSON.parse(f.manifest); changed.targetOwner.writer.id = "other-writer";
    const raw = JSON.stringify(changed); writeFileSync(f.initial.manifestFile.path, raw);
    expect(() => applySessionRender(f.make(false), { ...f.options, expectedManifestSha256: hash(raw) })).toThrow("this renderer's manifest");
    expect(readFileSync(f.file.path, "utf8")).toBe(f.content);
  });
  test("refuses symlinks and missing targets without following or restoring them", () => {
    const f = fixture(); const outside = join(f.targetHome, "outside.md"); writeFileSync(outside, f.content);
    rmSync(f.file.path); symlinkSync(outside, f.file.path);
    expect(() => applySessionRender(f.next, f.options)).toThrow("symlink"); expect(readFileSync(outside, "utf8")).toBe(f.content);
    rmSync(f.file.path); expect(() => applySessionRender(f.next, f.options)).toThrow("does not exist");
  });
  test("preserves changed bytes and stale manifests after prewrite races", () => {
    const f = fixture();
    expect(() => applySessionRender(f.next, { ...f.options, test_hooks: { before_apply_writes: () => writeFileSync(f.file.path, "Concurrent edit.") } })).toThrow("changed after planning");
    expect(readFileSync(f.file.path, "utf8")).toBe("Concurrent edit.");
    const other = fixture();
    expect(() => applySessionRender(other.next, { ...other.options, test_hooks: { before_apply_writes: () => writeFileSync(other.next.manifestFile.path, "Concurrent manifest.") } })).toThrow("manifest SHA-256 precondition");
    expect(readFileSync(other.file.path, "utf8")).toBe(other.content);
  });
  test("preserves retirement provenance in later ordinary refreshes", () => {
    const f = fixture(); const first = applySessionRender(f.next, f.options);
    const recorded = JSON.parse(readFileSync(first.manifestPath, "utf8")).retirements;
    const second = applySessionRender(f.make(false)); expect(second.retirements).toEqual([]);
    expect(JSON.parse(readFileSync(second.manifestPath, "utf8")).retirements).toEqual(recorded);
  });
});
