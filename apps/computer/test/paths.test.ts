import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { getHomeDir, getAppDataDir, getDefaultScreenshotsDir } from "../src/lib/home.js";
import { getConfigPath, loadConfig, saveConfig, DEFAULT_CONFIG } from "../src/lib/config.js";
import { getDataDir, getDbPath } from "../src/db/index.js";

const ENV_KEYS = ["HOME", "USERPROFILE", "COMPUTER_DATA_DIR", "COMPUTER_DB_PATH"] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let tempHome: string | null = null;

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
});

function isolateHome(): string {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  tempHome = mkdtempSync(join(tmpdir(), "computer-home-test-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  delete process.env.COMPUTER_DATA_DIR;
  delete process.env.COMPUTER_DB_PATH;
  return tempHome;
}

describe("canonical data root", () => {
  test("getHomeDir resolves $HOME and never a literal ~", () => {
    const home = isolateHome();
    expect(getHomeDir()).toBe(home);
  });

  test("getHomeDir falls back to USERPROFILE when HOME is unset", () => {
    isolateHome();
    delete process.env.HOME;
    process.env.USERPROFILE = "/fake-profile";
    expect(getHomeDir()).toBe("/fake-profile");
  });

  test("getHomeDir never returns empty, literal ~, or undefined prefix with no env home", () => {
    isolateHome();
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    const home = getHomeDir();
    expect(home.length).toBeGreaterThan(0);
    expect(home).not.toBe("~");
    expect(home.startsWith("undefined")).toBe(false);
  });

  test("getAppDataDir resolves to ~/.hasna/computer", () => {
    const home = isolateHome();
    expect(getAppDataDir()).toBe(join(home, ".hasna", "computer"));
  });

  test("getConfigPath resolves to ~/.hasna/computer/config.json", () => {
    const home = isolateHome();
    expect(getConfigPath()).toBe(join(home, ".hasna", "computer", "config.json"));
  });

  test("loadConfig reads the config from the canonical path", () => {
    const home = isolateHome();
    mkdirSync(join(home, ".hasna", "computer"), { recursive: true });
    writeFileSync(join(home, ".hasna", "computer", "config.json"), JSON.stringify({ maxSteps: 7 }));
    expect(loadConfig().maxSteps).toBe(7);
  });

  test("saveConfig writes the config to the canonical path", () => {
    const home = isolateHome();
    saveConfig({ ...DEFAULT_CONFIG, maxSteps: 9 });
    const raw = JSON.parse(readFileSync(join(home, ".hasna", "computer", "config.json"), "utf8"));
    expect(raw.maxSteps).toBe(9);
  });

  test("getDataDir default resolves to ~/.hasna/computer", () => {
    const home = isolateHome();
    expect(getDataDir()).toBe(join(home, ".hasna", "computer"));
    expect(existsSync(join(home, ".hasna", "computer"))).toBe(true);
  });

  test("COMPUTER_DATA_DIR override still wins over the default", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "computer-override-"));
    process.env.COMPUTER_DATA_DIR = override;
    expect(getDataDir()).toBe(override);
    rmSync(override, { recursive: true, force: true });
  });

  test("COMPUTER_DB_PATH override still wins over the default", () => {
    isolateHome();
    const override = join(mkdtempSync(join(tmpdir(), "computer-db-override-")), "custom.db");
    process.env.COMPUTER_DB_PATH = override;
    expect(getDbPath()).toBe(override);
    rmSync(dirname(override), { recursive: true, force: true });
  });

  test("getDefaultScreenshotsDir resolves under ~/.hasna/computer/screenshots", () => {
    const home = isolateHome();
    expect(getDefaultScreenshotsDir("abc")).toBe(join(home, ".hasna", "computer", "screenshots", "abc"));
  });

  test("defaults never contain a literal ~ or undefined prefix when HOME is unset", () => {
    isolateHome();
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    for (const p of [getAppDataDir(), getConfigPath(), getDefaultScreenshotsDir("x")]) {
      expect(p.startsWith("~")).toBe(false);
      expect(p.startsWith("undefined")).toBe(false);
    }
  });
});
