import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearConfigCache, getConfig, getDefaultWorkspaceRoots, getFilterAlias, getWorkspaceRoots } from "./config";

/** True when the filesystem resolves both spellings to the same directory. */
function sameDirectory(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

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

    it("returns one root when both spellings of the home workspace are the same directory", () => {
      const home = join(testDir, "home");
      mkdirSync(join(home, "workspace"), { recursive: true });
      // On a case-insensitive filesystem (macOS APFS) both candidates exist
      // and are one directory; on a case-sensitive one only the lowercase
      // candidate exists. Either way exactly one root must come back, or the
      // scanner walks (and indexes) every checkout twice.
      const roots = getDefaultWorkspaceRoots(home, existsSync);
      expect(roots).toEqual([resolve(join(home, "workspace"))]);
    });

    it("keeps distinct directories distinct when the filesystem is case-sensitive", () => {
      const home = join(testDir, "home-cs");
      mkdirSync(join(home, "workspace"), { recursive: true });
      const roots = getDefaultWorkspaceRoots(home, (path) =>
        path === join(home, "workspace") || path === join(home, "Workspace"),
      );
      // The dedupe answers from the filesystem, not from the injected
      // predicate: when the two spellings are genuinely one directory they
      // collapse; when the second is a different path (or does not resolve)
      // both survive.
      if (sameDirectory(join(home, "workspace"), join(home, "Workspace"))) {
        expect(roots).toEqual([resolve(join(home, "workspace"))]);
      } else {
        expect(roots).toEqual([resolve(join(home, "workspace")), resolve(join(home, "Workspace"))]);
      }
    });
  });

  describe("getWorkspaceRoots", () => {
    it("dedupes case-variant roots of one directory by canonical identity", () => {
      const root = join(testDir, "root");
      const lowercase = join(root, "workspace");
      mkdirSync(lowercase, { recursive: true });
      const uppercase = join(root, "Workspace");
      const roots = getWorkspaceRoots([lowercase, uppercase]);
      if (sameDirectory(lowercase, uppercase)) {
        expect(roots).toHaveLength(1);
        expect(roots[0]).toBe(lowercase);
      } else {
        // Case-sensitive FS: the uppercase spelling is not the same
        // directory, so both roots survive — behavior unchanged.
        expect(roots).toEqual([resolve(lowercase), resolve(uppercase)]);
      }
    });
  });
});
