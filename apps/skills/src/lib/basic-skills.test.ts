import { expect, test } from "bun:test";
import { BASIC_SKILL_NAMES, isBasicSkillName, loadBasicRegistry, loadRegistryProfile } from "./registry.js";
import { getSkillBestDoc, getSkillRequirements } from "./skillinfo.js";
import { writeOwnedFixture } from "./private-corpus-test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

test("both compatibility profiles begin empty without an owner's catalog", () => {
  expect(BASIC_SKILL_NAMES).toEqual([]);
  expect(loadBasicRegistry()).toEqual([]); expect(loadRegistryProfile("all")).toEqual([]);
  expect(isBasicSkillName("brand-kit")).toBe(false);
});

test("an owner's instruction skill is usable through either profile without a software allowlist", () => {
  writeOwnedFixture("owner-chosen-fixture");
  for (const profile of ["basic", "all"] as const) {
    expect(loadRegistryProfile(profile)).toHaveLength(1);
    expect(loadRegistryProfile(profile)[0]).toMatchObject({ name: "owner-chosen-fixture", kind: "instruction" });
  }
  expect(getSkillBestDoc("owner-chosen-fixture")).toContain("# Owner Chosen Fixture");
  expect(getSkillRequirements("owner-chosen-fixture")).toMatchObject({ cliCommand: "skills run owner-chosen-fixture", envVars: [], dependencies: {} });
});
