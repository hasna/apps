import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/contracts/paths";
import { existsSync } from "node:fs";
import { runsDir, runbookPromptDir } from "./paths.js";
import {
  legacyDataRoot,
  resolverDataRoot,
  getDataRoot,
  effectiveHome,
} from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
  "HASNA_PROMPTS_HOME",
  "PROMPTS_HOME",
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
  tempHome = mkdtempSync(join(tmpdir(), "prompts-paths-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  return tempHome;
}

describe("paths resolver wiring (single resolver in @hasna/contracts, ruling #1668)", () => {
  test("home resolves HOME first", () => {
    const home = isolateHome();
    expect(effectiveHome()).toBe(home);
  });

  test("the resolver data root is the contracts resolver root for this machine", () => {
    const home = isolateHome();
    expect(resolverDataRoot()).toBe(dataDir({ app: "prompts", home, env: process.env }));
  });

  test("on macOS the resolver (and therefore the effective) root is ~/.hasna/prompts", () => {
    const home = isolateHome();
    const mac = dataDir({ app: "prompts", home, platform: "darwin", env: process.env });
    expect(mac).toBe(join(home, ".hasna", "prompts"));
    expect(resolverDataRoot()).toBe(mac);
    expect(getDataRoot()).toBe(mac);
  });

  test("on Linux the resolver root is the XDG data root", () => {
    const home = isolateHome();
    expect(dataDir({ app: "prompts", home, platform: "linux", env: process.env })).toBe(
      join(home, ".local", "share", "hasna", "prompts"),
    );
  });

  test("the effective root is the resolver root", () => {
    const home = isolateHome();
    expect(getDataRoot()).toBe(dataDir({ app: "prompts", home, env: process.env }));
  });

  test("HASNA_DATA_HOME kind override moves the data root (app segment kept)", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "prompts-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(getDataRoot()).toBe(join(base, "prompts"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "prompts-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(getDataRoot()).toBe(dataDir({ app: "prompts", home, env: process.env }));
  });

  test("the pre-ruling legacy root is spelled under ~/.hasna/prompts", () => {
    const home = isolateHome();
    expect(legacyDataRoot()).toBe(join(home, ".hasna", "prompts"));
  });
});

describe("exact-app overrides and store layering", () => {
  test("HASNA_PROMPTS_HOME exact override wins over the resolver root", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "prompts-hasna-home-")); cleanups.push(override);
    process.env.HASNA_PROMPTS_HOME = override;
    expect(getDataRoot()).toBe(resolve(override));
  });

  test("legacy PROMPTS_HOME exact override is honoured when the primary is blank", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "prompts-home-")); cleanups.push(override);
    process.env.HASNA_PROMPTS_HOME = "   ";
    process.env.PROMPTS_HOME = override;
    expect(getDataRoot()).toBe(resolve(override));
  });

  test("runbook prompts live under the loops app data home (ruling #1668)", () => {
    const home = isolateHome();
    expect(runbookPromptDir()).toBe(join(dataDir({ app: "loops", home, env: process.env }), "prompts"));
  });

  test("runs dir follows the effective root; default resolution never creates either home", () => {
    const home = isolateHome();
    expect(runsDir()).toBe(join(dataDir({ app: "prompts", home, env: process.env }), "runs"));
    expect(existsSync(join(home, ".hasna", "prompts"))).toBe(false);
    expect(existsSync(join(home, ".local", "share", "hasna", "prompts"))).toBe(false);
  });

});
