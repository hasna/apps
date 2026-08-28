import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  getStylesDir,
  getTrainingDir,
  getModelConfigPath,
  legacyHomeDir,
  resolverHome,
  adoptResolverHome,
  exactStylesDir,
  hasExactStylesOverride,
} from "../lib/paths.js";

let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalDataHome: string | undefined;
let originalStylesHome: string | undefined;
let originalStylesHomeShort: string | undefined;
let testHome = "";

beforeEach(() => {
  originalHome = process.env["HOME"];
  originalUserProfile = process.env["USERPROFILE"];
  originalDataHome = process.env["HASNA_DATA_HOME"];
  originalStylesHome = process.env["HASNA_STYLES_HOME"];
  originalStylesHomeShort = process.env["STYLES_HOME"];
  testHome = join(tmpdir(), `styles-paths-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env["HOME"] = testHome;
  delete process.env["USERPROFILE"];
  delete process.env["HASNA_DATA_HOME"];
  delete process.env["HASNA_STYLES_HOME"];
  delete process.env["STYLES_HOME"];
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  if (originalUserProfile === undefined) delete process.env["USERPROFILE"];
  else process.env["USERPROFILE"] = originalUserProfile;
  if (originalDataHome === undefined) delete process.env["HASNA_DATA_HOME"];
  else process.env["HASNA_DATA_HOME"] = originalDataHome;
  if (originalStylesHome === undefined) delete process.env["HASNA_STYLES_HOME"];
  else process.env["HASNA_STYLES_HOME"] = originalStylesHome;
  if (originalStylesHomeShort === undefined) delete process.env["STYLES_HOME"];
  else process.env["STYLES_HOME"] = originalStylesHomeShort;
  rmSync(testHome, { recursive: true, force: true });
});

describe("paths resolver adoption", () => {
  test("defaults to the legacy ~/.hasna/styles home when nothing opts into XDG", () => {
    const dir = getStylesDir();
    expect(dir).toBe(join(testHome, ".hasna", "styles"));
    expect(existsSync(dir)).toBe(true);
    expect(legacyHomeDir()).toBe(join(testHome, ".hasna", "styles"));
  });

  test("resolverHome resolves the @hasna/paths data home", () => {
    expect(resolverHome()).toBe(join(testHome, ".local", "share", "hasna", "styles"));
  });

  test("HASNA_DATA_HOME opts in and redirects the effective home to the resolver data home", () => {
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    const dir = getStylesDir();
    expect(dir).toBe(join(testHome, "xdg-data", "styles"));
    expect(existsSync(dir)).toBe(true);
    expect(adoptResolverHome(resolverHome())).toBe(true);
  });

  test("a migrated config.json at the resolver home adopts it", () => {
    const resolved = resolverHome();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "config.json"), "{}");
    expect(getStylesDir()).toBe(resolved);
  });

  test("a migrated styles.db at the resolver home adopts it", () => {
    const resolved = resolverHome();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "styles.db"), "x");
    expect(getStylesDir()).toBe(resolved);
  });

  test("HASNA_STYLES_HOME exact override wins unconditionally over the resolver", () => {
    process.env["HASNA_STYLES_HOME"] = join(testHome, "custom-styles");
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    expect(getStylesDir()).toBe(join(testHome, "custom-styles"));
    expect(hasExactStylesOverride()).toBe(true);
    expect(exactStylesDir()).toBe(join(testHome, "custom-styles"));
  });

  test("HASNA_STYLES_HOME wins over the bare STYLES_HOME alias", () => {
    process.env["HASNA_STYLES_HOME"] = join(testHome, "a");
    process.env["STYLES_HOME"] = join(testHome, "b");
    expect(getStylesDir()).toBe(join(testHome, "a"));
  });

  test("getTrainingDir and getModelConfigPath hang off the effective home", () => {
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    expect(getTrainingDir()).toBe(join(testHome, "xdg-data", "styles", "training"));
    expect(getModelConfigPath()).toBe(join(testHome, "xdg-data", "styles", "config.json"));
  });

  test("legacy .open-styles / .styles copy into the effective (XDG) home when adopted", () => {
    mkdirSync(join(testHome, ".open-styles"), { recursive: true });
    writeFileSync(join(testHome, ".open-styles", "config.json"), "{\"source\":\"open\"}");
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    const dir = getStylesDir();
    expect(dir).toBe(join(testHome, "xdg-data", "styles"));
    expect(existsSync(join(dir, "config.json"))).toBe(true);
  });
});
