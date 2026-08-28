import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { getDbPath } from "../db/database.js";
import {
  adoptResolverDataRoot,
  getDataRoot,
  getDataRootForHome,
  getExactDataRoot,
  getHomeDir,
  getLegacyDataRoot,
  getResolverDataRoot,
} from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_REPOS_HOME",
  "HASNA_REPOS_DB_PATH",
  "REPOS_DB_PATH",
  "HASNA_REPOS_REQUIRE_EXPLICIT_DB_PATH",
] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let tempHome: string | null = null;
const cleanups: string[] = [];

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved = {};
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (tempHome !== null) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
});

function isolateHome(): string {
  if (tempHome !== null) throw new Error("isolateHome called twice without afterEach");
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  tempHome = mkdtempSync(join(tmpdir(), "repos-paths-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  return tempHome;
}

describe("resolver (XDG) data-root resolution", () => {
  test("home resolves HOME first, then the OS user database", () => {
    const home = isolateHome();
    expect(getHomeDir()).toBe(home);
  });

  test("resolver data root follows @hasna/paths under a fake HOME", () => {
    const home = isolateHome();
    expect(getResolverDataRoot()).toBe(join(home, ".local", "share", "hasna", "repos"));
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "repos"));
  });
});

describe("resolver (XDG) adoption — the legacy home must never become invisible", () => {
  test("legacy ~/.hasna/repos stays the effective root until adopted", () => {
    const home = isolateHome();
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(getLegacyDataRoot());
    // The default db path agrees on the effective root.
    expect(getDbPath()).toBe(join(home, ".hasna", "repos", "repos.db"));
  });

  test("HASNA_DATA_HOME adopts the resolver (XDG) data root", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "repos-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(join(base, "repos"));
    expect(getDbPath()).toBe(join(base, "repos", "repos.db"));
  });

  test("an existing store at the resolver data root adopts it even without HASNA_DATA_HOME", () => {
    const home = isolateHome();
    const xdg = join(home, ".local", "share", "hasna", "repos");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "repos.db"), "existing-migrated-store");
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(xdg);
    expect(getDbPath()).toBe(join(xdg, "repos.db"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "repos-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(join(home, ".hasna", "repos"));
  });

  test("HASNA_REPOS_HOME exact override wins over both roots", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "repos-hasna-home-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "repos-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would adopt the XDG root, but the override must win
    process.env.HASNA_REPOS_HOME = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getDataRoot()).toBe(override);
    expect(getDbPath()).toBe(join(override, "repos.db"));
  });

  test("exact data-root overrides are resolved to absolute paths", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "repos-abs-")); cleanups.push(base);
    const raw = join(base, "..", "repos-abs-rel");
    process.env.HASNA_REPOS_HOME = raw;
    expect(getExactDataRoot()).toBe(resolve(raw));
    expect(getExactDataRoot()?.startsWith("/")).toBe(true);
  });

  test("HASNA_REPOS_DB_PATH file override wins over the effective data root", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "repos-db-path-")); cleanups.push(override);
    const file = join(override, "custom.db");
    process.env.HASNA_REPOS_DB_PATH = file;
    expect(getDbPath()).toBe(resolve(file));
  });
});

describe("getDataRootForHome — explicit-home variant keeps the same gating", () => {
  test("legacy ~/.hasna/repos under the given home until adopted", () => {
    isolateHome();
    const otherHome = mkdtempSync(join(tmpdir(), "repos-other-home-")); cleanups.push(otherHome);
    expect(getDataRootForHome(otherHome)).toBe(join(otherHome, ".hasna", "repos"));
  });

  test("HASNA_REPOS_HOME exact override wins over the home argument", () => {
    isolateHome();
    const otherHome = mkdtempSync(join(tmpdir(), "repos-other-home2-")); cleanups.push(otherHome);
    const override = mkdtempSync(join(tmpdir(), "repos-home-for-")); cleanups.push(override);
    process.env.HASNA_REPOS_HOME = override;
    expect(getDataRootForHome(otherHome)).toBe(override);
  });
});
