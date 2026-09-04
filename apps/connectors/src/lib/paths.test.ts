import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/contracts/paths";

import { connectorsHome, effectiveHome, exactConnectorsHome, legacyHomeDir, resolverHome } from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
  "HASNA_CONNECTORS_DIR",
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
  tempHome = mkdtempSync(join(tmpdir(), "connectors-paths-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  return tempHome;
}

describe("connectors path resolution (single resolver in @hasna/contracts, ruling #1668)", () => {
  test("home resolves HOME first", () => {
    const home = isolateHome();
    expect(effectiveHome()).toBe(home);
  });

  test("the resolver home is the contracts resolver root for this machine", () => {
    const home = isolateHome();
    expect(resolverHome()).toBe(dataDir({ app: "connectors", home, env: process.env }));
  });

  test("on macOS the resolver (and therefore the effective) home is ~/.hasna/connectors", () => {
    const home = isolateHome();
    const mac = dataDir({ app: "connectors", home, platform: "darwin", env: process.env });
    expect(mac).toBe(join(home, ".hasna", "connectors"));
    expect(resolverHome()).toBe(mac);
    expect(connectorsHome()).toBe(mac);
  });

  test("on Linux the resolver home is the XDG data root", () => {
    const home = isolateHome();
    expect(dataDir({ app: "connectors", home, platform: "linux", env: process.env })).toBe(
      join(home, ".local", "share", "hasna", "connectors"),
    );
  });

  test("the effective connectors home is the resolver home; the pre-ruling legacy root is spelled under ~/.hasna/connectors", () => {
    const home = isolateHome();
    expect(connectorsHome()).toBe(dataDir({ app: "connectors", home, env: process.env }));
    expect(legacyHomeDir()).toBe(join(home, ".hasna", "connectors"));
  });

  test("HASNA_DATA_HOME kind override moves the connectors home (app segment kept)", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "connectors-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(connectorsHome()).toBe(join(base, "connectors"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the connectors home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "connectors-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(connectorsHome()).toBe(dataDir({ app: "connectors", home, env: process.env }));
  });

  test("HASNA_CONNECTORS_DIR exact override wins over the kind override and the resolver home", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "connectors-hasna-dir-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "connectors-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would move the resolver home, but the override must win
    process.env.HASNA_CONNECTORS_DIR = override;
    expect(exactConnectorsHome()).toBe(override);
    expect(connectorsHome()).toBe(resolve(override));
  });
});