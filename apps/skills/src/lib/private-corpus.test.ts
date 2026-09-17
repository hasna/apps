import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { useDefaultTestTimeout, withTempHome } from "../test-preload.js";
import { getDataDir, loadConfigReadOnly } from "./config.js";
import { getSkillPath, skillExists } from "./installer.js";
import { getPortableSkillsRoot, scaffoldPortableSkill } from "./portable-skills.js";
import { BASIC_SKILL_NAMES, SKILLS, clearRegistryCache, loadRegistry, loadRegistryProfile } from "./registry.js";
import { SKILL_ALIASES } from "./skill-aliases.js";

useDefaultTestTimeout();

function document(root: string, slug: string) {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: Synthetic private corpus fixture\nkind: instruction\n---\n# Synthetic instructions\n`);
}

test("the public repository does not track operational skill documents", () => {
  const repository = resolve(import.meta.dir, "../../../..");
  const result = Bun.spawnSync(["git", "ls-files", "-z", "--", "**/SKILL.md"], { cwd: repository });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().split("\0").filter(Boolean)).toEqual([]);
});

test("the software contains no default skill catalog, selection, or aliases", () => {
  expect(SKILLS).toEqual([]);
  expect(BASIC_SKILL_NAMES).toEqual([]);
  expect(SKILL_ALIASES).toEqual({});
});

test("ordinary discovery never imports legacy flat or custom folders", () => {
  const data = getDataDir();
  document(data, "legacy-flat-fixture");
  document(join(data, "custom"), "legacy-custom-fixture");
  document(join(data, "installed"), "owned-cache-fixture");
  clearRegistryCache();
  const names = loadRegistry().map((skill) => skill.name);
  expect(names).toContain("owned-cache-fixture");
  expect(names).not.toContain("legacy-flat-fixture");
  expect(names).not.toContain("legacy-custom-fixture");
  for (const slug of ["legacy-flat-fixture", "legacy-custom-fixture"]) {
    expect(existsSync(join(getPortableSkillsRoot(), slug))).toBe(false);
  }
  expect(existsSync(join(data, "legacy-flat-fixture", "SKILL.md"))).toBe(true);
  expect(existsSync(join(data, "custom", "legacy-custom-fixture", "SKILL.md"))).toBe(true);
});

test("a name missing from the owned cache cannot resolve into a repository corpus", () => {
  const root = getPortableSkillsRoot();
  expect(getSkillPath("blog-article").startsWith(root + sep)).toBe(true);
  expect(skillExists("blog-article")).toBe(false);
});

test("an explicitly authored local skill is discoverable without a shipped selection", () => {
  scaffoldPortableSkill("owned-authoring-fixture", { kind: "instruction" });
  clearRegistryCache();
  for (const profile of ["basic", "all"] as const) {
    expect(loadRegistryProfile(profile).map((skill) => skill.name)).toEqual(["owned-authoring-fixture"]);
  }
});

test("legacy home config and payloads cannot reactivate a removed source", () => {
  withTempHome((home) => {
    document(join(home, ".skills"), "retired-home-fixture");
    writeFileSync(join(home, ".skillsrc"), JSON.stringify({ extensionsDir: join(home, ".skills") }));
    expect(loadConfigReadOnly()).toEqual({});
    const data = getDataDir();
    expect(existsSync(join(data, "retired-home-fixture"))).toBe(false);
    expect(existsSync(join(data, "config.json"))).toBe(false);
    clearRegistryCache();
    expect(loadRegistry()).toEqual([]);
    expect(existsSync(join(home, ".skills", "retired-home-fixture", "SKILL.md"))).toBe(true);
  });
});

test("switching a supported home alias cannot reuse the previous owner's cached catalog", () => {
  const scratch = getDataDir();
  const previousDir = process.env.HASNA_SKILLS_DIR;
  const previousAlias = process.env.HASNA_SKILLS_HOME;
  const first = join(scratch, "first-home"), second = join(scratch, "second-home");
  document(join(first, "installed"), "first-private-fixture");
  document(join(second, "installed"), "second-private-fixture");
  delete process.env.HASNA_SKILLS_DIR;
  try {
    process.env.HASNA_SKILLS_HOME = first;
    clearRegistryCache();
    expect(loadRegistry().map(s => s.name)).toEqual(["first-private-fixture"]);
    process.env.HASNA_SKILLS_HOME = second;
    expect(loadRegistry().map(s => s.name)).toEqual(["second-private-fixture"]);
  } finally {
    if (previousDir === undefined) delete process.env.HASNA_SKILLS_DIR;
    else process.env.HASNA_SKILLS_DIR = previousDir;
    if (previousAlias === undefined) delete process.env.HASNA_SKILLS_HOME;
    else process.env.HASNA_SKILLS_HOME = previousAlias;
    clearRegistryCache();
  }
});
