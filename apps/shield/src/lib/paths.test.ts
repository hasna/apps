import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptResolverDataRoot,
  getDataRoot,
  getExactDataRoot,
  getHomeDir,
  getLegacyDataRoot,
  getResolverDataRoot,
} from "./paths.js";

describe("shield data-root resolution through @hasna/paths", () => {
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalDataHome: string | undefined;
  let originalExactHome: string | undefined;
  let originalCacheHome: string | undefined;
  let tempRoot: string;

  beforeEach(() => {
    originalHome = process.env["HOME"];
    originalUserProfile = process.env["USERPROFILE"];
    originalDataHome = process.env["HASNA_DATA_HOME"];
    originalExactHome = process.env["HASNA_SHIELD_HOME"];
    originalCacheHome = process.env["HASNA_CACHE_HOME"];
    delete process.env["USERPROFILE"];
    delete process.env["HASNA_DATA_HOME"];
    delete process.env["HASNA_SHIELD_HOME"];
    delete process.env["HASNA_CACHE_HOME"];
    tempRoot = mkdtempSync(join(tmpdir(), "shield-paths-"));
  });

  afterEach(() => {
    restoreEnv("HOME", originalHome);
    restoreEnv("USERPROFILE", originalUserProfile);
    restoreEnv("HASNA_DATA_HOME", originalDataHome);
    restoreEnv("HASNA_SHIELD_HOME", originalExactHome);
    restoreEnv("HASNA_CACHE_HOME", originalCacheHome);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  test("legacy default: ~/.hasna/security stays effective until adoption", () => {
    const home = join(tempRoot, "home");
    process.env["HOME"] = home;

    expect(getHomeDir()).toBe(home);
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "security"));
    expect(getResolverDataRoot()).toBe(join(home, ".local", "share", "hasna", "security"));
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(join(home, ".hasna", "security"));
  });

  test("HASNA_DATA_HOME set adopts the resolver XDG data root", () => {
    const home = join(tempRoot, "home");
    const dataHome = join(tempRoot, "xdg");
    process.env["HOME"] = home;
    process.env["HASNA_DATA_HOME"] = dataHome;

    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    // The app slug (`security`) is appended beneath the data-kind override.
    expect(getResolverDataRoot()).toBe(join(dataHome, "security"));
    expect(getDataRoot()).toBe(join(dataHome, "security"));
  });

  test("shield.db present at the resolver home adopts the XDG root", () => {
    const home = join(tempRoot, "home");
    process.env["HOME"] = home;
    const resolved = getResolverDataRoot();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "shield.db"), "");

    expect(adoptResolverDataRoot(resolved)).toBe(true);
    expect(getDataRoot()).toBe(resolved);
  });

  test("HASNA_SHIELD_HOME exact-app override wins unconditionally", () => {
    const home = join(tempRoot, "home");
    const exact = join(tempRoot, "exact");
    process.env["HOME"] = home;
    process.env["HASNA_SHIELD_HOME"] = exact;

    expect(getExactDataRoot()).toBe(exact);
    expect(getDataRoot()).toBe(exact);
  });

  test("a cache-only HASNA_CACHE_HOME override does not move the data home", () => {
    const home = join(tempRoot, "home");
    process.env["HOME"] = home;
    process.env["HASNA_CACHE_HOME"] = join(tempRoot, "cache");

    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(join(home, ".hasna", "security"));
  });
});
