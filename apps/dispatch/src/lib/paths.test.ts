import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/contracts/paths";
import { artifactsDir, daemonLogPath, daemonPidLockPath, daemonStatePath, dataDir as dispatchDataDir, dbPath, pidFilePath } from "./paths.js";
import {
  getLegacyDataDir,
  getResolverDataDir,
  getDataDir,
  getHomeDir,
} from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
  "DISPATCH_DATA_DIR",
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
  tempHome = mkdtempSync(join(tmpdir(), "dispatch-paths-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  return tempHome;
}

describe("paths resolver wiring (single resolver in @hasna/contracts, ruling #1668)", () => {
  test("home resolves HOME first", () => {
    const home = isolateHome();
    expect(getHomeDir()).toBe(home);
  });

  test("the resolver data root is the contracts resolver root for this machine", () => {
    const home = isolateHome();
    expect(getResolverDataDir()).toBe(dataDir({ app: "dispatch", home, env: process.env }));
  });

  test("on macOS the resolver (and therefore the effective) root is ~/.hasna/dispatch", () => {
    const home = isolateHome();
    const mac = dataDir({ app: "dispatch", home, platform: "darwin", env: process.env });
    expect(mac).toBe(join(home, ".hasna", "dispatch"));
    expect(getResolverDataDir()).toBe(mac);
    expect(getDataDir()).toBe(mac);
  });

  test("on Linux the resolver root is the XDG data root", () => {
    const home = isolateHome();
    expect(dataDir({ app: "dispatch", home, platform: "linux", env: process.env })).toBe(
      join(home, ".local", "share", "hasna", "dispatch"),
    );
  });

  test("the effective root is the resolver root", () => {
    const home = isolateHome();
    expect(getDataDir()).toBe(dataDir({ app: "dispatch", home, env: process.env }));
  });

  test("HASNA_DATA_HOME kind override moves the data root (app segment kept)", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "dispatch-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(getDataDir()).toBe(join(base, "dispatch"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "dispatch-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(getDataDir()).toBe(dataDir({ app: "dispatch", home, env: process.env }));
  });

  test("the pre-ruling legacy root is spelled under ~/.hasna/dispatch", () => {
    const home = isolateHome();
    expect(getLegacyDataDir()).toBe(join(home, ".hasna", "dispatch"));
  });
});

describe("exact-app overrides and store layering", () => {
  test("DISPATCH_DATA_DIR exact override wins over the resolver root", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "dispatch-data-dir-")); cleanups.push(override);
    process.env.DISPATCH_DATA_DIR = override;
    expect(getDataDir()).toBe(resolve(override.trim()));
    expect(dbPath()).toBe(join(resolve(override.trim()), "dispatch.db"));
  });

  test("root data directory alias returns the effective data dir", () => {
    const home = isolateHome();
    expect(dispatchDataDir()).toBe(getDataDir());
  });

  test("daemon side files follow the effective data dir", () => {
    const home = isolateHome();
    const root = dataDir({ app: "dispatch", home, env: process.env });
    expect(dbPath()).toBe(join(root, "dispatch.db"));
    expect(pidFilePath()).toBe(join(root, "daemon.pid"));
    expect(daemonLogPath()).toBe(join(root, "daemon.log"));
    expect(daemonStatePath()).toBe(join(root, "daemon.state.json"));
    expect(daemonPidLockPath()).toBe(join(root, "daemon.pid.lock"));
    expect(artifactsDir()).toBe(join(root, "artifacts"));
  });

});
