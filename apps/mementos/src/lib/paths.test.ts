import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/contracts/paths";
import { existsSync } from "node:fs";
import {
  legacyDataRoot,
  resolverDataRoot,
  getDataRoot,
  effectiveHome,
} from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
  "HASNA_MEMENTOS_HOME",
  "MEMENTOS_HOME",
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
  tempHome = mkdtempSync(join(tmpdir(), "mementos-paths-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  return tempHome;
}

describe("paths resolver wiring (single resolver in @hasna/contracts, ruling #1668)", () => {
  test("home resolves HOME first", () => {
    const home = isolateHome();
    expect(effectiveHome()).toBe(home);
  });

  test("the resolver data root is the contracts resolver root for this machine", () => {
    const home = isolateHome();
    expect(resolverDataRoot()).toBe(dataDir({ app: "mementos", home, env: process.env }));
  });

  test("on macOS the resolver (and therefore the effective) root is the mementos data root", () => {
    const home = isolateHome();
    const mac = dataDir({ app: "mementos", home, platform: "darwin", env: process.env });
    expect(mac).toBe(join(home, ".hasna", "mementos"));
    expect(resolverDataRoot()).toBe(mac);
    expect(getDataRoot()).toBe(mac);
  });

  test("on Linux the resolver root is the XDG data root", () => {
    const home = isolateHome();
    expect(dataDir({ app: "mementos", home, platform: "linux", env: process.env })).toBe(
      join(home, ".local", "share", "hasna", "mementos"),
    );
  });

  test("the effective root is the resolver root", () => {
    const home = isolateHome();
    expect(getDataRoot()).toBe(dataDir({ app: "mementos", home, env: process.env }));
  });

  test("HASNA_DATA_HOME kind override moves the data root (app segment kept)", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "mementos-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(getDataRoot()).toBe(join(base, "mementos"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "mementos-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(getDataRoot()).toBe(dataDir({ app: "mementos", home, env: process.env }));
  });

  test("the pre-ruling legacy root is spelled under the mementos data root", () => {
    const home = isolateHome();
    expect(legacyDataRoot()).toBe(join(home, ".hasna", "mementos"));
  });
});

describe("exact-app overrides and store layering", () => {
  test("exact-app overrides win over the resolver root, in priority order", () => {
    isolateHome();
    const primary = mkdtempSync(join(tmpdir(), "mementos-hasna-home-")); cleanups.push(primary);
    const secondary = mkdtempSync(join(tmpdir(), "mementos-home-")); cleanups.push(secondary);
    process.env.HASNA_MEMENTOS_HOME = primary;
    process.env.MEMENTOS_HOME = secondary;
    expect(getDataRoot()).toBe(primary);
    delete process.env.HASNA_MEMENTOS_HOME;
    expect(getDataRoot()).toBe(secondary);
  });

  test("an empty exact-app override is treated as unset and does not shadow a secondary", () => {
    isolateHome();
    const secondary = mkdtempSync(join(tmpdir(), "mementos-home2-")); cleanups.push(secondary);
    process.env.HASNA_MEMENTOS_HOME = "";
    process.env.MEMENTOS_HOME = secondary;
    expect(getDataRoot()).toBe(secondary);
  });

  test("default resolution never creates either home", () => {
    const home = isolateHome();
    expect(existsSync(join(home, ".hasna", "mementos"))).toBe(false);
    expect(existsSync(join(home, ".local", "share", "hasna", "mementos"))).toBe(false);
    expect(getDataRoot()).toBe(dataDir({ app: "mementos", home, env: process.env }));
  });

});
