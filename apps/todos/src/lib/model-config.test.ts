import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getActiveModel, setActiveModel, clearActiveModel, DEFAULT_MODEL } from "./model-config.js";

const testHomeDir = `/tmp/todos-test-model-config-${Date.now()}`;
const configDir = join(testHomeDir, ".hasna", "todos");
const configPath = join(configDir, "config.json");

beforeAll(() => {
  mkdirSync(configDir, { recursive: true });
  process.env["HOME"] = testHomeDir;
});

afterAll(() => {
  rmSync(testHomeDir, { recursive: true, force: true });
  // Reset to ensure no cached state
  delete process.env["HOME"];
});

describe("DEFAULT_MODEL", () => {
  it("should export the default model", () => {
    expect(DEFAULT_MODEL).toBe("gpt-4o-mini");
  });
});

describe("getActiveModel", () => {
  it("should return the default model when no config exists", () => {
    // Ensure config doesn't exist
    if (existsSync(configPath)) rmSync(configPath);
    expect(getActiveModel()).toBe(DEFAULT_MODEL);
  });

  it("should return the configured active model", () => {
    setActiveModel("ft:custom-model-v1");
    expect(getActiveModel()).toBe("ft:custom-model-v1");
  });
});

describe("setActiveModel", () => {
  it("should set the active model in config", () => {
    setActiveModel("ft:my-model-v2");
    expect(getActiveModel()).toBe("ft:my-model-v2");
  });
});

describe("clearActiveModel", () => {
  it("should revert to default model", () => {
    setActiveModel("ft:temp-model");
    clearActiveModel();
    expect(getActiveModel()).toBe(DEFAULT_MODEL);
  });
});

describe("model config path", () => {
  it("writes active model config to ~/.hasna/todos even when legacy ~/.todos exists", () => {
    const legacyDir = join(testHomeDir, ".todos");
    const legacyConfigPath = join(legacyDir, "config.json");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(legacyConfigPath, JSON.stringify({ activeModel: "ft:legacy-model" }));
    if (existsSync(configPath)) rmSync(configPath);

    setActiveModel("ft:new-model");

    expect(existsSync(configPath)).toBe(true);
    expect(getActiveModel()).toBe("ft:new-model");
  });
});
