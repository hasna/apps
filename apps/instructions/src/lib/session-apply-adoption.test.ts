import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applySessionRender, checkSessionRenderDrift, restoreSessionRenderSnapshot } from "./session-apply.js";
import { planSessionRender, type SessionRenderPlan, type SessionRenderTool } from "./session-render.js";
import { makeTempRoot } from "./test-temp-root.js";

const roots: string[] = [];
function root(): string {
  const value = makeTempRoot("instructions-exact-adoption-");
  roots.push(value);
  return value;
}
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

function hash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
function plan(targetHome: string, tool: SessionRenderTool = "codex", content = "Reviewed instruction."): SessionRenderPlan {
  return planSessionRender({
    tool, profile: "reviewed-profile", targetHome,
    sources: [{ id: "reviewed-source", content }],
    generatedAt: "2026-09-18T00:00:00.000Z",
  });
}
function fixture(tool: SessionRenderTool = "sumi", content = "Existing human-authored instructions.\r\n") {
  const targetHome = root();
  const nativePath = join(targetHome, tool === "claude" ? "CLAUDE.md" : "AGENTS.md");
  writeFileSync(nativePath, content);
  const rendered = plan(targetHome, tool);
  const file = rendered.files.find((entry) => entry.path === nativePath)!;
  return { targetHome, rendered, file, content, adoptFiles: [{ relativePath: file.relativePath, sha256: hash(content) }] };
}

