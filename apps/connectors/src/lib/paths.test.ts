import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptResolverHome,
  connectorsHome,
  effectiveHome,
  exactConnectorsHome,
  legacyHomeDir,
  resolverHome,
} from "./paths.js";

// Isolate the resolver to a throwaway HOME so the assertions never depend on
// whether this machine already has a migrated store under the real home.
const testHome = mkdtempSync(join(tmpdir(), `connectors-home-test-`));
const savedHome = process.env.HOME;
process.env.HOME = testHome;

const ENV_KEYS = ["HASNA_CONNECTORS_DIR", "HASNA_DATA_HOME"] as const;
const previous = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  // Remove any resolver-home store a prior test may have planted.
  rmSync(join(resolverHome(), "connectors.db"), { force: true });
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

describe("connectors path resolution", () => {
  it("defaults to ~/.hasna/connectors until the XDG store exists or HASNA_DATA_HOME is set", () => {
    expect(legacyHomeDir()).toBe(join(effectiveHome(), ".hasna", "connectors"));
    const nativeDataRoot = process.platform === "darwin"
      ? ["Library", "Application Support", "Hasna"]
      : [".local", "share", "hasna"];
    expect(resolverHome()).toBe(join(effectiveHome(), ...nativeDataRoot, "connectors"));
    expect(adoptResolverHome(resolverHome())).toBe(false);
    expect(connectorsHome()).toBe(legacyHomeDir());
  });

  it("adopts the resolver home when HASNA_DATA_HOME is set", () => {
    const dataHome = join(testHome, "xdg-data");
    process.env["HASNA_DATA_HOME"] = dataHome;
    expect(adoptResolverHome(resolverHome())).toBe(true);
    expect(connectorsHome()).toBe(join(dataHome, "connectors"));
  });

  it("adopts the resolver home once the store has been migrated there", () => {
    const resolved = resolverHome();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "connectors.db"), "");
    expect(adoptResolverHome(resolverHome())).toBe(true);
    expect(connectorsHome()).toBe(resolved);
  });

  it("lets the exact-app HASNA_CONNECTORS_DIR override win over the resolver", () => {
    process.env["HASNA_DATA_HOME"] = join(testHome, "xdg-data");
    process.env["HASNA_CONNECTORS_DIR"] = "/tmp/conn-home";
    expect(exactConnectorsHome()).toBe("/tmp/conn-home");
    expect(connectorsHome()).toBe("/tmp/conn-home");
  });

  it("treats blank or whitespace-only HASNA_CONNECTORS_DIR as unset", () => {
    process.env["HASNA_CONNECTORS_DIR"] = "";
    expect(exactConnectorsHome()).toBeUndefined();
    expect(connectorsHome()).toBe(legacyHomeDir());
    process.env["HASNA_CONNECTORS_DIR"] = "   ";
    expect(exactConnectorsHome()).toBeUndefined();
    expect(connectorsHome()).toBe(legacyHomeDir());
  });

  it("trims valid HASNA_CONNECTORS_DIR values", () => {
    process.env["HASNA_CONNECTORS_DIR"] = "  /tmp/conn-home  ";
    expect(exactConnectorsHome()).toBe("/tmp/conn-home");
    expect(connectorsHome()).toBe("/tmp/conn-home");
  });
});
