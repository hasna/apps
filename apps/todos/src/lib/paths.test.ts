import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  getTodosDir,
  getDefaultDbPath,
  getConfigPath,
  getTrainingDir,
  legacyHomeDir,
  resolverHome,
  adoptResolverHome,
} from "./paths.js";

let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalDataHome: string | undefined;
let testHome = "";

beforeEach(() => {
  originalHome = process.env["HOME"];
  originalUserProfile = process.env["USERPROFILE"];
  originalDataHome = process.env["HASNA_DATA_HOME"];
  testHome = join(tmpdir(), `todos-paths-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env["HOME"] = testHome;
  delete process.env["USERPROFILE"];
  // Hermetic: the @hasna/paths resolver and the data-kind override must not
  // inherit ambient values.
  delete process.env["HASNA_DATA_HOME"];
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  if (originalUserProfile === undefined) delete process.env["USERPROFILE"];
  else process.env["USERPROFILE"] = originalUserProfile;
  if (originalDataHome === undefined) delete process.env["HASNA_DATA_HOME"];
  else process.env["HASNA_DATA_HOME"] = originalDataHome;
  rmSync(testHome, { recursive: true, force: true });
});

describe("paths resolver adoption", () => {
  test("defaults to the legacy ~/.hasna/todos home when nothing opts into XDG", () => {
    expect(legacyHomeDir()).toBe(join(testHome, ".hasna", "todos"));
    expect(getTodosDir()).toBe(join(testHome, ".hasna", "todos"));
    expect(getDefaultDbPath()).toBe(join(testHome, ".hasna", "todos", "todos.db"));
    expect(getConfigPath()).toBe(join(testHome, ".hasna", "todos", "config.json"));
    expect(getTrainingDir()).toBe(join(testHome, ".hasna", "todos", "training"));
  });

  test("resolverHome resolves the @hasna/paths data home", () => {
    expect(resolverHome()).toBe(join(testHome, ".local", "share", "hasna", "todos"));
  });

  test("HASNA_DATA_HOME opts in and redirects the effective home to the resolver data home", () => {
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    expect(adoptResolverHome(resolverHome())).toBe(true);
    const dir = getTodosDir();
    expect(dir).toBe(join(testHome, "xdg-data", "todos"));
    expect(getDefaultDbPath()).toBe(join(testHome, "xdg-data", "todos", "todos.db"));
    expect(existsSync(join(dir, "todos.db"))).toBe(false);
  });

  test("a migrated todos.db at the resolver home adopts it", () => {
    const resolved = resolverHome();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "todos.db"), "");
    expect(adoptResolverHome(resolved)).toBe(true);
    expect(getTodosDir()).toBe(resolved);
    expect(getDefaultDbPath()).toBe(join(resolved, "todos.db"));
  });

  test("a migrated config.json at the resolver home adopts it", () => {
    const resolved = resolverHome();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "config.json"), "{}");
    expect(getTodosDir()).toBe(resolved);
  });

  test("an empty HASNA_DATA_HOME is treated as unset and falls back to legacy", () => {
    process.env["HASNA_DATA_HOME"] = "";
    expect(adoptResolverHome(resolverHome())).toBe(false);
    expect(getTodosDir()).toBe(join(testHome, ".hasna", "todos"));
  });
});
