import { afterEach, describe, expect, test } from "bun:test";
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
} from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_MEMENTOS_HOME",
  "MEMENTOS_HOME",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let tempHome: string | null = null;
const cleanups: string[] = [];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (key in saved) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Point $HOME at a fresh temp dir and clear every path-affecting override. */
function isolateHome(): string {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  const home = mkdtempSync(join(tmpdir(), "mementos-data-root-"));
  tempHome = home;
  process.env.HOME = home;
  delete process.env.USERPROFILE;
  delete process.env.HASNA_MEMENTOS_HOME;
  delete process.env.MEMENTOS_HOME;
  delete process.env.HASNA_DATA_HOME;
  delete process.env.HASNA_CACHE_HOME;
  return home;
}

describe("resolver (XDG) adoption — the legacy home must never become invisible", () => {
  test("resolver data dir follows @hasna/paths under a fake HOME", () => {
    const home = isolateHome();
    expect(resolverDataRoot()).toBe(join(home, ".local", "share", "hasna", "mementos"));
    expect(legacyDataRoot()).toBe(join(home, ".hasna", "mementos"));
    expect(effectiveHome()).toBe(home);
  });

  test("legacy ~/.hasna/mementos stays the effective root until adopted", () => {
    const home = isolateHome();
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(join(home, ".hasna", "mementos"));
  });

  test("HASNA_DATA_HOME adopts the resolver (XDG) data root", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "mementos-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(join(base, "mementos"));
  });

  test("an existing store at the resolver data root adopts it even without HASNA_DATA_HOME", () => {
    const home = isolateHome();
    const xdg = join(home, ".local", "share", "hasna", "mementos");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "mementos.db"), "existing-migrated-store");
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(xdg);
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data root", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "mementos-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(join(home, ".hasna", "mementos"));
  });

  test("an empty HASNA_DATA_HOME is treated as unset", () => {
    const home = isolateHome();
    process.env.HASNA_DATA_HOME = "";
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(join(home, ".hasna", "mementos"));
  });

  test("exact-app overrides win over both roots, in priority order", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "mementos-exact-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "mementos-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would adopt the XDG root, but the override must win
    process.env.HASNA_MEMENTOS_HOME = override;
    expect(exactDataRoot()).toBe(override);
    expect(getDataRoot()).toBe(override);
  });

  test("the MEMENTOS_HOME override also wins over the default", () => {
    const home = isolateHome();
    const legacyOverride = mkdtempSync(join(tmpdir(), "mementos-home-")); cleanups.push(legacyOverride);
    process.env.MEMENTOS_HOME = legacyOverride;
    expect(exactDataRoot()).toBe(legacyOverride);
    expect(getDataRoot()).toBe(legacyOverride);
  });

  test("an empty exact-app override is treated as unset and does not shadow a secondary", () => {
    const home = isolateHome();
    const secondary = mkdtempSync(join(tmpdir(), "mementos-secondary-")); cleanups.push(secondary);
    process.env.HASNA_MEMENTOS_HOME = "";
    process.env.MEMENTOS_HOME = secondary;
    expect(exactDataRoot()).toBe(secondary);
    expect(getDataRoot()).toBe(secondary);
  });

  test("a blank primary does not shadow a valid secondary", () => {
    const home = isolateHome();
    const secondary = mkdtempSync(join(tmpdir(), "mementos-secondary2-")); cleanups.push(secondary);
    process.env.HASNA_MEMENTOS_HOME = "   ";
    process.env.MEMENTOS_HOME = secondary;
    expect(exactDataRoot()).toBe(secondary);
    expect(getDataRoot()).toBe(secondary);
  });

  test("default resolution never creates either home", () => {
    const home = isolateHome();
    getDataRoot();
    expect(existsSync(join(home, ".hasna", "mementos"))).toBe(false);
    expect(existsSync(join(home, ".local", "share", "hasna", "mementos"))).toBe(false);
  });
});
