import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getConfigPath } from "./config.js";
import { googleDriveConnectorDirs } from "./google-drive-client.js";
import {
  adoptResolverDataRoot,
  getDataRoot,
  getExactDataRoot,
  getFilesDataDir,
  getHomeDir,
  getLegacyDataRoot,
  getResolverDataRoot,
  resolveDataDir,
} from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
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

describe("resolver (XDG) data-root resolution", () => {
  test("home resolves HOME first, then the OS user database", () => {
    const home = isolateHome();
    expect(getHomeDir()).toBe(home);
  });

  test("resolver data root follows @hasna/paths under a fake HOME", () => {
    const home = isolateHome();
    expect(getResolverDataRoot()).toBe(join(home, ".local", "share", "hasna", "files"));
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "files"));
  });
});

describe("resolver (XDG) adoption — the legacy home must never become invisible", () => {
  test("legacy ~/.hasna/files stays the effective root until adopted", () => {
    const home = isolateHome();
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(getLegacyDataRoot());
    expect(getFilesDataDir()).toBe(join(home, ".hasna", "files"));
    // Downstream entry points agree on the effective root.
    expect(getConfigPath()).toBe(join(home, ".hasna", "files", "config.json"));
    expect(googleDriveConnectorDirs(process.env)[0]).toBe(
      join(home, ".hasna", "files", "connectors", "googledrive"),
    );
  });

  test("HASNA_DATA_HOME adopts the resolver (XDG) data root", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "files-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(join(base, "files"));
    expect(getFilesDataDir()).toBe(join(base, "files"));
    expect(getConfigPath()).toBe(join(base, "files", "config.json"));
    expect(googleDriveConnectorDirs(process.env)[0]).toBe(
      join(base, "files", "connectors", "googledrive"),
    );
  });

  test("an existing store at the resolver data root adopts it even without HASNA_DATA_HOME", () => {
    const home = isolateHome();
    const xdg = join(home, ".local", "share", "hasna", "files");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "files.db"), "existing-migrated-store");
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(xdg);
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "files-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(join(home, ".hasna", "files"));
  });
});

describe("exact-app overrides", () => {
  test("HASNA_FILES_HOME exact override wins over both roots", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "files-hasna-home-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "files-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would adopt the XDG root, but the override must win
    process.env.HASNA_FILES_HOME = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getDataRoot()).toBe(override);
    expect(getConfigPath()).toBe(join(override, "config.json"));
  });

  test("FILES_HOME exact override wins (lower-case alias)", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "files-home-")); cleanups.push(override);
    process.env.FILES_HOME = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getDataRoot()).toBe(override);
  });

  test("the pre-resolver data-dir overrides are preserved and win", () => {
    isolateHome();
    const dataDirOverride = mkdtempSync(join(tmpdir(), "files-data-dir-")); cleanups.push(dataDirOverride);
    const homeOverride = mkdtempSync(join(tmpdir(), "files-home-override-")); cleanups.push(homeOverride);
    process.env.HASNA_FILES_DATA_DIR = dataDirOverride;
    process.env.HASNA_FILES_HOME = homeOverride;
    // The data-dir override names the whole root directly and takes precedence.
    expect(getExactDataRoot()).toBe(dataDirOverride);
    expect(getDataRoot()).toBe(dataDirOverride);
  });

  test("FILES_DATA_DIR override (pre-resolver alias) wins", () => {
    isolateHome();
    const dataDirOverride = mkdtempSync(join(tmpdir(), "files-data-dir2-")); cleanups.push(dataDirOverride);
    process.env.FILES_DATA_DIR = dataDirOverride;
    expect(getExactDataRoot()).toBe(dataDirOverride);
    expect(getDataRoot()).toBe(dataDirOverride);
  });

  test("a set-but-whitespace override does not suppress a valid fallback", () => {
    isolateHome();
    process.env.HASNA_FILES_HOME = "   ";
    expect(getExactDataRoot()).toBeUndefined();
    expect(getDataRoot()).toBe(getLegacyDataRoot());
  });
});

describe("legacy ~/.files auto-migration", () => {
  test("old ~/.files data is copied into the legacy effective root when missing", () => {
    const home = isolateHome();
    const oldDir = join(home, ".files");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "legacy.db"), "legacy-bytes");
    expect(resolveDataDir()).toBe(join(home, ".hasna", "files"));
    expect(existsSync(join(home, ".hasna", "files", "legacy.db"))).toBe(true);
  });

  test("old ~/.files data is copied into the adopted (XDG) effective root", () => {
    const home = isolateHome();
    const base = mkdtempSync(join(tmpdir(), "files-data-home3-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    const oldDir = join(home, ".files");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "legacy.db"), "legacy-bytes");
    const effective = join(base, "files");
    expect(resolveDataDir()).toBe(effective);
    expect(existsSync(join(effective, "legacy.db"))).toBe(true);
  });

  test("an existing effective root is never overwritten by the migration", () => {
    const home = isolateHome();
    const effective = join(home, ".hasna", "files");
    mkdirSync(effective, { recursive: true });
    writeFileSync(join(effective, "live.db"), "live-bytes");
    const oldDir = join(home, ".files");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "legacy.db"), "legacy-bytes");
    resolveDataDir();
    expect(existsSync(join(effective, "live.db"))).toBe(true);
    // The pre-existing root already exists, so no copy happened.
    expect(existsSync(join(effective, "legacy.db"))).toBe(false);
  });
});