describe("exact observed file adoption", () => {
  test.each(["codex", "sumi", "claude"] as const)("%s adoption snapshots exact preimage, persists source mapping, and restores ownership", (tool) => {
    const value = fixture(tool);
    const originalManifestFile = value.rendered.manifestFile;
    const result = applySessionRender(value.rendered, { adoptFiles: value.adoptFiles });
    expect(result.applied).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.adoptions).toEqual([{
      path: value.file.path,
      relativePath: value.file.relativePath,
      preimageSha256: hash(value.content),
      renderedSha256: value.file.sha256,
      sourceIds: value.file.sourceIds,
    }]);
    expect(result.rollback.status).toBe("available");
    expect(value.rendered.manifestFile).toBe(originalManifestFile);
    expect(value.rendered.manifest.adoptions).toBeUndefined();
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(manifest.adoptions).toEqual(result.adoptions.map(({ path: _path, ...entry }) => entry));
    expect(checkSessionRenderDrift(value.targetHome).clean).toBe(true);
    const snapshot = JSON.parse(readFileSync(result.snapshotPath!, "utf8"));
    expect(snapshot.adoptions).toEqual(result.adoptions);
    expect(snapshot.files.find((entry: { relativePath: string }) => entry.relativePath === value.file.relativePath)).toMatchObject({
      content: value.content, sha256: hash(value.content),
    });
    expect(restoreSessionRenderSnapshot(result.snapshotPath!).restored).toBe(true);
    expect(readFileSync(value.file.path)).toEqual(Buffer.from(value.content));
    expect(existsSync(result.manifestPath)).toBe(false);
  });

  test("dry run validates exact adoption without snapshots or authority changes", () => {
    const value = fixture();
    const result = applySessionRender(value.rendered, { dryRun: true, adoptFiles: value.adoptFiles });
    expect(result.applied).toBe(false);
    expect(result.adoptions).toHaveLength(1);
    expect(result.files[0]!.action).toBe("update");
    expect(result.snapshotPath).toBeNull();
    expect(readFileSync(value.file.path, "utf8")).toBe(value.content);
    expect(existsSync(value.rendered.manifestFile.path)).toBe(false);
  });

  test("identical unmanaged content still receives a before-image and restores to unmanaged", () => {
    const targetHome = root();
    const rendered = plan(targetHome, "sumi");
    const file = rendered.files[0]!;
    writeFileSync(file.path, file.content);
    const result = applySessionRender(rendered, { adoptFiles: [{ relativePath: file.relativePath, sha256: file.sha256 }] });
    expect(result.files[0]).toMatchObject({ action: "update", changed: false });
    expect(result.snapshotPath).not.toBeNull();
    expect(restoreSessionRenderSnapshot(result.snapshotPath!).restored).toBe(true);
    expect(readFileSync(file.path, "utf8")).toBe(file.content);
    expect(existsSync(result.manifestPath)).toBe(false);
  });

  test("retains original adoption provenance through later renders and restore", () => {
    const value = fixture();
    const first = applySessionRender(value.rendered, { adoptFiles: value.adoptFiles });
    const manifestBefore = readFileSync(first.manifestPath, "utf8");
    const next = applySessionRender(plan(value.targetHome, "sumi", "Updated reviewed instruction."));
    expect(next.applied).toBe(true);
    expect(next.adoptions).toEqual([]);
    expect(JSON.parse(readFileSync(next.manifestPath, "utf8")).adoptions).toEqual(JSON.parse(manifestBefore).adoptions);
    expect(restoreSessionRenderSnapshot(next.snapshotPath!).restored).toBe(true);
    expect(readFileSync(next.manifestPath, "utf8")).toBe(manifestBefore);
    expect(restoreSessionRenderSnapshot(first.snapshotPath!).restored).toBe(true);
    expect(readFileSync(value.file.path, "utf8")).toBe(value.content);
  });

  test("rejects stale hashes without writing", () => {
    const value = fixture();
    writeFileSync(value.file.path, "Changed after review.");
    expect(() => applySessionRender(value.rendered, { adoptFiles: value.adoptFiles })).toThrow("SHA-256 precondition failed");
    expect(readFileSync(value.file.path, "utf8")).toBe("Changed after review.");
    expect(existsSync(value.rendered.manifestFile.path)).toBe(false);
  });

  test("rejects unknown, noncanonical, outside, missing and manifest targets", () => {
    const value = fixture();
    for (const relativePath of ["unrelated.md", "./AGENTS.md", "../AGENTS.md", value.file.path, ".hasna/session-render-manifest.json"]) {
      expect(() => applySessionRender(value.rendered, { adoptFiles: [{ relativePath, sha256: hash(value.content) }] })).toThrow("not a unique planned instruction output");
    }
    rmSync(value.file.path);
    expect(() => applySessionRender(value.rendered, { adoptFiles: value.adoptFiles })).toThrow("does not exist");
    expect(existsSync(value.rendered.manifestFile.path)).toBe(false);
  });

  test("rejects duplicate targets, invalid hashes, and force combinations", () => {
    const value = fixture();
    expect(() => applySessionRender(value.rendered, { adoptFiles: [...value.adoptFiles, ...value.adoptFiles] })).toThrow("Duplicate file adoption target");
    for (const sha256 of ["", "not-a-hash", "a".repeat(63), "A".repeat(64)]) {
      expect(() => applySessionRender(value.rendered, { adoptFiles: [{ relativePath: value.file.relativePath, sha256 }] })).toThrow("64-character lowercase SHA-256");
    }
    expect(() => applySessionRender(value.rendered, { force: true, adoptFiles: value.adoptFiles })).toThrow("cannot be combined with force");
    expect(readFileSync(value.file.path, "utf8")).toBe(value.content);
  });

  test("rejects managed targets even when the requested hash matches local drift", () => {
    const targetHome = root();
    const rendered = plan(targetHome);
    expect(applySessionRender(rendered).applied).toBe(true);
    for (const content of [rendered.files[0]!.content, "Locally drifted managed content."]) {
      writeFileSync(rendered.files[0]!.path, content);
      expect(() => applySessionRender(plan(targetHome), { adoptFiles: [{ relativePath: "AGENTS.md", sha256: hash(content) }] })).toThrow("already managed");
      expect(readFileSync(rendered.files[0]!.path, "utf8")).toBe(content);
    }
  });

  test("does not bypass an unrelated unmanaged conflict", () => {
    const value = fixture("opencode");
    writeFileSync(join(value.targetHome, "opencode.json"), '{"unmanaged":true}\n');
    const result = applySessionRender(value.rendered, { adoptFiles: value.adoptFiles });
    expect(result.applied).toBe(false);
    expect(result.conflicts.map((entry) => entry.relativePath)).toContain("opencode.json");
    expect(result.snapshotPath).toBeNull();
    expect(readFileSync(value.file.path, "utf8")).toBe(value.content);
    expect(existsSync(result.manifestPath)).toBe(false);
  });

  test("rejects symlinks without changing the referenced file", () => {
    const value = fixture();
    const outside = join(root(), "original.md");
    writeFileSync(outside, value.content);
    rmSync(value.file.path);
    symlinkSync(outside, value.file.path);
    expect(() => applySessionRender(value.rendered, { adoptFiles: value.adoptFiles })).toThrow("symlink");
    expect(readFileSync(outside, "utf8")).toBe(value.content);
    expect(existsSync(value.rendered.manifestFile.path)).toBe(false);
  });

  test("rejects non-UTF8 preimages rather than producing a lossy snapshot", () => {
    const value = fixture();
    const bytes = Buffer.from([0xff, 0x00, 0x80]);
    writeFileSync(value.file.path, bytes);
    expect(() => applySessionRender(value.rendered, { adoptFiles: [{ relativePath: value.file.relativePath, sha256: hash(bytes) }] })).toThrow("losslessly restorable UTF-8");
    expect(readFileSync(value.file.path)).toEqual(bytes);
  });

  test("rechecks adopted preimages immediately before replacement", () => {
    const value = fixture();
    expect(() => applySessionRender(value.rendered, {
      adoptFiles: value.adoptFiles,
      test_hooks: { before_apply_writes: () => writeFileSync(value.file.path, "Concurrent edit.") },
    })).toThrow("changed after planning");
    expect(readFileSync(value.file.path, "utf8")).toBe("Concurrent edit.");
    expect(existsSync(value.rendered.manifestFile.path)).toBe(false);
  });

  test("restore refuses to overwrite edits made after adoption", () => {
    const value = fixture();
    const result = applySessionRender(value.rendered, { adoptFiles: value.adoptFiles });
    writeFileSync(value.file.path, "Edit after adoption.");
    const restored = restoreSessionRenderSnapshot(result.snapshotPath!);
    expect(restored.restored).toBe(false);
    expect(restored.conflicts.map((entry) => entry.relativePath)).toContain(value.file.relativePath);
    expect(readFileSync(value.file.path, "utf8")).toBe("Edit after adoption.");
  });
});

