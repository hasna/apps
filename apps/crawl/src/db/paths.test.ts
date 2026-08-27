import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptResolverDataRoot,
  exactDataRoot,
  getDataRoot,
  legacyDataRoot,
  resolverDataRoot,
} from "./paths.js";

// Isolate the resolver to a throwaway HOME so the assertions never depend on
// whether this machine already has a migrated store under the real home.
const testHome = mkdtempSync(join(tmpdir(), `crawl-paths-test-`));
const savedHome = process.env.HOME;
process.env.HOME = testHome;

const ENV_KEYS = ["HASNA_CRAWL_HOME", "CRAWL_HOME", "HASNA_DATA_HOME"] as const;
const previous = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  // Remove any resolver-home store a prior test may have planted.
  rmSync(join(resolverDataRoot(), "data.db"), { force: true });
});

afterAll(() => {
  process.env.HOME = savedHome;
  for (const key of ENV_KEYS) {
    const value = previous.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(testHome, { recursive: true, force: true });
});

describe("crawl data-root resolution", () => {
  it("defaults to ~/.hasna/crawl until the XDG store exists or HASNA_DATA_HOME is set", () => {
    expect(legacyDataRoot()).toBe(join(testHome, ".hasna", "crawl"));
    expect(resolverDataRoot()).toBe(join(testHome, ".local", "share", "hasna", "crawl"));
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(legacyDataRoot());
  });

  it("adopts the resolver data root when HASNA_DATA_HOME is set", () => {
    const dataHome = join(testHome, "xdg-data");
    process.env["HASNA_DATA_HOME"] = dataHome;
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(join(dataHome, "crawl"));
  });

  it("adopts the resolver data root once the store has been migrated there", () => {
    const resolved = resolverDataRoot();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "data.db"), "");
    expect(adoptResolverDataRoot(resolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(resolved);
  });

  it("lets the exact-app HASNA_CRAWL_HOME override win over the resolver", () => {
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    process.env["HASNA_CRAWL_HOME"] = "/tmp/crawl-home";
    expect(exactDataRoot()).toBe("/tmp/crawl-home");
    expect(getDataRoot()).toBe("/tmp/crawl-home");
  });

  it("lets the CRAWL_HOME override win too", () => {
    process.env["HASNA_CRAWL_HOME"] = "/tmp/crawl-home-a";
    process.env["CRAWL_HOME"] = "/tmp/crawl-home-b";
    expect(exactDataRoot()).toBe("/tmp/crawl-home-a");
  });

  it("treats blank or whitespace-only HASNA_CRAWL_HOME as unset", () => {
    process.env["HASNA_CRAWL_HOME"] = "";
    expect(exactDataRoot()).toBeUndefined();
    expect(getDataRoot()).toBe(legacyDataRoot());
    process.env["HASNA_CRAWL_HOME"] = "   ";
    expect(exactDataRoot()).toBeUndefined();
    expect(getDataRoot()).toBe(legacyDataRoot());
  });

  it("trims valid HASNA_CRAWL_HOME values", () => {
    process.env["HASNA_CRAWL_HOME"] = "  /tmp/crawl-home  ";
    expect(exactDataRoot()).toBe("/tmp/crawl-home");
    expect(getDataRoot()).toBe("/tmp/crawl-home");
  });
});
