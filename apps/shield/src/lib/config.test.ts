import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  loadConfig,
  saveConfig,
  initProject,
  getProjectConfigPath,
  getProjectConfigDir,
  getGlobalConfigPath,
  getConfigPath,
} from "./config.js";
import { DEFAULT_CONFIG, Severity } from "../types/index.js";

describe("config", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "config-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("loadConfig", () => {
    test("returns defaults when no config files exist", () => {
      const config = loadConfig(tempDir);
      expect(config.enabled_scanners).toEqual(DEFAULT_CONFIG.enabled_scanners);
      expect(config.severity_threshold).toBe(DEFAULT_CONFIG.severity_threshold);
      expect(config.output_format).toBe(DEFAULT_CONFIG.output_format);
      expect(config.ignore_patterns).toEqual(DEFAULT_CONFIG.ignore_patterns);
      expect(config.auto_fix).toBe(false);
      expect(config.llm_analyze).toBe(false);
    });

    test("merges project config on top of defaults", () => {
      const configDir = join(tempDir, ".security");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "config.json"),
        JSON.stringify({ severity_threshold: "high", auto_fix: true }),
      );

      const config = loadConfig(tempDir);
      expect(config.severity_threshold).toBe(Severity.High);
      expect(config.auto_fix).toBe(true);
      // Other fields should still be defaults
      expect(config.output_format).toBe(DEFAULT_CONFIG.output_format);
    });

    test("handles malformed config file gracefully", () => {
      const configDir = join(tempDir, ".security");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), "not valid json {{{");

      // Should not throw, should return defaults
      const config = loadConfig(tempDir);
      expect(config.enabled_scanners).toEqual(DEFAULT_CONFIG.enabled_scanners);
    });

    test("migrates legacy global config into ~/.hasna/security", () => {
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      const originalDataHome = process.env.HASNA_DATA_HOME;
      const originalExactHome = process.env.HASNA_SHIELD_HOME;
      process.env.HOME = tempDir;
      delete process.env.USERPROFILE;
      delete process.env.HASNA_DATA_HOME;
      delete process.env.HASNA_SHIELD_HOME;
      const legacyDir = join(tempDir, ".security");
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(
        join(legacyDir, "config.json"),
        JSON.stringify({ severity_threshold: "high", auto_fix: true }),
      );

      try {
        const configPath = getGlobalConfigPath();
        expect(configPath).toBe(join(tempDir, ".hasna", "security", "config.json"));
        expect(existsSync(configPath)).toBe(true);
        const config = loadConfig();
        expect(config.severity_threshold).toBe(Severity.High);
        expect(config.auto_fix).toBe(true);
      } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        if (originalDataHome === undefined) delete process.env.HASNA_DATA_HOME;
        else process.env.HASNA_DATA_HOME = originalDataHome;
        if (originalExactHome === undefined) delete process.env.HASNA_SHIELD_HOME;
        else process.env.HASNA_SHIELD_HOME = originalExactHome;
      }
    });
  });

  describe("saveConfig", () => {
    test("saves config to project directory", () => {
      saveConfig({ auto_fix: true }, tempDir);
      const configPath = getProjectConfigPath(tempDir);
      expect(existsSync(configPath)).toBe(true);

      const config = loadConfig(tempDir);
      expect(config.auto_fix).toBe(true);
    });

    test("merges with existing config on save", () => {
      saveConfig({ auto_fix: true }, tempDir);
      saveConfig({ llm_analyze: true }, tempDir);

      const config = loadConfig(tempDir);
      expect(config.auto_fix).toBe(true);
      expect(config.llm_analyze).toBe(true);
    });

    test("creates directory if it does not exist", () => {
      const deepDir = join(tempDir, "nested", "project");
      mkdirSync(deepDir, { recursive: true });
      saveConfig({ auto_fix: true }, deepDir);

      const configDir = getProjectConfigDir(deepDir);
      expect(existsSync(configDir)).toBe(true);
    });
  });

  describe("initProject", () => {
    test("creates config directory and default config", () => {
      initProject(tempDir);

      const configDir = getProjectConfigDir(tempDir);
      const configPath = getProjectConfigPath(tempDir);
      expect(existsSync(configDir)).toBe(true);
      expect(existsSync(configPath)).toBe(true);
    });

    test("creates .gitignore in config directory", () => {
      initProject(tempDir);

      const gitignorePath = join(getProjectConfigDir(tempDir), ".gitignore");
      expect(existsSync(gitignorePath)).toBe(true);
      const gitignore = readFileSync(gitignorePath, "utf-8");
      expect(gitignore).toContain("*.db");
      expect(gitignore).toContain("*.db-journal");
      expect(gitignore).toContain("*.db-wal");
      expect(gitignore).toContain("*.db-shm");
    });

    test("upgrades existing .gitignore with WAL database sidecars", () => {
      const configDir = getProjectConfigDir(tempDir);
      mkdirSync(configDir, { recursive: true });
      const gitignorePath = join(configDir, ".gitignore");
      writeFileSync(gitignorePath, "*.db\ncache/\n", "utf-8");

      initProject(tempDir);

      const gitignore = readFileSync(gitignorePath, "utf-8");
      expect(gitignore).toContain("*.db");
      expect(gitignore).toContain("*.db-journal");
      expect(gitignore).toContain("*.db-wal");
      expect(gitignore).toContain("*.db-shm");
      expect(gitignore.match(/\*\.db\n/g)?.length ?? 0).toBe(1);
    });

    test("is idempotent (does not overwrite existing config)", () => {
      initProject(tempDir);

      // Modify the config
      saveConfig({ auto_fix: true }, tempDir);

      // Re-init should not overwrite
      initProject(tempDir);

      const config = loadConfig(tempDir);
      expect(config.auto_fix).toBe(true);
    });
  });
});
