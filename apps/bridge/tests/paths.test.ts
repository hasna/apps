import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { bridgeHome, defaultConfigPath, homeDir } from "../src/lib/paths.js";
import { defaultStatePath } from "../src/lib/state.js";

describe("canonical data root (~/.hasna/bridge)", () => {
  let originalHome: string | undefined;
  let originalBridgeHome: string | undefined;
  let originalBridgeConfig: string | undefined;
  let originalBridgeState: string | undefined;

  beforeEach(() => {
    originalHome = process.env["HOME"];
    originalBridgeHome = process.env["BRIDGE_HOME"];
    originalBridgeConfig = process.env["BRIDGE_CONFIG"];
    originalBridgeState = process.env["BRIDGE_STATE"];
  });

  afterEach(() => {
    restoreEnv("HOME", originalHome);
    restoreEnv("BRIDGE_HOME", originalBridgeHome);
    restoreEnv("BRIDGE_CONFIG", originalBridgeConfig);
    restoreEnv("BRIDGE_STATE", originalBridgeState);
  });

  test("defaults resolve beneath ~/.hasna/bridge under a fake HOME", () => {
    process.env["HOME"] = "/fake/home";

    expect(homeDir()).toBe("/fake/home");
    expect(bridgeHome()).toBe("/fake/home/.hasna/bridge");
    expect(defaultConfigPath()).toBe("/fake/home/.hasna/bridge/config.json");
    expect(defaultStatePath()).toBe("/fake/home/.hasna/bridge/state.json");
  });

  test("BRIDGE_HOME override wins over the canonical default", () => {
    process.env["HOME"] = "/fake/home";
    process.env["BRIDGE_HOME"] = "/fake/override";

    expect(bridgeHome()).toBe("/fake/override");
    expect(defaultConfigPath()).toBe("/fake/override/config.json");
    expect(defaultStatePath()).toBe("/fake/override/state.json");
  });

  test("BRIDGE_CONFIG and BRIDGE_STATE overrides win independently", () => {
    process.env["HOME"] = "/fake/home";
    process.env["BRIDGE_CONFIG"] = "/tmp/custom-config.json";
    process.env["BRIDGE_STATE"] = "/tmp/custom-state.json";

    expect(defaultConfigPath()).toBe("/tmp/custom-config.json");
    expect(defaultStatePath()).toBe("/tmp/custom-state.json");
    expect(bridgeHome()).toBe("/fake/home/.hasna/bridge");
  });

  test("never falls back to cwd when HOME is unset", () => {
    const cwd = process.cwd();
    delete process.env["HOME"];

    const result = bridgeHome();
    const expectedHome = homedir();

    // The canonical home (passwd-backed when HOME is unset), never the cwd —
    // either on the legacy layout or on the XDG data home once migrated.
    expect(result.startsWith(cwd)).toBe(false);
    expect(result.startsWith(expectedHome)).toBe(true);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
