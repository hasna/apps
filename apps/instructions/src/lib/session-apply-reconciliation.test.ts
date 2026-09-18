import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applySessionRender, checkSessionRenderDrift, restoreSessionRenderSnapshot } from "./session-apply.js";
import { planSessionRender, type SessionRenderTool } from "./session-render.js";
import { makeTempRoot } from "./test-temp-root.js";

const roots: string[] = [];
function root(): string {
  const value = makeTempRoot("instructions-exact-reconciliation-");
  roots.push(value);
  return value;
}
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
function hash(content: string | Buffer): string { return createHash("sha256").update(content).digest("hex"); }
function plan(targetHome: string, tool: SessionRenderTool = "sumi", content = "Reviewed instruction.") {
  return planSessionRender({
    tool, targetHome, profile: "reviewed-profile",
    sources: [{ id: "reviewed-source", content }, { id: "second-source", content: "Second reviewed instruction." }],
    generatedAt: "2026-09-18T00:00:00.000Z",
  });
}
function fixture(tool: SessionRenderTool = "sumi", fragment = false) {
  const targetHome = root();
  const initial = plan(targetHome, tool);
  expect(applySessionRender(initial).applied).toBe(true);
  const file = fragment ? initial.files.find((entry) => entry.relativePath.startsWith(".hasna/instructions/"))! : initial.files[0]!;
  const content = `${file.content}\r\nReviewed authority append.\r\n`;
  writeFileSync(file.path, content);
  const manifestBefore = readFileSync(initial.manifestFile.path, "utf8");
  const options = {
    reconcileFiles: [{ relativePath: file.relativePath, sha256: hash(content) }],
    expectedManifestSha256: hash(manifestBefore),
  };
  return { targetHome, file, content, manifestBefore, options, rendered: plan(targetHome, tool) };
}

