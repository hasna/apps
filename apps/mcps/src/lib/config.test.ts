import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptResolverHome,
  DB_PATH,
  LEGACY_HOME_DIR,
  MCPS_DIR,
  mcpsDataDir,
  resolverHome,
} from "./config.js";

const originalPrimaryDir = process.env.HASNA_MCPS_DATA_DIR;
const originalLegacyDir = process.env.MCPS_DATA_DIR;
const originalDataHome = process.env.HASNA_DATA_HOME;
const originalDbPath = process.env.HASNA_MCPS_DB_PATH;
let scratchDir = "";

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "mcps-paths-"));
  delete process.env.HASNA_MCPS_DATA_DIR;
  delete process.env.MCPS_DATA_DIR;
  delete process.env.HASNA_DATA_HOME;
  delete process.env.HASNA_MCPS_DB_PATH;
});

afterEach(() => {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore("HASNA_MCPS_DATA_DIR", originalPrimaryDir);
  restore("MCPS_DATA_DIR", originalLegacyDir);
  restore("HASNA_DATA_HOME", originalDataHome);
  restore("HASNA_MCPS_DB_PATH", originalDbPath);
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("mcps data paths", () => {
  test("uses the package-specific environment variable before the legacy alias", () => {
    const primary = join(scratchDir, "primary");
    const legacy = join(scratchDir, "legacy");
    process.env.HASNA_MCPS_DATA_DIR = primary;
    process.env.MCPS_DATA_DIR = legacy;

    expect(mcpsDataDir()).toBe(primary);
  });

  test("falls back from an empty primary value to the legacy alias", () => {
    const legacy = join(scratchDir, "legacy");
    process.env.HASNA_MCPS_DATA_DIR = "";
    process.env.MCPS_DATA_DIR = legacy;

    expect(mcpsDataDir()).toBe(legacy);
  });

  test("uses the documented home-relative default when no override is set", () => {
    expect(mcpsDataDir()).toBe(join(homedir(), ".hasna", "mcps"));
    expect(LEGACY_HOME_DIR).toBe(join(homedir(), ".hasna", "mcps"));
  });

  test("resolver home resolves under the HASNA_DATA_HOME override", () => {
    process.env.HASNA_DATA_HOME = scratchDir;

    expect(resolverHome()).toBe(join(scratchDir, "mcps"));
  });

  test("adopts the resolver home when HASNA_DATA_HOME is set", () => {
    const resolved = join(scratchDir, "mcps");
    process.env.HASNA_DATA_HOME = scratchDir;

    expect(mcpsDataDir()).toBe(resolved);
  });

  test("an empty HASNA_DATA_HOME is treated as unset and does not adopt the resolver home", () => {
    process.env.HASNA_DATA_HOME = "";
    const resolved = join(scratchDir, "mcps");

    expect(adoptResolverHome(resolved)).toBe(false);
  });

  test("does not adopt the resolver home without an override and no migrated store", () => {
    const resolved = join(scratchDir, "mcps");

    expect(adoptResolverHome(resolved)).toBe(false);
    expect(mcpsDataDir()).toBe(LEGACY_HOME_DIR);
  });

  test("adopts the resolver home only when the data override is set or the store already exists there", () => {
    const resolved = join(scratchDir, "resolved", "mcps");

    expect(adoptResolverHome(resolved)).toBe(false);

    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "registry.db"), "");
    expect(adoptResolverHome(resolved)).toBe(true);

    // HASNA_DATA_HOME forces adoption even without an existing store.
    rmSync(join(resolved, "registry.db"));
    process.env.HASNA_DATA_HOME = join(scratchDir, "resolved");
    expect(adoptResolverHome(resolved)).toBe(true);
  });

  test("derives the default DB path from the resolved mcps dir", () => {
    expect(DB_PATH).toBe(join(MCPS_DIR, "registry.db"));
  });
});
