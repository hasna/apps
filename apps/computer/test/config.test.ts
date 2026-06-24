import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";

// We test the config functions by temporarily overriding HOME
const TEST_HOME = join(import.meta.dir, ".test-home");
const TEST_CONFIG_DIR = join(TEST_HOME, ".hasna", "computer");
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, "config.json");

import { DEFAULT_CONFIG } from "../src/lib/config.js";

describe("config", () => {

  test("DEFAULT_CONFIG has correct shape", () => {
    expect(DEFAULT_CONFIG.provider).toBe("anthropic");
    expect(DEFAULT_CONFIG.maxSteps).toBe(50);
    expect(DEFAULT_CONFIG.screenshotMaxWidth).toBe(1280);
    expect(DEFAULT_CONFIG.port).toBe(19450);
    expect(DEFAULT_CONFIG.saveScreenshots).toBe(false);
    expect(DEFAULT_CONFIG.providerFallback.enabled).toBe(false);
    expect(DEFAULT_CONFIG.providerFallback.fallbackOn).toContain("rate_limit");
  });

  test("DEFAULT_CONFIG has safety defaults", () => {
    expect(DEFAULT_CONFIG.safety).toBeDefined();
    expect(DEFAULT_CONFIG.safety.blockedApps).toBeArray();
    expect(DEFAULT_CONFIG.safety.blockedApps!.length).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.safety.maxActionsPerMinute).toBe(60);
    expect(DEFAULT_CONFIG.safety.allowPasswordTyping).toBe(false);
    expect(DEFAULT_CONFIG.safety.confirmClicks).toBe(false);
  });

  test("DEFAULT_CONFIG blocks Keychain Access", () => {
    expect(DEFAULT_CONFIG.safety.blockedApps).toContain("Keychain Access");
  });

  test("DEFAULT_CONFIG blocks System Settings", () => {
    expect(DEFAULT_CONFIG.safety.blockedApps).toContain("System Settings");
  });
});