describe("manifest compare-and-swap precondition", () => {
  test("accepts the exact observed manifest and rejects missing, malformed or stale preconditions", () => {
    const targetHome = root();
    const rendered = plan(targetHome);
    expect(() => applySessionRender(plan(targetHome), { expectedManifestSha256: "0".repeat(64) })).toThrow("manifest SHA-256 precondition failed");
    expect(existsSync(rendered.files[0]!.path)).toBe(false);
    expect(applySessionRender(rendered).applied).toBe(true);
    const observedHash = hash(readFileSync(rendered.manifestFile.path));
    expect(() => applySessionRender(plan(targetHome), { expectedManifestSha256: "invalid" })).toThrow("64 lowercase hexadecimal");
    expect(() => applySessionRender(plan(targetHome), { expectedManifestSha256: "0".repeat(64) })).toThrow("manifest SHA-256 precondition failed");
    const updated = plan(targetHome, "codex", "Refreshed from hosted sources.");
    expect(applySessionRender(updated, { expectedManifestSha256: observedHash }).applied).toBe(true);
    expect(() => applySessionRender(plan(targetHome), { expectedManifestSha256: observedHash })).toThrow("manifest SHA-256 precondition failed");
    expect(readFileSync(rendered.files[0]!.path, "utf8")).toContain("Refreshed from hosted sources.");
  });

  test("rechecks manifest before any payload replacement", () => {
    const targetHome = root();
    const rendered = plan(targetHome);
    expect(applySessionRender(rendered).applied).toBe(true);
    const observedHash = hash(readFileSync(rendered.manifestFile.path));
    const payloadBefore = readFileSync(rendered.files[0]!.path, "utf8");
    const updated = plan(targetHome, "codex", "Refresh must be blocked.");
    expect(() => applySessionRender(updated, {
      expectedManifestSha256: observedHash,
      test_hooks: { before_apply_writes: () => writeFileSync(rendered.manifestFile.path, "Concurrent authority change.\n") },
    })).toThrow("manifest SHA-256 precondition failed");
    expect(readFileSync(rendered.files[0]!.path, "utf8")).toBe(payloadBefore);
    expect(readFileSync(rendered.manifestFile.path, "utf8")).toBe("Concurrent authority change.\n");
  });
});
