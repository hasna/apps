import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { adoptResolverHome, contextHome, exactContextHome, legacyHomeDir, resolverHome } from "./paths.js";

const ENV_KEYS = ["HOME", "USERPROFILE", "HASNA_DATA_HOME", "HASNA_CACHE_HOME", "HASNA_CONTEXT_DATA_DIR", "CONTEXT_DATA_DIR"] as const;

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
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
  for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true });
});

function isolateHome(): string {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  tempHome = mkdtempSync(join(tmpdir(), "context-home-test-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  delete process.env.HASNA_DATA_HOME;
  delete process.env.HASNA_CACHE_HOME;
  delete process.env.HASNA_CONTEXT_DATA_DIR;
  delete process.env.CONTEXT_DATA_DIR;
  return tempHome;
}

describe("context data home resolution", () => {
  test("resolver data home follows @hasna/paths under a fake HOME", () => {
    const home = isolateHome();
    expect(resolverHome()).toBe(join(home, ".local", "share", "hasna", "context"));
    expect(legacyHomeDir()).toBe(join(home, ".hasna", "context"));
  });

  test("legacy ~/.hasna/context stays the effective home until adopted", () => {
    const home = isolateHome();
    expect(adoptResolverHome(resolverHome())).toBe(false);
    expect(contextHome()).toBe(legacyHomeDir());
  });

  test("HASNA_DATA_HOME adopts the resolver (XDG) data home", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "context-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverHome(resolverHome())).toBe(true);
    expect(contextHome()).toBe(join(base, "context"));
  });

  test("an existing store at the resolver data home adopts it even without HASNA_DATA_HOME", () => {
    const home = isolateHome();
    const xdg = join(home, ".local", "share", "hasna", "context");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "context.db"), "existing-migrated-store");
    expect(adoptResolverHome(resolverHome())).toBe(true);
    expect(contextHome()).toBe(xdg);
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "context-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverHome(resolverHome())).toBe(false);
    expect(contextHome()).toBe(join(home, ".hasna", "context"));
  });

  test("HASNA_CONTEXT_DATA_DIR exact override wins over both roots", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "context-hasna-data-dir-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "context-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would adopt the XDG root, but the override must win
    process.env.HASNA_CONTEXT_DATA_DIR = override;
    expect(exactContextHome()).toBe(override);
    expect(contextHome()).toBe(override);
  });

  test("CONTEXT_DATA_DIR exact override wins over both roots", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "context-data-dir-")); cleanups.push(override);
    process.env.CONTEXT_DATA_DIR = override;
    expect(exactContextHome()).toBe(override);
    expect(contextHome()).toBe(override);
  });

  test("exact data-home overrides are resolved to absolute paths", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "context-abs-")); cleanups.push(base);
    const raw = join(base, "..", "context-abs-rel");
    process.env.CONTEXT_DATA_DIR = raw;
    expect(exactContextHome()).toBe(resolve(raw));
    expect(exactContextHome()?.startsWith("/")).toBe(true);
  });
});
