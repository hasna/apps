/**
 * The routing preamble: local mode is opt-in only, and the opt-in is answered
 * on env values alone.
 *
 * These tests are hermetic — no `security` is spawned and the login keychain is
 * never opened. They assert the DECISION the resolver seam is handed: which
 * environments select the on-machine run, which are treated as authority
 * intent, and that the opt-in never outranks a configured environment.
 */
import { describe, expect, test } from "bun:test";
import {
  hasSkillsEnvAuthorityIntent,
  isSkillsLocalOptIn,
  selectsSkillsLocalMode,
  skillsAuthorityEnvKeys,
  SKILLS_LOCAL_OPT_IN_ENV_KEYS,
} from "./local-opt-in.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("SKILLS_LOCAL_OPT_IN_ENV_KEYS", () => {
  test("names the canonical opt-in first and its silent alias second", () => {
    expect(SKILLS_LOCAL_OPT_IN_ENV_KEYS[0]).toBe("HASNA_SKILLS_LOCAL");
    expect(SKILLS_LOCAL_OPT_IN_ENV_KEYS[1]).toBe("SKILLS_LOCAL");
  });
});

describe("isSkillsLocalOptIn", () => {
  test("any non-blank value on either key is an opt-in", () => {
    for (const key of SKILLS_LOCAL_OPT_IN_ENV_KEYS) {
      expect(isSkillsLocalOptIn({ [key]: "1" })).toBe(true);
      expect(isSkillsLocalOptIn({ [key]: "yes" })).toBe(true);
    }
  });

  test("blank counts as absent, matching the resolver's blank-means-unset rule", () => {
    for (const key of SKILLS_LOCAL_OPT_IN_ENV_KEYS) {
      expect(isSkillsLocalOptIn({ [key]: "" })).toBe(false);
      expect(isSkillsLocalOptIn({ [key]: "   " })).toBe(false);
    }
    expect(isSkillsLocalOptIn({})).toBe(false);
  });
});

describe("hasSkillsEnvAuthorityIntent", () => {
  test("every resolver-derived authority and credential name counts, blank does not", () => {
    for (const key of skillsAuthorityEnvKeys()) {
      expect(hasSkillsEnvAuthorityIntent({ [key]: "configured-value" })).toBe(true);
      expect(hasSkillsEnvAuthorityIntent({ [key]: "  " })).toBe(false);
    }
  });

  test("is narrower than 'a credential resolves': it never touches the Keychain or disk", () => {
    // The canonical pair, the override, the pointer and the profile name are
    // all env-only signals; HASNA_SKILLS_LOCAL itself is not one of them.
    const keys = skillsAuthorityEnvKeys();
    expect(keys).toContain("HASNA_SKILLS_API_KEY");
    expect(keys).toContain("HASNA_SKILLS_API_URL");
    expect(keys).toContain("HASNA_SKILLS_API_KEY_OVERRIDE");
    expect(keys).toContain("HASNA_SKILLS_API_KEY_REF");
    expect(keys).toContain("HASNA_PROFILE");
    expect(keys).not.toContain(SKILLS_LOCAL_OPT_IN_ENV_KEYS[0]);
    expect(hasSkillsEnvAuthorityIntent({ HASNA_SKILLS_LOCAL: "1" })).toBe(false);
  });
});

describe("selectsSkillsLocalMode", () => {
  test("requires BOTH the opt-in and the absence of any authority intent", () => {
    expect(selectsSkillsLocalMode({ HASNA_SKILLS_LOCAL: "1" })).toBe(true);
    expect(selectsSkillsLocalMode({ SKILLS_LOCAL: "1" })).toBe(true);
    expect(selectsSkillsLocalMode({})).toBe(false);
    expect(selectsSkillsLocalMode({ HASNA_SKILLS_LOCAL: "1", HASNA_SKILLS_API_KEY: "fixture-env-key" })).toBe(false);
    expect(selectsSkillsLocalMode({ HASNA_SKILLS_LOCAL: "1", HASNA_SKILLS_API_URL: "https://skills.internal.example" })).toBe(false);
  });
});