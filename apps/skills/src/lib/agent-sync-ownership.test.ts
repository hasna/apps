import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
type OwnershipApi = Pick<typeof import("./agent-sync.js"), "writeManagedSkillDir" | "removeManagedAgentSkill">;
const installed = process.env.SKILLS_SYNC_OWNERSHIP_TEST_PACKAGE;
const api: OwnershipApi = installed
  ? await import(pathToFileURL(join(installed, "dist/index.js")).href)
  : await import("./agent-sync.js");
const markerName = ".hasna-skills.json";
const markers = {
  unmarked: undefined,
  foreign: JSON.stringify({ managedBy: "another-tool" }),
  malformed: "{ invalid JSON\n",
  wrongCase: JSON.stringify({ managedBy: "@hasna/Skills" }),
  trailingSpace: JSON.stringify({ managedBy: "@hasna/skills " }),
  missingOwner: JSON.stringify({ source: "adopted" }),
  null: "null",
  directory: undefined,
  owned: JSON.stringify({ managedBy: "@hasna/skills", source: "adopted" }),
};
type MarkerKind = keyof typeof markers;
function snapshot(path: string): unknown {
  const stat = lstatSync(path);
  if (stat.isDirectory()) return [stat.mode, stat.ino, stat.mtimeMs, readdirSync(path).sort().map(name => [name, snapshot(join(path, name))])];
  if (!stat.isFile()) throw new Error("Unexpected fixture file");
  return [stat.mode, stat.ino, stat.mtimeMs, createHash("sha256").update(readFileSync(path)).digest("hex")];
}
function seed(dir: string, kind: MarkerKind, withSkill = true) {
  mkdirSync(dir, { recursive: true });
  if (withSkill) writeFileSync(join(dir, "SKILL.md"), "Existing local content\n", { mode: 0o640 });
  writeFileSync(join(dir, "keep.txt"), "Existing local resource\n", { mode: 0o600 });
  if (kind === "directory") mkdirSync(join(dir, markerName));
  else if (markers[kind] !== undefined) writeFileSync(join(dir, markerName), markers[kind]!, { mode: 0o640 });
}

for (const kind of Object.keys(markers) as MarkerKind[]) {
  test(`writer requires exact ownership or explicit force for ${kind} marker`, () => {
    const root = mkdtempSync(join(tmpdir(), "skills-write-ownership-"));
    try {
      const source = join(root, "source"); mkdirSync(source);
      writeFileSync(join(source, "resource.txt"), "Canonical resource\n", { mode: 0o640 });
      const sourceBefore = snapshot(source);
      for (const force of [false, true]) for (const dryRun of [true, false]) for (const withSkill of [true, false]) {
        const target = join(root, `${force}-${dryRun}-${withSkill}`); seed(target, kind, withSkill);
        const before = snapshot(root), authorized = kind === "owned" || (force && withSkill);
        const result = api.writeManagedSkillDir(target, "Canonical content\n", { skill: "owned-fixture", source: "source", resourceDir: source, force, dryRun });
        expect(result.action).toBe(authorized ? "update" : "skip");
        expect(result.path).toBe(join(target, "SKILL.md"));
        expect(snapshot(source)).toEqual(sourceBefore);
        if (!authorized || dryRun) {
          expect(snapshot(root)).toEqual(before);
          if (!authorized) expect(result.reason).toContain("unmanaged");
        } else {
          expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("Canonical content\n");
          expect(readFileSync(join(target, "resource.txt"), "utf8")).toBe("Canonical resource\n");
          expect(existsSync(join(target, "keep.txt"))).toBe(false);
          expect(JSON.parse(readFileSync(join(target, markerName), "utf8"))).toMatchObject({ managedBy: "@hasna/skills", skill: "owned-fixture", source: "source" });
        }
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test(`removal preserves every directory without an exact owned marker: ${kind}`, () => {
    const home = mkdtempSync(join(tmpdir(), "skills-remove-ownership-"));
    try {
      const target = join(home, ".codex", "skills", "target"), unrelated = join(home, ".codex", "skills", "unrelated");
      seed(target, kind); seed(unrelated, "owned");
      const before = snapshot(home), unrelatedBefore = snapshot(unrelated);
      const removed = api.removeManagedAgentSkill("target", "codex", home);
      expect(removed).toBe(kind === "owned");
      expect(existsSync(target)).toBe(kind !== "owned");
      expect(snapshot(unrelated)).toEqual(unrelatedBefore);
      if (kind !== "owned") expect(snapshot(home)).toEqual(before);
      else expect(api.removeManagedAgentSkill("target", "codex", home)).toBe(false);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}
