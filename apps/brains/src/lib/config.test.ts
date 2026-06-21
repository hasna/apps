import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
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

function chmodIfSupported(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Windows and some filesystems do not support POSIX mode changes.
  }
}

function expectOwnerOnlyMode(path: string): void {
  if (process.platform === "win32") return;
  expect(statSync(path).mode & 0o777).toBe(0o600);
}

function expectOwnerOnlyDirectory(path: string): void {
  if (process.platform === "win32") return;
  expect(statSync(path).mode & 0o777).toBe(0o700);
}

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

  test("writes config file with owner-only permissions", () => {
    setConfigValue("OPENAI_API_KEY", "test-secret");
    expect(existsSync(configPath)).toBe(true);
    expectOwnerOnlyMode(configPath);
  });

  test("tightens permissions on an existing config file", () => {
    writeFileSync(configPath, "{}\n", { encoding: "utf-8", mode: 0o644 });
    chmodIfSupported(configPath, 0o644);

    setConfigValue("OPENAI_API_KEY", "test-secret");

    expect(getConfigValue("OPENAI_API_KEY")).toBe("test-secret");
    expectOwnerOnlyMode(configPath);
  });

  test("tightens permissions when migrating legacy config", () => {
    const legacyHome = join(tmpdir(), `brains-config-legacy-${Date.now()}`);
    const legacyDir = join(legacyHome, ".brains");
    const legacyConfigPath = join(legacyDir, "config.json");
    const migratedConfigPath = join(legacyHome, ".hasna", "brains", "config.json");
    const currentHome = process.env.HOME;

    try {
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(legacyConfigPath, '{"OPENAI_API_KEY":"legacy-secret"}\n', { encoding: "utf-8", mode: 0o644 });
      chmodIfSupported(legacyConfigPath, 0o644);

      process.env.HOME = legacyHome;

      expect(getConfigValue("OPENAI_API_KEY")).toBe("legacy-secret");
      expect(existsSync(migratedConfigPath)).toBe(true);
      expectOwnerOnlyMode(migratedConfigPath);
    } finally {
      process.env.HOME = currentHome;
      rmSync(legacyHome, { recursive: true, force: true });
    }
  });

  test("does not write through a planted predictable temp symlink", () => {
    if (process.platform === "win32") return;

    const configDir = join(testHome, ".hasna", "brains");
    const leakPath = join(testHome, "leak-target.txt");
    const fixedNow = 1234567890;
    const plantedTempPath = join(configDir, `.config.json.${process.pid}.${fixedNow}.tmp`);
    const originalNow = Date.now;

    try {
      writeFileSync(leakPath, "", { encoding: "utf-8", mode: 0o666 });
      chmodIfSupported(leakPath, 0o666);
      symlinkSync(leakPath, plantedTempPath);
      Date.now = () => fixedNow;

      setConfigValue("OPENAI_API_KEY", "symlink-safe-secret");

      expect(readFileSync(leakPath, "utf-8")).toBe("");
      expect(lstatSync(configPath).isSymbolicLink()).toBe(false);
      expectOwnerOnlyMode(configPath);
    } finally {
      Date.now = originalNow;
      rmSync(plantedTempPath, { force: true });
      rmSync(leakPath, { force: true });
    }
  });

  test("creates config directories with owner-only permissions", () => {
    const switchedHome = join(tmpdir(), `brains-config-dir-mode-${Date.now()}`);
    const currentHome = process.env.HOME;

    try {
      process.env.HOME = switchedHome;
      setConfigValue("OPENAI_API_KEY", "dir-mode-secret");

      expectOwnerOnlyDirectory(join(switchedHome, ".hasna"));
      expectOwnerOnlyDirectory(join(switchedHome, ".hasna", "brains"));
    } finally {
      process.env.HOME = currentHome;
      rmSync(switchedHome, { recursive: true, force: true });
    }
  });

  test("tightens symlinked config directory targets", () => {
    if (process.platform === "win32") return;

    const symlinkHome = join(tmpdir(), `brains-config-symlink-dir-${Date.now()}`);
    const targetDir = join(tmpdir(), `brains-config-symlink-target-${Date.now()}`);
    const hasnaDir = join(symlinkHome, ".hasna");
    const linkedBrainsDir = join(hasnaDir, "brains");
    const linkedConfigPath = join(linkedBrainsDir, "config.json");
    const currentHome = process.env.HOME;

    try {
      mkdirSync(hasnaDir, { recursive: true });
      mkdirSync(targetDir, { recursive: true, mode: 0o777 });
      chmodIfSupported(targetDir, 0o777);
      symlinkSync(targetDir, linkedBrainsDir);

      process.env.HOME = symlinkHome;
      setConfigValue("OPENAI_API_KEY", "symlink-dir-secret");

      expect(getConfigValue("OPENAI_API_KEY")).toBe("symlink-dir-secret");
      expect(lstatSync(linkedBrainsDir).isSymbolicLink()).toBe(true);
      expectOwnerOnlyDirectory(targetDir);
      expectOwnerOnlyMode(linkedConfigPath);
    } finally {
      process.env.HOME = currentHome;
      rmSync(symlinkHome, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test("uses the current HOME when reading and writing config", () => {
    const switchedHome = join(tmpdir(), `brains-config-home-switch-${Date.now()}`);
    const switchedConfigPath = join(switchedHome, ".hasna", "brains", "config.json");
    const currentHome = process.env.HOME;

    try {
      process.env.HOME = switchedHome;
      setConfigValue("OPENAI_API_KEY", "home-switch-secret");

      expect(existsSync(switchedConfigPath)).toBe(true);
      expect(getConfigValue("OPENAI_API_KEY")).toBe("home-switch-secret");
    } finally {
      process.env.HOME = currentHome;
      rmSync(switchedHome, { recursive: true, force: true });
    }
  });
});
