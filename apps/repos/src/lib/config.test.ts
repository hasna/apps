import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearConfigCache, getConfig, getDefaultWorkspaceRoots, getFilterAlias } from "./config";

let testDir = "";
let configPath = "";

beforeEach(() => {
  testDir = join(tmpdir(), `open-repos-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  configPath = join(testDir, "config.json");
  process.env["HASNA_REPOS_CONFIG_PATH"] = configPath;
  clearConfigCache();
});

afterEach(() => {
  clearConfigCache();
  delete process.env["HASNA_REPOS_CONFIG_PATH"];
  rmSync(testDir, { recursive: true, force: true });
});

describe("config", () => {
  describe("getConfig", () => {
    it("should return default config when no config file exists", () => {
      const cfg = getConfig();
      expect(cfg.commitLimit).toBe(5000);
      expect(cfg.incrementalCommitLimit).toBe(100);
      expect(cfg.scanDepth).toBe(5);
      expect(cfg.excludedPaths).toEqual(["node_modules", "dist", "vendor", ".git"]);
      expect(Array.isArray(cfg.workspaceRoots)).toBe(true);
      expect((cfg.workspaceRoots ?? []).length).toBeGreaterThan(0);
    });

    it("should merge custom config over defaults", () => {
      writeFileSync(configPath, JSON.stringify({
        commitLimit: 1000,
        scanDepth: 3,
        workspaceRoots: ["./workspace-a", "../workspace-b"],
      }));

      clearConfigCache();
      const cfg = getConfig();
      expect(cfg.commitLimit).toBe(1000);
      expect(cfg.scanDepth).toBe(3);
      expect(cfg.incrementalCommitLimit).toBe(100);
      expect(cfg.workspaceRoots).toEqual([
        resolve("./workspace-a"),
        resolve("../workspace-b"),
      ]);
    });

    it("should cache config until reset", () => {
      writeFileSync(configPath, JSON.stringify({ commitLimit: 9999 }));
      clearConfigCache();

      const first = getConfig();
      writeFileSync(configPath, JSON.stringify({ commitLimit: 1 }));
      const second = getConfig();
      clearConfigCache();
      const third = getConfig();

      expect(first.commitLimit).toBe(9999);
      expect(second.commitLimit).toBe(9999);
      expect(third.commitLimit).toBe(1);
    });

    it("should fall back to defaults for invalid JSON", () => {
      writeFileSync(configPath, "not valid json {{{");
      clearConfigCache();

      const cfg = getConfig();
      expect(cfg.commitLimit).toBe(5000);
      expect(cfg.workspaceRoots?.length).toBeGreaterThan(0);
    });

    it("should support custom excludedPaths", () => {
      writeFileSync(configPath, JSON.stringify({ excludedPaths: ["build", ".cache"] }));
      clearConfigCache();

      const cfg = getConfig();
      expect(cfg.excludedPaths).toEqual(["build", ".cache"]);
    });
  });

  describe("getFilterAlias", () => {
    it("should return undefined for unknown alias", () => {
      writeFileSync(configPath, JSON.stringify({ aliases: { work: { org: "acme" } } }));
      clearConfigCache();
      expect(getFilterAlias("nonexistent")).toBeUndefined();
    });

    it("should return alias with org", () => {
      writeFileSync(configPath, JSON.stringify({ aliases: { work: { org: "hasna" } } }));
      clearConfigCache();
      expect(getFilterAlias("work")).toEqual({ org: "hasna" });
    });

    it("should return alias with paths", () => {
      writeFileSync(configPath, JSON.stringify({ aliases: { local: { paths: ["/a", "/b"] } } }));
      clearConfigCache();
      expect(getFilterAlias("local")).toEqual({ paths: ["/a", "/b"] });
    });

    it("should return alias with query", () => {
      writeFileSync(configPath, JSON.stringify({ aliases: { ai: { query: "openai" } } }));
      clearConfigCache();
      expect(getFilterAlias("ai")).toEqual({ query: "openai" });
    });

    it("should return undefined when no aliases defined", () => {
      writeFileSync(configPath, JSON.stringify({ commitLimit: 1000 }));
      clearConfigCache();
      expect(getFilterAlias("anything")).toBeUndefined();
    });
  });

  describe("getDefaultWorkspaceRoots", () => {
    it("should prefer existing workspace directories", () => {
      const roots = getDefaultWorkspaceRoots("/tmp/test-home", (path) => path.endsWith("/workspace"));
      expect(roots).toEqual([resolve("/tmp/test-home/workspace")]);
    });

    it("should fall back to lowercase workspace when no directory exists", () => {
      const roots = getDefaultWorkspaceRoots("/tmp/test-home", () => false);
      expect(roots).toEqual([resolve("/tmp/test-home/workspace")]);
    });
  });
});
