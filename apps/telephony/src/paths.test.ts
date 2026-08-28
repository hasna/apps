import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbPath } from "./db/database.js";
import {
  adoptResolverDataRoot,
  getDataRoot,
  getHomeDir,
  getLegacyDataRoot,
  getResolverDataRoot,
} from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_TELEPHONY_DB_PATH",
  "TELEPHONY_DB_PATH",
  "TELEPHONY_DB_SCOPE",
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
  tempHome = mkdtempSync(join(tmpdir(), "telephony-paths-"));
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
    expect(getResolverDataRoot()).toBe(join(home, ".local", "share", "hasna", "telephony"));
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "telephony"));
  });
});

describe("resolver (XDG) adoption — the legacy home must never become invisible", () => {
  test("legacy ~/.hasna/telephony stays the effective root until adopted", () => {
    const home = isolateHome();
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(getLegacyDataRoot());
    // The default store path agrees on the effective root.
    expect(getDbPath()).toBe(join(home, ".hasna", "telephony", "telephony.db"));
  });

  test("HASNA_DATA_HOME adopts the resolver (XDG) data root", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "telephony-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(join(base, "telephony"));
    expect(getDbPath()).toBe(join(base, "telephony", "telephony.db"));
  });

  test("an existing store at the resolver data root adopts it even without HASNA_DATA_HOME", () => {
    const home = isolateHome();
    const xdg = join(home, ".local", "share", "hasna", "telephony");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "telephony.db"), "existing-migrated-store");
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(xdg);
    expect(getDbPath()).toBe(join(xdg, "telephony.db"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "telephony-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(join(home, ".hasna", "telephony"));
  });
});
