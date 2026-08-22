// Test-gap lane: agent-authored analysis (SOL consult refused — gpt-5.6-sol consult timed out twice within the 2x600s protocol bound; no answer delivered). Authored by Paulinus.
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "node:os";
import {
  DEFAULT_CONFIG,
  getConfigValue,
  loadConfig,
  saveConfig,
  setConfigValue,
} from "../src/lib/config.js";

let savedHome: string | undefined;
let tempHome: string | null = null;

function isolateHome(): string {
  savedHome = process.env.HOME;
  tempHome = mkdtempSync(join(tmpdir(), "computer-config-test-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  return tempHome;
}

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  savedHome = undefined;
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
});

function configPath(): string {
  return join(tempHome!, ".hasna", "computer", "config.json");
}

describe("config behavior", () => {
  test("loadConfig falls back to defaults on invalid JSON, and does not throw", () => {
    isolateHome();
    mkdirSync(join(tempHome!, ".hasna", "computer"), { recursive: true });
    writeFileSync(configPath(), "not json {{{");
    const config = loadConfig();
    expect(config.maxSteps).toBe(DEFAULT_CONFIG.maxSteps);
    expect(config.provider).toBe("anthropic");
  });

  test("loadConfig deep-merges a partial safety block onto defaults", () => {
    isolateHome();
    mkdirSync(join(tempHome!, ".hasna", "computer"), { recursive: true });
    writeFileSync(configPath(), JSON.stringify({ safety: { blockedApps: ["Trello"] } }));
    const config = loadConfig();
    expect(config.safety.blockedApps).toEqual(["Trello"]);
    // untouched safety fields keep defaults, not undefined
    expect(config.safety.confirmClicks).toBe(false);
    expect(config.safety.maxActionsPerMinute).toBe(60);
    expect(config.safety.allowPasswordTyping).toBe(false);
  });

  test("loadConfig read failure (missing file) returns defaults", () => {
    isolateHome();
    const config = loadConfig();
    expect(config.safety.blockedApps).toContain("Keychain Access");
  });

  test("getConfigValue returns undefined for missing paths", () => {
    isolateHome();
    saveConfig({ ...DEFAULT_CONFIG, maxSteps: 7 });
    expect(getConfigValue("maxSteps")).toBe(7);
    expect(getConfigValue("safety.blockedApps")).toEqual(DEFAULT_CONFIG.safety.blockedApps);
    expect(getConfigValue("no.such.path")).toBeUndefined();
    expect(getConfigValue("")).toBeUndefined();
  });

  test("setConfigValue auto-parses true/false/digits", () => {
    isolateHome();
    saveConfig({ ...DEFAULT_CONFIG });
    setConfigValue("safety.confirmClicks", "true");
    setConfigValue("safety.allowPasswordTyping", "false");
    setConfigValue("maxSteps", "25");
    const config = loadConfig();
    expect(config.safety.confirmClicks).toBe(true);
    expect(config.safety.allowPasswordTyping).toBe(false);
    expect(config.maxSteps).toBe(25);
  });

  test("setConfigValue keeps non-numeric strings as strings", () => {
    isolateHome();
    setConfigValue("model", "claude-opus-4-6");
    expect(loadConfig().model).toBe("claude-opus-4-6");
  });

  test("setConfigValue writes unknown nested paths to disk, but loadConfig's schema-strict merge drops them", () => {
    isolateHome();
    setConfigValue("safety.newSection.enabled", "true");
    // The raw file carries the value...
    const raw = JSON.parse(readFileSync(configPath(), "utf8"));
    expect(raw.safety.newSection.enabled).toBe(true);
    // ...but mergeConfig only carries the declared safety fields, so the
    // runtime config never exposes it. This pins the schema-strict contract.
    const config = loadConfig();
    expect(config.safety.newSection).toBeUndefined();
    expect(config.safety.confirmClicks).toBe(false);
  });

  test("setConfigValue round-trips through saveConfig on disk", () => {
    isolateHome();
    setConfigValue("port", "9000");
    const raw = JSON.parse(readFileSync(configPath(), "utf8"));
    expect(raw.port).toBe(9000);
  });

  test("getConfigValue on a scalar path with extra segments is undefined", () => {
    isolateHome();
    saveConfig({ ...DEFAULT_CONFIG, maxSteps: 3 });
    expect(getConfigValue("maxSteps.deep")).toBeUndefined();
  });
});
