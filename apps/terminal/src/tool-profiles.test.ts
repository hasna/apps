import { describe, it, expect } from "bun:test";
import { getProfiles, matchProfile, formatProfileHints } from "./tool-profiles.js";

describe("getProfiles", () => {
  it("returns built-in profiles", () => {
    const profiles = getProfiles();
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles.map(p => p.name)).toContain("git");
    expect(profiles.map(p => p.name)).toContain("test");
  });

  it("profiles have required fields", () => {
    const profiles = getProfiles();
    for (const p of profiles) {
      expect(p.name).toBeDefined();
      expect(p.detect).toBeDefined();
    }
  });
});

describe("matchProfile", () => {
  it("matches git commands", () => {
    const profile = matchProfile("git status");
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("git");
  });

  it("matches test commands", () => {
    const profile = matchProfile("bun test");
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("test");
  });

  it("matches build commands", () => {
    const profile = matchProfile("tsc --build");
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("build");
  });

  it("matches lint commands", () => {
    const profile = matchProfile("eslint src/");
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("lint");
  });

  it("returns null for unmatched commands", () => {
    const profile = matchProfile("echo hello");
    expect(profile).toBeNull();
  });

  it("matches find commands", () => {
    const profile = matchProfile("find . -name '*.ts'");
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("find");
  });
});

describe("formatProfileHints", () => {
  it("returns formatted hints for matched profile", () => {
    const hints = formatProfileHints("git status");
    expect(hints).toContain("TOOL PROFILE (git)");
  });

  it("returns empty string for unmatched command", () => {
    const hints = formatProfileHints("echo hello");
    expect(hints).toBe("");
  });
});
