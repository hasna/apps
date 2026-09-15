import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portPortableSkillDirectory } from "./portable-skills";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

function snapshot(root: string): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  const visit = (relative: string) => {
    const path = join(root, relative), stat = lstatSync(path);
    files[relative] = { inode: stat.ino, mode: stat.mode, mtime: stat.mtimeMs,
      ...(stat.isFile() ? { hash: createHash("sha256").update(readFileSync(path)).digest("hex") } : {}) };
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(relative ? relative + "/" + name : name);
  };
  visit(""); return files;
}
function input(root: string, folder: string, name: string, body = "Reviewed local instruction") {
  const path = join(root, folder); mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), "---\nname: " + name + "\ndescription: Owned bulk import fixture\nkind: instruction\n---\n\n" + body + "\n");
  return path;
}

describe("bulk imports after the bundled namespace is retired", () => {
  test("an explicit source imports a formerly reserved slug without changing its bytes", () => {
    const work = mkdtempSync(join(tmpdir(), "bulk-shadow-default-"));
    try {
      const source = join(work, "source"), rootDir = join(work, "installed");
      const skill = input(source, "instruction", "blog-article"), before = snapshot(work);
      const imported = portPortableSkillDirectory(source, { rootDir });
      expect(imported).toMatchObject({ total: 1, succeeded: 1, failed: 0, skipped: [] });
      expect(imported.imported).toEqual([{ name: "blog-article", path: join(rootDir, "blog-article"), sourcePath: skill }]);
      expect(readFileSync(join(rootDir, "blog-article/SKILL.md"), "utf8")).toBe(readFileSync(join(skill, "SKILL.md"), "utf8"));
      expect(snapshot(source)).toEqual(Object.fromEntries(Object.entries(before)
        .filter(([path]) => path === "source" || path.startsWith("source/")).map(([path, value]) => [path === "source" ? "" : path.slice(7), value])));
    } finally { rmSync(work, { recursive: true, force: true }); }
  });

  test("shadow permission preserves collisions, partial failure, overwrite and overlap controls", () => {
    const work = mkdtempSync(join(tmpdir(), "bulk-shadow-controls-"));
    try {
      const source = join(work, "source"), rootDir = join(work, "installed");
      const official = input(source, "a-official", "blog-article");
      input(source, "b-custom", "owned-bulk-custom");
      mkdirSync(join(source, "c-not-a-skill"));
      const initial = portPortableSkillDirectory(source, { rootDir });
      expect(initial).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
      expect(initial.imported.map(row => row.name)).toEqual(["blog-article", "owned-bulk-custom"]);
      const allowed = portPortableSkillDirectory(source, { rootDir, allowShadow: true });
      expect(allowed).toMatchObject({ total: 3, succeeded: 0, failed: 3 });
      expect(allowed.imported).toEqual([]);
      expect(allowed.skipped.map(row => row.reason)).toEqual([
        expect.stringContaining("already exists"), expect.stringContaining("already exists"), expect.stringContaining("Not a skill folder"),
      ]);
      const beforeReplay = snapshot(work);
      expect(portPortableSkillDirectory(source, { rootDir, allowShadow: true })).toMatchObject({ succeeded: 0, failed: 3 });
      expect(() => portPortableSkillDirectory(source, { rootDir, allowShadow: true, continueOnError: false })).toThrow("already exists");
      expect(snapshot(work)).toEqual(beforeReplay);
      writeFileSync(join(official, "SKILL.md"), readFileSync(join(official, "SKILL.md"), "utf8") + "Reviewed revision.\n");
      writeFileSync(join(rootDir, "blog-article/obsolete"), "Explicit replacement required");
      const beforeSource = snapshot(source);
      const replaced = portPortableSkillDirectory(source, { rootDir, allowShadow: true, overwrite: true });
      expect(replaced).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
      expect(replaced.skipped[0]?.reason).toContain("Not a skill folder");
      expect(readFileSync(join(rootDir, "blog-article/SKILL.md"), "utf8")).toBe(readFileSync(join(official, "SKILL.md"), "utf8"));
      expect(existsSync(join(rootDir, "blog-article/obsolete"))).toBe(false);
      expect(snapshot(source)).toEqual(beforeSource);
      const beforeOverlap = snapshot(rootDir);
      const overlap = portPortableSkillDirectory(rootDir, { rootDir, allowShadow: true, overwrite: true });
      expect(overlap).toMatchObject({ succeeded: 0, failed: 2 });
      expect(overlap.skipped.every(row => row.reason.includes("must not overlap"))).toBe(true);
      expect(snapshot(rootDir)).toEqual(beforeOverlap);
    } finally { rmSync(work, { recursive: true, force: true }); }
  });
});