describe("exact owned drift reconciliation", () => {
  test.each(["sumi", "codex", "claude"] as const)("%s reconciliation snapshots drifted bytes and old manifest, then restores both", (tool) => {
    const value = fixture(tool);
    const result = applySessionRender(value.rendered, value.options);
    expect(result.applied).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.adoptions).toEqual([]);
    expect(result.reconciliations).toEqual([{
      path: value.file.path, relativePath: value.file.relativePath,
      preimageSha256: hash(value.content), renderedSha256: value.file.sha256,
      previousManagedSha256: value.file.sha256, sourceIds: value.file.sourceIds,
    }]);
    expect(result.drift.clean).toBe(false);
    expect(checkSessionRenderDrift(value.targetHome).clean).toBe(true);
    expect(value.rendered.manifest.reconciliations).toBeUndefined();
    expect(result.rollback.status).toBe("available");
    const snapshot = JSON.parse(readFileSync(result.snapshotPath!, "utf8"));
    expect(snapshot.reconciliations).toEqual(result.reconciliations);
    expect(snapshot.previousManifest).toEqual(JSON.parse(value.manifestBefore));
    expect(snapshot.files.find((entry: { relativePath: string }) => entry.relativePath === value.file.relativePath)).toMatchObject({
      content: value.content, sha256: hash(value.content),
    });
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(manifest.reconciliations).toEqual(result.reconciliations.map(({ path: _path, ...entry }) => entry));
    expect(restoreSessionRenderSnapshot(result.snapshotPath!).restored).toBe(true);
    expect(readFileSync(value.file.path)).toEqual(Buffer.from(value.content));
    expect(readFileSync(result.manifestPath, "utf8")).toBe(value.manifestBefore);
    expect(checkSessionRenderDrift(value.targetHome).clean).toBe(false);
  });

  test("reconciles a manifest-owned Claude fragment within the exclusive managed namespace", () => {
    const value = fixture("claude", true);
    expect(value.file.relativePath.startsWith(".hasna/instructions/")).toBe(true);
    const result = applySessionRender(value.rendered, value.options);
    expect(result.applied).toBe(true);
    expect(result.files.find((entry) => entry.relativePath === value.file.relativePath)?.reason).toBe("exact observed SHA-256 reconciliation");
    expect(readFileSync(value.file.path, "utf8")).toBe(value.file.content);
    expect(restoreSessionRenderSnapshot(result.snapshotPath!).restored).toBe(true);
    expect(readFileSync(value.file.path, "utf8")).toBe(value.content);
  });

  test("dry run proves exact selection without mutation", () => {
    const value = fixture();
    const result = applySessionRender(value.rendered, { ...value.options, dryRun: true });
    expect(result.applied).toBe(false);
    expect(result.reconciliations).toHaveLength(1);
    expect(result.snapshotPath).toBeNull();
    expect(readFileSync(value.file.path, "utf8")).toBe(value.content);
    expect(readFileSync(result.manifestPath, "utf8")).toBe(value.manifestBefore);
  });

  test("requires an exact observed manifest and rejects stale authority before replacing payloads", () => {
    const value = fixture();
    expect(() => applySessionRender(value.rendered, { reconcileFiles: value.options.reconcileFiles })).toThrow("requires an expected manifest SHA-256");
    expect(() => applySessionRender(value.rendered, { ...value.options, expectedManifestSha256: "0".repeat(64) })).toThrow("manifest SHA-256 precondition failed");
    expect(() => applySessionRender(value.rendered, {
      ...value.options,
      test_hooks: { before_apply_writes: () => writeFileSync(value.rendered.manifestFile.path, "Concurrent manifest edit.\n") },
    })).toThrow("manifest SHA-256 precondition failed");
    expect(readFileSync(value.file.path, "utf8")).toBe(value.content);
  });

  test("rejects unmanaged files, missing files, and invalid ownership metadata", () => {
    const value = fixture();
    const originalManifest = JSON.parse(value.manifestBefore);
    for (const mutate of [
      (manifest: typeof originalManifest) => { manifest.files = []; },
      (manifest: typeof originalManifest) => { manifest.targetOwner.writer.id = "another-writer"; },
      (manifest: typeof originalManifest) => { manifest.files[0].path = join(value.targetHome, "unrelated.md"); },
      (manifest: typeof originalManifest) => { manifest.files.push(manifest.files[0]); },
    ]) {
      const manifest = structuredClone(originalManifest);
      mutate(manifest);
      const bytes = `${JSON.stringify(manifest)}\n`;
      writeFileSync(value.rendered.manifestFile.path, bytes);
      expect(() => applySessionRender(value.rendered, { ...value.options, expectedManifestSha256: hash(bytes) })).toThrow(/manifest/);
      expect(readFileSync(value.file.path, "utf8")).toBe(value.content);
    }
    writeFileSync(value.rendered.manifestFile.path, value.manifestBefore);
    rmSync(value.file.path);
    expect(() => applySessionRender(value.rendered, value.options)).toThrow("does not exist");
    expect(existsSync(value.file.path)).toBe(false);
  });

  test("rejects unchanged managed bytes and drift that already equals the requested output", () => {
    const value = fixture();
    writeFileSync(value.file.path, value.file.content);
    expect(() => applySessionRender(value.rendered, {
      ...value.options, reconcileFiles: [{ relativePath: value.file.relativePath, sha256: value.file.sha256 }],
    })).toThrow("has no managed drift");
    const updated = plan(value.targetHome, "sumi", "Updated reviewed rule.");
    writeFileSync(value.file.path, updated.files[0]!.content);
    expect(() => applySessionRender(updated, {
      ...value.options, reconcileFiles: [{ relativePath: value.file.relativePath, sha256: updated.files[0]!.sha256 }],
    })).toThrow("already matches the planned output");
    expect(readFileSync(value.rendered.manifestFile.path, "utf8")).toBe(value.manifestBefore);
  });

  test("rejects stale hashes, duplicate/unknown targets, bad hashes, and force", () => {
    const value = fixture();
    expect(() => applySessionRender(value.rendered, {
      ...value.options, reconcileFiles: [{ relativePath: value.file.relativePath, sha256: "0".repeat(64) }],
    })).toThrow("reconciliation SHA-256 precondition failed");
    expect(() => applySessionRender(value.rendered, {
      ...value.options, reconcileFiles: [...value.options.reconcileFiles, ...value.options.reconcileFiles],
    })).toThrow("Duplicate file reconciliation target");
    for (const relativePath of ["../AGENTS.md", "unrelated.md", "./AGENTS.md", ".hasna/session-render-manifest.json"]) {
      expect(() => applySessionRender(value.rendered, {
        ...value.options, reconcileFiles: [{ relativePath, sha256: hash(value.content) }],
      })).toThrow("not a unique planned instruction output");
    }
    expect(() => applySessionRender(value.rendered, {
      ...value.options, reconcileFiles: [{ relativePath: value.file.relativePath, sha256: "invalid" }],
    })).toThrow("64-character lowercase SHA-256");
    expect(() => applySessionRender(value.rendered, { ...value.options, force: true })).toThrow("cannot be combined with force");
    expect(readFileSync(value.file.path, "utf8")).toBe(value.content);
  });

  test("keeps unrelated owned drift blocked", () => {
    const value = fixture("claude", true);
    const other = value.rendered.files.find((file) => file.relativePath.startsWith(".hasna/instructions/") && file.path !== value.file.path)!;
    writeFileSync(other.path, "Unreviewed drift.\n");
    const result = applySessionRender(plan(value.targetHome, "claude"), value.options);
    expect(result.applied).toBe(false);
    expect(result.conflicts.map((entry) => entry.relativePath)).toContain(other.relativePath);
    expect(result.snapshotPath).toBeNull();
    expect(readFileSync(value.file.path, "utf8")).toBe(value.content);
    expect(readFileSync(other.path, "utf8")).toBe("Unreviewed drift.\n");
    expect(readFileSync(result.manifestPath, "utf8")).toBe(value.manifestBefore);
  });

  test("rejects symlinks and changed preimages immediately before writing", () => {
    const value = fixture();
    expect(() => applySessionRender(value.rendered, {
      ...value.options,
      test_hooks: { before_apply_writes: () => writeFileSync(value.file.path, "Concurrent preimage edit.") },
    })).toThrow("changed after planning");
    expect(readFileSync(value.file.path, "utf8")).toBe("Concurrent preimage edit.");
    const outside = join(root(), "outside.md");
    writeFileSync(outside, value.content);
    rmSync(value.file.path);
    symlinkSync(outside, value.file.path);
    expect(() => applySessionRender(value.rendered, value.options)).toThrow("symlink");
    expect(readFileSync(outside, "utf8")).toBe(value.content);
  });

  test("preserves distinct reconciliation history across repeat repairs and ordinary updates", () => {
    const value = fixture();
    const first = applySessionRender(value.rendered, value.options);
    const firstManifest = JSON.parse(readFileSync(first.manifestPath, "utf8"));
    writeFileSync(value.file.path, "A second reviewed drift.\n");
    const second = applySessionRender(plan(value.targetHome), {
      reconcileFiles: [{ relativePath: value.file.relativePath, sha256: hash("A second reviewed drift.\n") }],
      expectedManifestSha256: hash(readFileSync(first.manifestPath)),
    });
    const secondManifest = JSON.parse(readFileSync(second.manifestPath, "utf8"));
    expect(secondManifest.reconciliations).toHaveLength(2);
    expect(secondManifest.reconciliations[0]).toEqual(firstManifest.reconciliations[0]);
    const updated = applySessionRender(plan(value.targetHome, "sumi", "Refreshed instruction."));
    expect(updated.reconciliations).toEqual([]);
    expect(JSON.parse(readFileSync(updated.manifestPath, "utf8")).reconciliations).toEqual(secondManifest.reconciliations);
    expect(restoreSessionRenderSnapshot(updated.snapshotPath!).restored).toBe(true);
    expect(restoreSessionRenderSnapshot(second.snapshotPath!).restored).toBe(true);
    expect(readFileSync(value.file.path, "utf8")).toBe("A second reviewed drift.\n");
  });
});
