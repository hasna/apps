import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { catalogDbPath, catalogHome, defaultOpensourceRoot } from "../src/paths.js";

const ENV_KEYS = ["CATALOG_HOME", "CATALOG_DB_PATH", "CATALOG_OPENSOURCE_ROOT"] as const;
const previous = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = previous.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("catalog path resolution", () => {
  it("defaults to ~/.hasna/catalog and derives the db path from it", () => {
    expect(catalogHome()).toBe(join(homedir(), ".hasna", "catalog"));
    expect(catalogDbPath()).toBe(join(homedir(), ".hasna", "catalog", "catalog.db"));
  });

  it("defaults the opensource scan root to ~/workspace/hasna/opensource", () => {
    expect(defaultOpensourceRoot()).toBe(join(homedir(), "workspace", "hasna", "opensource"));
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
    expect(catalogHome()).toBe(join(homedir(), ".hasna", "catalog"));
    process.env["CATALOG_HOME"] = "   ";
    expect(catalogHome()).toBe(join(homedir(), ".hasna", "catalog"));
    process.env["CATALOG_DB_PATH"] = " ";
    expect(catalogDbPath()).toBe(join(homedir(), ".hasna", "catalog", "catalog.db"));
    process.env["CATALOG_OPENSOURCE_ROOT"] = "\t";
    expect(defaultOpensourceRoot()).toBe(join(homedir(), "workspace", "hasna", "opensource"));
  });

  it("trims surrounding whitespace from valid env values", () => {
    process.env["CATALOG_HOME"] = "  /tmp/cat-home  ";
    expect(catalogHome()).toBe("/tmp/cat-home");
  });
});
