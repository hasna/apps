import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/contracts/paths";
import { getDbPath } from "../db/database.js";
import { getDataRootForHome } from "./paths.js";
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
  "HASNA_REPOS_HOME",
  "HASNA_REPOS_DB_PATH",
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

describe("paths resolver wiring (single resolver in @hasna/contracts, ruling #1668)", () => {
  test("home resolves HOME first", () => {
    const home = isolateHome();
    expect(getHomeDir()).toBe(home);
  });

  test("the resolver data root is the contracts resolver root for this machine", () => {
    const home = isolateHome();
    expect(getResolverDataRoot()).toBe(dataDir({ app: "repos", home, env: process.env }));
  });

  test("on macOS the resolver (and therefore the effective) root is the repos data root", () => {
    const home = isolateHome();
    const mac = dataDir({ app: "repos", home, platform: "darwin", env: process.env });
    expect(mac).toBe(join(home, ".hasna", "repos"));
    expect(getResolverDataRoot()).toBe(mac);
    expect(getDataRoot()).toBe(mac);
  });

  test("on Linux the resolver root is the XDG data root", () => {
    const home = isolateHome();
    expect(dataDir({ app: "repos", home, platform: "linux", env: process.env })).toBe(
      join(home, ".local", "share", "hasna", "repos"),
    );
  });

  test("the effective root is the resolver root", () => {
    const home = isolateHome();
    expect(getDataRoot()).toBe(dataDir({ app: "repos", home, env: process.env }));
  });

  test("HASNA_DATA_HOME kind override moves the data root (app segment kept)", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "repos-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(getDataRoot()).toBe(join(base, "repos"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "repos-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(getDataRoot()).toBe(dataDir({ app: "repos", home, env: process.env }));
  });

  test("the pre-ruling legacy root is spelled under the repos data root", () => {
    const home = isolateHome();
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "repos"));
  });
});

describe("exact-app overrides and store layering", () => {
  test("HASNA_REPOS_HOME exact override wins over the resolver root", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "repos-hasna-home-")); cleanups.push(override);
    process.env.HASNA_REPOS_HOME = override;
    expect(getDataRoot()).toBe(resolve(override));
  });

  test("HASNA_REPOS_DB_PATH file override wins over the effective data root", () => {
    isolateHome();
    const file = join(tmpdir(), "repos-custom.db");
    process.env.HASNA_REPOS_DB_PATH = file;
    expect(getDbPath()).toBe(file);
  });

  test("getDataRootForHome — explicit-home variant resolves the resolver root under the given home", () => {
    isolateHome();
    const altHome = mkdtempSync(join(tmpdir(), "repos-alt-home-")); cleanups.push(altHome);
    expect(getDataRootForHome(altHome)).toBe(resolve(dataDir({ app: "repos", home: altHome, env: process.env })));
  });

  test("getDataRootForHome — HASNA_REPOS_HOME exact override wins over the home argument", () => {
    isolateHome();
    const altHome = mkdtempSync(join(tmpdir(), "repos-alt-home2-")); cleanups.push(altHome);
    const override = mkdtempSync(join(tmpdir(), "repos-hasna-home2-")); cleanups.push(override);
    process.env.HASNA_REPOS_HOME = override;
    expect(getDataRootForHome(altHome)).toBe(resolve(override));
  });

});
