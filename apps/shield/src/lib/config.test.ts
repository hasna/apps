import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig, saveConfig, initProject, getProjectConfigPath, getProjectConfigDir } from "./config.js";
import { DEFAULT_CONFIG, ScannerType, Severity, ReportFormat } from "../types/index.js";

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
      expect(config.severity_threshold).toBe("high");
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
