import { expect, test } from "bun:test";
import { getDataDir } from "./config.js";
import { getSkill } from "./registry.js";
import { installSkill, removeSkill, getInstalledSkills } from "./installer.js";
import { SKILL_ALIASES, normalizeSkillSlug, resolveSkillAlias } from "./skill-aliases.js";
import { writeOwnedFixture } from "./private-corpus-test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

test("the software never redirects a user's slug through former corpus aliases", () => {
  expect(SKILL_ALIASES).toEqual({});
  for (const name of ["create-blog-article", "generate-pdf"]) {
    expect(normalizeSkillSlug(name)).toBe(name); expect(resolveSkillAlias(name)).toBe(name);
    expect(getSkill(name)).toBeUndefined();
  }
});

test("a former alias is usable as an owner's exact identity without rewriting project pins", () => {
  writeOwnedFixture("create-blog-article");
  const targetDir = getDataDir();
  expect(getSkill("create-blog-article")?.name).toBe("create-blog-article");
  expect(installSkill("create-blog-article", { targetDir })).toMatchObject({ success: true, skill: "create-blog-article" });
  expect(getInstalledSkills(targetDir)).toEqual(["create-blog-article"]);
  expect(removeSkill("create-blog-article", targetDir)).toBe(true);
  expect(getInstalledSkills(targetDir)).toEqual([]);
});
