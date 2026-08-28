import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptResolverDataRoot,
  effectiveHome,
  exactDataRoot,
  getDataRoot,
  legacyDataRoot,
  resolverDataRoot,
  runsDir,
  runbookPromptDir,
} from "./paths.js";

describe("prompts data-root resolution through @hasna/paths", () => {
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalDataHome: string | undefined;
  let originalExactHome: string | undefined;
  let originalExactHomeLegacy: string | undefined;
  let tempRoot: string;

  beforeEach(() => {
    originalHome = process.env["HOME"];
    originalUserProfile = process.env["USERPROFILE"];
    originalDataHome = process.env["HASNA_DATA_HOME"];
    originalExactHome = process.env["HASNA_PROMPTS_HOME"];
    originalExactHomeLegacy = process.env["PROMPTS_HOME"];
    delete process.env["USERPROFILE"];
    delete process.env["HASNA_DATA_HOME"];
    delete process.env["HASNA_PROMPTS_HOME"];
    delete process.env["PROMPTS_HOME"];
    tempRoot = mkdtempSync(join(tmpdir(), "prompts-paths-"));
  });

  afterEach(() => {
    restoreEnv("HOME", originalHome);
    restoreEnv("USERPROFILE", originalUserProfile);
    restoreEnv("HASNA_DATA_HOME", originalDataHome);
    restoreEnv("HASNA_PROMPTS_HOME", originalExactHome);
    restoreEnv("PROMPTS_HOME", originalExactHomeLegacy);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("legacy default: ~/.hasna/prompts stays effective until adoption", () => {
    const home = join(tempRoot, "home");
    process.env["HOME"] = home;

    expect(legacyDataRoot()).toBe(join(home, ".hasna", "prompts"));
    expect(resolverDataRoot()).toBe(join(home, ".local", "share", "hasna", "prompts"));
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(join(home, ".hasna", "prompts"));
    expect(runsDir()).toBe(join(home, ".hasna", "prompts", "runs"));
    // The runbook default preserves the legacy loops-prompt convention.
    expect(runbookPromptDir()).toBe(join(home, ".hasna", "loops", "prompts"));
  });

  test("HASNA_DATA_HOME set adopts the resolver XDG data root", () => {
    const home = join(tempRoot, "home");
    process.env["HOME"] = home;
    process.env["HASNA_DATA_HOME"] = "/srv/hasna-data";

    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(join("/srv/hasna-data", "prompts"));
    expect(runsDir()).toBe(join("/srv/hasna-data", "prompts", "runs"));
    // Once adopted the runbook default points at the adopted root's runbook subdir.
    expect(runbookPromptDir()).toBe(join("/srv/hasna-data", "prompts", "runbook"));
  });

  test("store present at the resolver XDG data root adopts it", () => {
    const home = join(tempRoot, "home");
    process.env["HOME"] = home;
    const resolved = join(home, ".local", "share", "hasna", "prompts");
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "prompts.db"), "migrated");

    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(resolved);
  });

  test("cache-only override does not adopt the data root", () => {
    const home = join(tempRoot, "home");
    process.env["HOME"] = home;
    process.env["HASNA_CACHE_HOME"] = "/srv/hasna-cache";

    // A machine that only redirects cache must not have its data home moved.
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(join(home, ".hasna", "prompts"));
  });

  test("exact-app override wins over both the resolver and the legacy root", () => {
    const home = join(tempRoot, "home");
    process.env["HOME"] = home;
    process.env["HASNA_DATA_HOME"] = "/srv/hasna-data";
    process.env["HASNA_PROMPTS_HOME"] = "/srv/prompts-exact";

    expect(exactDataRoot()).toBe("/srv/prompts-exact");
    expect(getDataRoot()).toBe("/srv/prompts-exact");
    expect(runsDir()).toBe(join("/srv/prompts-exact", "runs"));
    expect(runbookPromptDir()).toBe(join("/srv/prompts-exact", "runbook"));
  });

  test("legacy PROMPTS_HOME exact override is honoured when the primary is blank", () => {
    const home = join(tempRoot, "home");
    process.env["HOME"] = home;
    process.env["HASNA_PROMPTS_HOME"] = "   ";
    process.env["PROMPTS_HOME"] = "/srv/prompts-legacy-exact";

    // A whitespace-only primary must not shadow a valid secondary.
    expect(exactDataRoot()).toBe("/srv/prompts-legacy-exact");
    expect(getDataRoot()).toBe("/srv/prompts-legacy-exact");
  });

  test("effectiveHome falls back to the OS user database", () => {
    process.env["HOME"] = "";
    delete process.env["USERPROFILE"];
    // homedir() returns a non-empty absolute path on any real system.
    expect(effectiveHome().length).toBeGreaterThan(0);
  });

  test("resolver root exists checks do not mutate the filesystem", () => {
    const home = join(tempRoot, "home");
    process.env["HOME"] = home;
    const before = getDataRoot();
    expect(existsSync(before)).toBe(false);
    expect(getDataRoot()).toBe(before);
    expect(existsSync(join(home, ".local", "share", "hasna", "prompts"))).toBe(false);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
