import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Temp HOME for testing
const testHome = join(tmpdir(), `brains-config-test-${Date.now()}`);
mkdirSync(join(testHome, ".hasna", "brains"), { recursive: true });

// Save and override HOME + config-related env vars before importing the module
const savedHome = process.env.HOME;
const savedEnv: Record<string, string | undefined> = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  THINKER_LABS_API_KEY: process.env.THINKER_LABS_API_KEY,
  THINKER_LABS_BASE_URL: process.env.THINKER_LABS_BASE_URL,
};
process.env.HOME = testHome;
delete process.env.OPENAI_API_KEY;
delete process.env.THINKER_LABS_API_KEY;
delete process.env.THINKER_LABS_BASE_URL;

const { getConfigValue, setConfigValue, listConfig, deleteConfigValue } = await import("./config.js");

const configPath = join(testHome, ".hasna", "brains", "config.json");

beforeEach(() => {
  // Clear config file and all relevant env vars before each test
  if (existsSync(configPath)) rmSync(configPath);
  delete process.env.OPENAI_API_KEY;
  delete process.env.THINKER_LABS_API_KEY;
  delete process.env.THINKER_LABS_BASE_URL;
});

afterAll(() => {
  // Restore HOME and env vars
  process.env.HOME = savedHome;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v !== undefined) process.env[k] = v; else delete process.env[k];
  }
  // Clean up test dir
  rmSync(testHome, { recursive: true, force: true });
});

describe("config", () => {
  test("returns undefined for unset key", () => {
    const val = getConfigValue("OPENAI_API_KEY");
    expect(val).toBeUndefined();
  });

  test("set and get a value from file", () => {
    setConfigValue("OPENAI_API_KEY", "sk-test-123");
    const val = getConfigValue("OPENAI_API_KEY");
    expect(val).toBe("sk-test-123");
  });

  test("env var takes precedence over file", () => {
    setConfigValue("OPENAI_API_KEY", "sk-from-file");
    process.env.OPENAI_API_KEY = "sk-from-env";
    const val = getConfigValue("OPENAI_API_KEY");
    expect(val).toBe("sk-from-env");
  });

  test("listConfig shows all keys with correct sources", () => {
    setConfigValue("THINKER_LABS_API_KEY", "tl-123");
    process.env.OPENAI_API_KEY = "sk-env";
    const entries = listConfig();
    const openai = entries.find((e) => e.key === "OPENAI_API_KEY");
    const thinker = entries.find((e) => e.key === "THINKER_LABS_API_KEY");
    const baseUrl = entries.find((e) => e.key === "THINKER_LABS_BASE_URL");
    expect(openai?.source).toBe("env");
    expect(thinker?.source).toBe("file");
    expect(baseUrl?.source).toBe("unset");
  });

  test("deleteConfigValue removes key from file", () => {
    setConfigValue("OPENAI_API_KEY", "sk-to-delete");
    deleteConfigValue("OPENAI_API_KEY");
    const val = getConfigValue("OPENAI_API_KEY");
    expect(val).toBeUndefined();
  });
});
