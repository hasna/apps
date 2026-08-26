import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptResolverHome,
  catalogDbPath,
  catalogHome,
  defaultOpensourceRoot,
  effectiveHome,
  exactCatalogHome,
  legacyHomeDir,
  resolverHome,
} from "../src/paths.js";

// Isolate the resolver to a throwaway HOME so the assertions never depend on
// whether this machine already has a migrated store under the real home.
const testHome = mkdtempSync(join(tmpdir(), `catalog-home-test-`));
const savedHome = process.env.HOME;
process.env.HOME = testHome;

const ENV_KEYS = ["CATALOG_HOME", "CATALOG_DB_PATH", "CATALOG_OPENSOURCE_ROOT", "HASNA_DATA_HOME"] as const;
const previous = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  // Remove any resolver-home store a prior test may have planted.
  rmSync(join(resolverHome(), "catalog.db"), { force: true });
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

describe("catalog path resolution", () => {
  it("defaults to ~/.hasna/catalog and derives the db path from it", () => {
    expect(catalogHome()).toBe(join(effectiveHome(), ".hasna", "catalog"));
    expect(catalogDbPath()).toBe(join(effectiveHome(), ".hasna", "catalog", "catalog.db"));
  });

  it("defaults the opensource scan root to ~/workspace/hasna/opensource", () => {
    expect(defaultOpensourceRoot()).toBe(join(effectiveHome(), "workspace", "hasna", "opensource"));
  });

  it("honors CATALOG_HOME and derives the db path under it", () => {
    process.env["CATALOG_HOME"] = "/tmp/cat-home";
    expect(catalogHome()).toBe("/tmp/cat-home");
    expect(catalogDbPath()).toBe(join("/tmp/cat-home", "catalog.db"));
  });

  it("honors CATALOG_DB_PATH over the derived path", () => {
    process.env["CATALOG_HOME"] = "/tmp/cat-home";
    process.env["CATALOG_DB_PATH"] = "/tmp/cat-db/catalog.db";
    expect(catalogDbPath()).toBe("/tmp/cat-db/catalog.db");
  });

  it("honors CATALOG_OPENSOURCE_ROOT", () => {
    process.env["CATALOG_OPENSOURCE_ROOT"] = "/tmp/cat-root";
    expect(defaultOpensourceRoot()).toBe("/tmp/cat-root");
  });

  it("treats blank or whitespace-only env values as unset", () => {
    // A blank CATALOG_HOME used to yield a RELATIVE path (".hasna/catalog"),
    // silently creating "catalog.db" in whatever directory the process ran
    // from. Blank values must fall back to the absolute default.
    process.env["CATALOG_HOME"] = "";
    expect(catalogHome()).toBe(join(effectiveHome(), ".hasna", "catalog"));
    process.env["CATALOG_HOME"] = "   ";
    expect(catalogHome()).toBe(join(effectiveHome(), ".hasna", "catalog"));
    process.env["CATALOG_DB_PATH"] = " ";
    expect(catalogDbPath()).toBe(join(effectiveHome(), ".hasna", "catalog", "catalog.db"));
    process.env["CATALOG_OPENSOURCE_ROOT"] = "\t";
    expect(defaultOpensourceRoot()).toBe(join(effectiveHome(), "workspace", "hasna", "opensource"));
  });

  it("trims valid env values", () => {
    process.env["CATALOG_HOME"] = "  /tmp/cat-home  ";
    expect(catalogHome()).toBe("/tmp/cat-home");
    process.env["CATALOG_DB_PATH"] = " /tmp/cat-db/catalog.db ";
    expect(catalogDbPath()).toBe("/tmp/cat-db/catalog.db");
  });

  it("keeps the legacy ~/.hasna/catalog default until the XDG store exists or HASNA_DATA_HOME is set", () => {
    expect(legacyHomeDir()).toBe(join(effectiveHome(), ".hasna", "catalog"));
    expect(resolverHome()).toBe(join(effectiveHome(), ".local", "share", "hasna", "catalog"));
    expect(adoptResolverHome(resolverHome())).toBe(false);
    expect(catalogHome()).toBe(legacyHomeDir());
  });

  it("adopts the resolver home when HASNA_DATA_HOME is set", () => {
    const dataHome = join(testHome, "xdg-data");
    process.env["HASNA_DATA_HOME"] = dataHome;
    expect(adoptResolverHome(resolverHome())).toBe(true);
    expect(catalogHome()).toBe(join(dataHome, "catalog"));
    expect(catalogDbPath()).toBe(join(dataHome, "catalog", "catalog.db"));
  });

  it("adopts the resolver home once the store has been migrated there", () => {
    const resolved = resolverHome();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "catalog.db"), "");
    expect(adoptResolverHome(resolverHome())).toBe(true);
    expect(catalogHome()).toBe(resolved);
  });

  it("lets the exact-app CATALOG_HOME override win over the resolver", () => {
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    process.env["CATALOG_HOME"] = "/tmp/cat-home";
    expect(exactCatalogHome()).toBe("/tmp/cat-home");
    expect(catalogHome()).toBe("/tmp/cat-home");
  });
});
