import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/contracts/paths";
import { getDbPath } from "./db/database.js";
import {
  getLegacyDataRoot,
  getResolverDataRoot,
  getDataRoot,
  getHomeDir,
} from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
  "HASNA_TELEPHONY_DB_PATH",
  "TELEPHONY_DB_PATH",
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

describe("paths resolver wiring (single resolver in @hasna/contracts, ruling #1668)", () => {
  test("home resolves HOME first", () => {
    const home = isolateHome();
    expect(getHomeDir()).toBe(home);
  });

  test("the resolver data root is the contracts resolver root for this machine", () => {
    const home = isolateHome();
    expect(getResolverDataRoot()).toBe(dataDir({ app: "telephony", home, env: process.env }));
  });

  test("on macOS the resolver (and therefore the effective) root is ~/.hasna/telephony", () => {
    const home = isolateHome();
    const mac = dataDir({ app: "telephony", home, platform: "darwin", env: process.env });
    expect(mac).toBe(join(home, ".hasna", "telephony"));
    expect(getResolverDataRoot()).toBe(mac);
    expect(getDataRoot()).toBe(mac);
  });

  test("on Linux the resolver root is the XDG data root", () => {
    const home = isolateHome();
    expect(dataDir({ app: "telephony", home, platform: "linux", env: process.env })).toBe(
      join(home, ".local", "share", "hasna", "telephony"),
    );
  });

  test("the effective root is the resolver root", () => {
    const home = isolateHome();
    expect(getDataRoot()).toBe(dataDir({ app: "telephony", home, env: process.env }));
  });

  test("HASNA_DATA_HOME kind override moves the data root (app segment kept)", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "telephony-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(getDataRoot()).toBe(join(base, "telephony"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "telephony-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(getDataRoot()).toBe(dataDir({ app: "telephony", home, env: process.env }));
  });

  test("the pre-ruling legacy root is spelled under ~/.hasna/telephony", () => {
    const home = isolateHome();
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "telephony"));
  });
});

describe("exact-app overrides and store layering", () => {
  test("the default store path follows the effective data root; file overrides win", () => {
    const home = isolateHome();
    expect(getDbPath()).toBe(join(dataDir({ app: "telephony", home, env: process.env }), "telephony.db"));
    const file = join(home, "custom.db");
    process.env.HASNA_TELEPHONY_DB_PATH = file;
    expect(getDbPath()).toBe(file);
  });

});
