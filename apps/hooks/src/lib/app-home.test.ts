import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  adoptResolverDataRoot,
  getEffectiveDataRoot,
  getExactDataRoot,
  getExplicitDataDir,
  getHomeDir,
  getLegacyDataRoot,
  getResolverDataRoot,
} from "./app-home.js";
import {
  getCustomHooksDir,
  getHooksDataDir,
  getLockPath,
} from "../config.js";
import { getDbPath } from "../db/index.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_HOOKS_DATA_DIR",
  "HOOKS_DATA_DIR",
  "HASNA_HOOKS_HOME",
  "HOOKS_HOME",
  "HASNA_HOOKS_DB_PATH",
  "HOOKS_DB_PATH",
  "HASNA_HOOKS_LOCK_PATH",
  "HOOKS_LOCK_PATH",
  "HASNA_HOOKS_CONFIG_PATH",
  "HOOKS_CONFIG_PATH",
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
  tempHome = mkdtempSync(join(tmpdir(), "hooks-paths-"));
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
    expect(getResolverDataRoot()).toBe(join(home, ".local", "share", "hasna", "hooks"));
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "hooks"));
  });
});

describe("resolver (XDG) adoption — the legacy home must never become invisible", () => {
  test("legacy ~/.hasna/hooks stays the effective root until adopted", () => {
    const home = isolateHome();
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getEffectiveDataRoot()).toBe(getLegacyDataRoot());
    // The downstream entry points all agree on the effective root.
    expect(getHooksDataDir()).toBe(join(home, ".hasna", "hooks"));
    expect(getCustomHooksDir()).toBe(join(home, ".hasna", "hooks", "hooks"));
    expect(getLockPath()).toBe(join(home, ".hasna", "hooks", "hooks.lock"));
    // config.json was the registry-config key store (api_url / api_key_ref);
    // it is retired — the data root no longer exposes a config path for it.
    expect(getDbPath()).toBe(join(home, ".hasna", "hooks", "hooks.db"));
  });

  test("HASNA_DATA_HOME adopts the resolver (XDG) data root", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "hooks-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getEffectiveDataRoot()).toBe(join(base, "hooks"));
    expect(getHooksDataDir()).toBe(join(base, "hooks"));
    expect(getCustomHooksDir()).toBe(join(base, "hooks", "hooks"));
    expect(getLockPath()).toBe(join(base, "hooks", "hooks.lock"));
    expect(getDbPath()).toBe(join(base, "hooks", "hooks.db"));
  });

  test("an existing store at the resolver data root adopts it even without HASNA_DATA_HOME", () => {
    const home = isolateHome();
    const xdg = join(home, ".local", "share", "hasna", "hooks");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "hooks.db"), "existing-migrated-store");
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getEffectiveDataRoot()).toBe(xdg);
    expect(getHooksDataDir()).toBe(xdg);
    expect(getDbPath()).toBe(join(xdg, "hooks.db"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "hooks-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getEffectiveDataRoot()).toBe(join(home, ".hasna", "hooks"));
    expect(getHooksDataDir()).toBe(join(home, ".hasna", "hooks"));
  });
});

describe("explicit data-dir overrides", () => {
  test("HASNA_HOOKS_DATA_DIR granular override wins over both roots", () => {
    const home = isolateHome();
    const override = mkdtempSync(join(tmpdir(), "hooks-explicit-")); cleanups.push(override);
    process.env.HASNA_HOOKS_DATA_DIR = override;
    expect(getExplicitDataDir()).toBe(override);
    expect(getEffectiveDataRoot()).toBe(override);
    expect(getHooksDataDir()).toBe(override);
    expect(getDbPath()).toBe(join(override, "hooks.db"));
  });

  test("HOOKS_DATA_DIR fallback wins over both roots", () => {
    const home = isolateHome();
    const override = mkdtempSync(join(tmpdir(), "hooks-explicit2-")); cleanups.push(override);
    process.env.HOOKS_DATA_DIR = override;
    expect(getEffectiveDataRoot()).toBe(override);
    expect(getHooksDataDir()).toBe(override);
  });

  test("HASNA_HOOKS_HOME exact override wins over both roots", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "hooks-hasna-home-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "hooks-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would adopt the XDG root, but the override must win
    process.env.HASNA_HOOKS_HOME = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getEffectiveDataRoot()).toBe(override);
    expect(getHooksDataDir()).toBe(override);
  });

  test("HOOKS_HOME exact override wins over both roots", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "hooks-home-")); cleanups.push(override);
    process.env.HOOKS_HOME = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getEffectiveDataRoot()).toBe(override);
  });

  test("a whitespace-only HASNA_HOOKS_HOME falls through to a valid HOOKS_HOME", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "hooks-hasna-home2-")); cleanups.push(override);
    process.env.HASNA_HOOKS_HOME = "   ";
    process.env.HOOKS_HOME = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getEffectiveDataRoot()).toBe(override);
    expect(getHooksDataDir()).toBe(override);
  });

  test("whitespace-only exact overrides fall through to the legacy root", () => {
    const home = isolateHome();
    process.env.HASNA_HOOKS_HOME = "   ";
    process.env.HOOKS_HOME = "\t ";
    expect(getExactDataRoot()).toBeUndefined();
    expect(getEffectiveDataRoot()).toBe(join(home, ".hasna", "hooks"));
  });

  test("exact data-root overrides are resolved to absolute paths", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "hooks-abs-")); cleanups.push(base);
    const raw = join(base, "..", "hooks-abs-rel");
    process.env.HOOKS_HOME = raw;
    expect(getExactDataRoot()).toBe(resolve(raw));
    expect(getExactDataRoot()?.startsWith("/")).toBe(true);
  });

  test("an explicit HASNA_HOOKS_DB_PATH still wins over the effective root", () => {
    const home = isolateHome();
    const db = join(home, "custom.db");
    process.env.HASNA_HOOKS_DB_PATH = db;
    expect(getDbPath()).toBe(db);
  });
});
