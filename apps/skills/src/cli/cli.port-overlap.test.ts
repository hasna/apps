import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { runCliInCwd } from "./cli.test-utils";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

function seed(path: string, label: string) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), `---\nname: owned-overlap\nkind: instruction\ndescription: ${label}\n---\n${label}\n`);
  writeFileSync(join(path, "resource.bin"), Buffer.from([0, 255, 1, label.length]));
}
function snapshot(root: string) {
  const files: Record<string, unknown> = {};
  const visit = (path: string) => {
    const s = lstatSync(path), name = relative(root, path);
    files[name] = { mode: s.mode, inode: s.ino, mtimeMs: s.mtimeMs,
      ...(s.isSymbolicLink() ? { target: readlinkSync(path) } : s.isFile() ? { sha256: createHash("sha256").update(readFileSync(path)).digest("hex") } : {}) };
    if (s.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
  };
  visit(root); return files;
}

for (const mode of ["same", "relative-same", "source-within-target", "target-within-source", "absent-target-within-source", "source-symlink", "destination-symlink", "target-parent-symlink", "app-data-with-legacy-child"] as const) {
  test(`port refuses ${mode} before touching owned source or destination`, async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-port-overlap-")), protectedRoot = join(root, "protected"), home = join(root, "home"), cwd = join(root, "project");
    mkdirSync(protectedRoot); mkdirSync(home); mkdirSync(cwd);
    let data = join(protectedRoot, "data"), destination = join(data, "installed/owned-overlap"), source = destination;
    try {
      if (mode === "target-within-source" || mode === "absent-target-within-source") { source = join(protectedRoot, "source"); data = join(source, "nested-data"); destination = join(data, "installed/owned-overlap"); seed(source, "Source retained"); }
      if (mode !== "absent-target-within-source") seed(destination, "Old destination retained");
      if (mode === "source-within-target") { source = join(destination, "nested-source"); seed(source, "Nested source retained"); }
      if (mode === "destination-symlink") { source = join(protectedRoot, "source"); seed(source, "Source retained"); rmSync(destination, { recursive: true }); symlinkSync(source, destination, "dir"); }
      if (mode === "source-symlink") { source = join(protectedRoot, "source-alias"); symlinkSync(destination, source, "dir"); }
      if (mode === "target-parent-symlink") { const alias = join(protectedRoot, "data-alias"); symlinkSync(data, alias, "dir"); data = alias; }
      if (mode === "app-data-with-legacy-child") { rmSync(data, { recursive: true }); source = data; seed(source, "App data source retained"); seed(join(data, "legacy-child"), "Legacy child retained"); }
      if (mode === "relative-same") source = relative(cwd, source);
      writeFileSync(join(protectedRoot, "unrelated.txt"), "preserve neighbor\n");
      const before = snapshot(protectedRoot);
      const result = await runCliInCwd(["port", source, "--name", "owned-overlap", "--overwrite", "--json"], cwd, { HOME: home, HASNA_SKILLS_DIR: data, SKILLS_DATA_DIR: data });
      expect(result.stdout, result.stderr).not.toBe("");
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout).error).toBe("Source and destination skill directories must not overlap");
      expect(snapshot(protectedRoot)).toEqual(before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("port overwrite replaces only its disjoint target and allows prefix-sharing neighbors", async () => {
  const root = mkdtempSync(join(tmpdir(), "skills-port-disjoint-")), data = join(root, "data"), home = join(root, "home"), cwd = join(root, "project");
  const destination = join(data, "installed/owned-overlap"), source = join(data, "installed/owned-overlap-source"), neighbor = join(data, "installed/owned-overlap-neighbor");
  mkdirSync(home); mkdirSync(cwd);
  try {
    seed(destination, "Old target"); writeFileSync(join(destination, "obsolete.txt"), "remove only this\n"); seed(source, "Replacement source"); seed(neighbor, "Neighbor retained");
    const sourceBefore = snapshot(source), neighborBefore = snapshot(neighbor);
    const result = await runCliInCwd(["port", source, "--name", "owned-overlap", "--overwrite", "--json"], cwd, { HOME: home, HASNA_SKILLS_DIR: data, SKILLS_DATA_DIR: data });
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ name: "owned-overlap", path: destination, valid: true });
    expect(readFileSync(join(destination, "resource.bin"))).toEqual(readFileSync(join(source, "resource.bin")));
    expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toContain("Replacement source"); expect(existsSync(join(destination, "obsolete.txt"))).toBe(false);
    expect(snapshot(source)).toEqual(sourceBefore); expect(snapshot(neighbor)).toEqual(neighborBefore);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("disjoint port still migrates legacy skills into the corpus", async () => {
  const root = mkdtempSync(join(tmpdir(), "skills-port-legacy-"));
  const data = join(root, "data"), home = join(root, "home"), cwd = join(root, "project");
  const source = join(root, "source"), legacy = join(data, "legacy-child");
  mkdirSync(home); mkdirSync(cwd);
  try {
    seed(source, "New import"); seed(legacy, "Legacy retained");
    const before = snapshot(legacy);
    const result = await runCliInCwd(["port", source, "--name", "owned-overlap", "--json"], cwd,
      { HOME: home, HASNA_SKILLS_DIR: data, SKILLS_DATA_DIR: data });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).valid).toBe(true);
    expect(readFileSync(join(data, "installed/legacy-child/SKILL.md"))).toEqual(readFileSync(join(legacy, "SKILL.md")));
    expect(readFileSync(join(data, "installed/owned-overlap/SKILL.md"), "utf8")).toContain("New import");
    expect(snapshot(legacy)).toEqual(before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
