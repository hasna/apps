import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  adoptResolverDataRoot,
  getDataRoot,
  getDbPath,
  getExactDataRoot,
  getHomeDir,
  getLegacyDataRoot,
  getResolverDataRoot,
} from "./paths.js";
import { defaultDataDir, defaultDbPath } from "./util.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_SNAPSHOTS_DIR",
  "HASNA_SNAPSHOTS_DB_PATH",
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
  tempHome = mkdtempSync(join(tmpdir(), "snapshots-paths-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  return tempHome;
}

describe("resolver (XDG) data-home resolution", () => {
  test("home resolves HOME first, then the OS user database", () => {
    const home = isolateHome();
    expect(getHomeDir()).toBe(home);
  });

  test("resolver data home follows @hasna/paths under a fake HOME", () => {
    const home = isolateHome();
    expect(getResolverDataRoot()).toBe(join(home, ".local", "share", "hasna", "snapshots"));
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "snapshots"));
  });
});

describe("resolver (XDG) adoption — the legacy home must never become invisible", () => {
  test("legacy ~/.hasna/snapshots stays the effective home until adopted", () => {
    const home = isolateHome();
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(getLegacyDataRoot());
    expect(defaultDataDir()).toBe(join(home, ".hasna", "snapshots"));
    // The default store path agrees on the effective home.
    expect(defaultDbPath()).toBe(join(home, ".hasna", "snapshots", "snapshots.sqlite"));
  });

  test("HASNA_DATA_HOME adopts the resolver (XDG) data home", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "snapshots-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(join(base, "snapshots"));
    expect(defaultDataDir()).toBe(join(base, "snapshots"));
    expect(defaultDbPath()).toBe(join(base, "snapshots", "snapshots.sqlite"));
  });

  test("an existing store at the resolver data home adopts it even without HASNA_DATA_HOME", () => {
    const home = isolateHome();
    const xdg = join(home, ".local", "share", "hasna", "snapshots");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "snapshots.sqlite"), "existing-migrated-store");
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(xdg);
    expect(defaultDbPath()).toBe(join(xdg, "snapshots.sqlite"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "snapshots-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(join(home, ".hasna", "snapshots"));
  });

  test("HASNA_SNAPSHOTS_DIR exact override wins over both roots", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "snapshots-hasna-dir-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "snapshots-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would adopt the XDG root, but the override must win
    process.env.HASNA_SNAPSHOTS_DIR = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getDataRoot()).toBe(override);
    expect(defaultDataDir()).toBe(override);
    expect(defaultDbPath()).toBe(join(override, "snapshots.sqlite"));
  });

  test("exact data-home overrides are resolved to absolute paths", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "snapshots-abs-")); cleanups.push(base);
    const raw = join(base, "..", "snapshots-abs-rel");
    process.env.HASNA_SNAPSHOTS_DIR = raw;
    expect(getExactDataRoot()).toBe(resolve(raw));
    expect(getExactDataRoot()?.startsWith("/")).toBe(true);
  });

  test("HASNA_SNAPSHOTS_DB_PATH store override wins over the effective data home", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "snapshots-sqlite-path-")); cleanups.push(override);
    const file = join(override, "custom.db");
    process.env.HASNA_SNAPSHOTS_DB_PATH = file;
    expect(getDbPath()).toBe(file);
    expect(defaultDbPath()).toBe(file);
  });
});
