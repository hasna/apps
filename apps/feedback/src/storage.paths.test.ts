import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/contracts/paths";
import { DEFAULT_FEEDBACK_FILE, readStorageEnv, resolveFeedbackDataDir, resolveFeedbackFilePath } from "./storage.paths.js";
import {
  legacyDataRoot,
  resolverDataRoot,
  getDataDir,
  effectiveHome,
} from "./storage.paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
  "HASNA_FEEDBACK_HOME",
  "FEEDBACK_HOME",
  "HASNA_FEEDBACK_DATA_DIR",
  "FEEDBACK_DATA_DIR",
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
  tempHome = mkdtempSync(join(tmpdir(), "feedback-paths-"));
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
    expect(resolverDataRoot()).toBe(dataDir({ app: "feedback", home, env: process.env }));
  });

  test("on macOS the resolver (and therefore the effective) root is ~/.hasna/feedback", () => {
    const home = isolateHome();
    const mac = dataDir({ app: "feedback", home, platform: "darwin", env: process.env });
    expect(mac).toBe(join(home, ".hasna", "feedback"));
    expect(resolverDataRoot()).toBe(mac);
    expect(getDataDir()).toBe(mac);
  });

  test("on Linux the resolver root is the XDG data root", () => {
    const home = isolateHome();
    expect(dataDir({ app: "feedback", home, platform: "linux", env: process.env })).toBe(
      join(home, ".local", "share", "hasna", "feedback"),
    );
  });

  test("the effective root is the resolver root", () => {
    const home = isolateHome();
    expect(getDataDir()).toBe(dataDir({ app: "feedback", home, env: process.env }));
  });

  test("HASNA_DATA_HOME kind override moves the data root (app segment kept)", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "feedback-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(getDataDir()).toBe(join(base, "feedback"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "feedback-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(getDataDir()).toBe(dataDir({ app: "feedback", home, env: process.env }));
  });

  test("the pre-ruling legacy root is spelled under ~/.hasna/feedback", () => {
    const home = isolateHome();
    expect(legacyDataRoot()).toBe(join(home, ".hasna", "feedback"));
  });
});

describe("exact-app overrides and store layering", () => {
  test("exact-app overrides win over the resolver root", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "feedback-hasna-home-")); cleanups.push(override);
    process.env.HASNA_FEEDBACK_HOME = override;
    expect(getDataDir()).toBe(resolve(override));
    expect(resolveFeedbackFilePath()).toBe(join(resolve(override), DEFAULT_FEEDBACK_FILE));
  });

  test("HASNA_FEEDBACK_DATA_DIR names the data dir directly and wins", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "feedback-data-dir-")); cleanups.push(override);
    process.env.HASNA_FEEDBACK_DATA_DIR = override;
    expect(resolveFeedbackDataDir()).toBe(override);
    expect(resolveFeedbackFilePath()).toBe(join(override, DEFAULT_FEEDBACK_FILE));
  });

  test("readStorageEnv reads the prefixed name, then legacy aliases", () => {
    const env = { HASNA_FEEDBACK_X: "  ", FEEDBACK_X: "y" };
    expect(readStorageEnv(env, "X")).toBe("y");
    expect(readStorageEnv({}, "X")).toBeUndefined();
  });

});
