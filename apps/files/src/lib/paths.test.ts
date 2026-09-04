import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/contracts/paths";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getConfigPath } from "./config.js";
import { getDataDir } from "./paths.js";
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
  "HASNA_FILES_HOME",
  "FILES_HOME",
  "HASNA_FILES_DATA_DIR",
  "FILES_DATA_DIR",
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
  tempHome = mkdtempSync(join(tmpdir(), "files-paths-"));
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
    expect(getResolverDataRoot()).toBe(dataDir({ app: "files", home, env: process.env }));
  });

  test("on macOS the resolver (and therefore the effective) root is the files data root", () => {
    const home = isolateHome();
    const mac = dataDir({ app: "files", home, platform: "darwin", env: process.env });
    expect(mac).toBe(join(home, ".hasna", "files"));
    expect(getResolverDataRoot()).toBe(mac);
    expect(getDataRoot()).toBe(mac);
  });

  test("on Linux the resolver root is the XDG data root", () => {
    const home = isolateHome();
    expect(dataDir({ app: "files", home, platform: "linux", env: process.env })).toBe(
      join(home, ".local", "share", "hasna", "files"),
    );
  });

  test("the effective root is the resolver root", () => {
    const home = isolateHome();
    expect(getDataRoot()).toBe(dataDir({ app: "files", home, env: process.env }));
  });

  test("HASNA_DATA_HOME kind override moves the data root (app segment kept)", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "files-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(getDataRoot()).toBe(join(base, "files"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "files-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(getDataRoot()).toBe(dataDir({ app: "files", home, env: process.env }));
  });

  test("the pre-ruling legacy root is spelled under the files data root", () => {
    const home = isolateHome();
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "files"));
  });
});

describe("exact-app overrides and store layering", () => {
  test("HASNA_FILES_HOME exact override wins over the resolver root", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "files-hasna-home-")); cleanups.push(override);
    process.env.HASNA_FILES_HOME = override;
    expect(getDataRoot()).toBe(resolve(override));
    expect(getConfigPath()).toBe(join(resolve(override), "config.json"));
  });

  test("FILES_DATA_DIR override (pre-resolver alias) wins", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "files-data-dir-")); cleanups.push(override);
    process.env.FILES_DATA_DIR = override;
    expect(getDataRoot()).toBe(resolve(override));
  });

  test("a set-but-whitespace override does not suppress a valid fallback", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "files-home2-")); cleanups.push(override);
    process.env.HASNA_FILES_HOME = "   ";
    process.env.FILES_HOME = override;
    expect(getDataRoot()).toBe(resolve(override));
  });

  test("old ~/.files data is copied into the effective root when missing (one-time migration)", () => {
    const home = isolateHome();
    const oldDir = join(home, ".files");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "keep.txt"), "x");
    const effective = getDataRoot();
    expect(getDataDir()).toBe(effective);
    expect(readFileSync(join(effective, "keep.txt"), "utf8")).toBe("x");
  });

  test("an existing effective root is never overwritten by the migration", () => {
    const home = isolateHome();
    const oldDir = join(home, ".files");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "old.txt"), "old");
    const effective = getDataRoot();
    mkdirSync(effective, { recursive: true });
    writeFileSync(join(effective, "new.txt"), "new");
    getDataDir();
    expect(existsSync(join(effective, "old.txt"))).toBe(false);
    expect(readFileSync(join(effective, "new.txt"), "utf8")).toBe("new");
  });

});
