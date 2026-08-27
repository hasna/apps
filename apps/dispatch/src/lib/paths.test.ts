import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  adoptResolverDataDir,
  artifactsDir,
  daemonLogPath,
  daemonPidLockPath,
  daemonStatePath,
  dataDir,
  dbPath,
  getDataDir,
  getExactDataDir,
  getHomeDir,
  getLegacyDataDir,
  getResolverDataDir,
  pidFilePath,
} from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "DISPATCH_DATA_DIR",
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
  const home = mkdtempSync(join(tmpdir(), "dispatch-data-root-"));
  tempHome = home;
  process.env.HOME = home;
  delete process.env.USERPROFILE;
  delete process.env.DISPATCH_DATA_DIR;
  delete process.env.HASNA_DATA_HOME;
  delete process.env.HASNA_CACHE_HOME;
  return home;
}

describe("resolver (XDG) adoption — the legacy home must never become invisible", () => {
  test("resolver data dir follows @hasna/paths under a fake HOME", () => {
    const home = isolateHome();
    expect(getResolverDataDir()).toBe(join(home, ".local", "share", "hasna", "dispatch"));
    expect(getLegacyDataDir()).toBe(join(home, ".hasna", "dispatch"));
    expect(getHomeDir()).toBe(home);
  });

  test("legacy ~/.hasna/dispatch stays the effective dir until adopted", () => {
    const home = isolateHome();
    expect(adoptResolverDataDir(getResolverDataDir())).toBe(false);
    expect(getDataDir()).toBe(join(home, ".hasna", "dispatch"));
    expect(dbPath()).toBe(join(home, ".hasna", "dispatch", "dispatch.db"));
    expect(dataDir()).toBe(getDataDir());
  });

  test("HASNA_DATA_HOME adopts the resolver (XDG) data dir", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "dispatch-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverDataDir(getResolverDataDir())).toBe(true);
    expect(getDataDir()).toBe(join(base, "dispatch"));
    expect(dbPath()).toBe(join(base, "dispatch", "dispatch.db"));
  });

  test("an existing store at the resolver data dir adopts it even without HASNA_DATA_HOME", () => {
    const home = isolateHome();
    const xdg = join(home, ".local", "share", "hasna", "dispatch");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "dispatch.db"), "existing-migrated-store");
    expect(adoptResolverDataDir(getResolverDataDir())).toBe(true);
    expect(getDataDir()).toBe(xdg);
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data dir", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "dispatch-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverDataDir(getResolverDataDir())).toBe(false);
    expect(getDataDir()).toBe(join(home, ".hasna", "dispatch"));
  });

  test("DISPATCH_DATA_DIR exact override wins over both roots", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "dispatch-exact-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "dispatch-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would adopt the XDG root, but the override must win
    process.env.DISPATCH_DATA_DIR = override;
    expect(getExactDataDir()).toBe(override);
    expect(getDataDir()).toBe(override);
    expect(dbPath()).toBe(join(override, "dispatch.db"));
  });

  test("an empty exact-app override is treated as unset", () => {
    const home = isolateHome();
    process.env.DISPATCH_DATA_DIR = "";
    expect(getExactDataDir()).toBeUndefined();
    expect(getDataDir()).toBe(join(home, ".hasna", "dispatch"));
  });

  test("default run never creates the resolver (XDG) data dir", () => {
    const home = isolateHome();
    // getDataDir() is a pure resolver: it must not create either home.
    getDataDir();
    expect(existsSync(join(home, ".hasna", "dispatch"))).toBe(false);
    expect(existsSync(join(home, ".local", "share", "hasna", "dispatch"))).toBe(false);
  });

  test("every sub-path resolves under the effective data dir", () => {
    const home = isolateHome();
    const root = getDataDir();
    expect(dbPath()).toBe(join(root, "dispatch.db"));
    expect(pidFilePath()).toBe(join(root, "daemon.pid"));
    expect(daemonLogPath()).toBe(join(root, "daemon.log"));
    expect(daemonStatePath()).toBe(join(root, "daemon.state.json"));
    expect(daemonPidLockPath()).toBe(join(root, "daemon.pid.lock"));
    expect(artifactsDir()).toBe(join(root, "artifacts"));
  });
});
