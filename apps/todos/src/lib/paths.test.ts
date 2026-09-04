import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/contracts/paths";
import { getConfigPath, getDefaultDbPath, getTrainingDir } from "./paths.js";
import {
  legacyHomeDir,
  resolverHome,
  getTodosDir,
  effectiveHome,
} from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
  "HASNA_TODOS_DB_PATH",
  "TODOS_DB_PATH",
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
  tempHome = mkdtempSync(join(tmpdir(), "todos-paths-"));
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
    expect(resolverHome()).toBe(dataDir({ app: "todos", home, env: process.env }));
  });

  test("on macOS the resolver (and therefore the effective) root is the todos data root", () => {
    const home = isolateHome();
    const mac = dataDir({ app: "todos", home, platform: "darwin", env: process.env });
    expect(mac).toBe(join(home, ".hasna", "todos"));
    expect(resolverHome()).toBe(mac);
    expect(getTodosDir()).toBe(mac);
  });

  test("on Linux the resolver root is the XDG data root", () => {
    const home = isolateHome();
    expect(dataDir({ app: "todos", home, platform: "linux", env: process.env })).toBe(
      join(home, ".local", "share", "hasna", "todos"),
    );
  });

  test("the effective root is the resolver root", () => {
    const home = isolateHome();
    expect(getTodosDir()).toBe(dataDir({ app: "todos", home, env: process.env }));
  });

  test("HASNA_DATA_HOME kind override moves the data root (app segment kept)", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "todos-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(getTodosDir()).toBe(join(base, "todos"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "todos-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(getTodosDir()).toBe(dataDir({ app: "todos", home, env: process.env }));
  });

  test("the pre-ruling legacy root is spelled under the todos data root", () => {
    const home = isolateHome();
    expect(legacyHomeDir()).toBe(join(home, ".hasna", "todos"));
  });
});

describe("exact-app overrides and store layering", () => {
  test("the default db path, training dir and config path follow the effective root", () => {
    const home = isolateHome();
    const root = dataDir({ app: "todos", home, env: process.env });
    expect(getDefaultDbPath()).toBe(join(root, "todos.db"));
    expect(getTrainingDir()).toBe(join(root, "training"));
    expect(getConfigPath()).toBe(join(root, "config.json"));
  });

});
