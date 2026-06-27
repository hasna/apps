import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  injectStyleHook,
  injectAllStyleHooks,
  removeStyleHook,
  removeAllStyleHooks,
  isHookInstalled,
  getInstalledAgentHooks,
  getClaudeSettingsPath,
} from "../lib/hookmanager.js";

describe("hookmanager", () => {
  let testProjectPath = "";

  beforeEach(() => {
    testProjectPath = join(tmpdir(), `styles-hooks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testProjectPath, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testProjectPath)) {
      // Clean up agent dirs
      for (const agentDir of [".claude", ".gemini", ".codex", ".opencode", ".pi"]) {
        const p = join(testProjectPath, agentDir);
        if (existsSync(p)) rmSync(p, { recursive: true, force: true });
      }
      rmSync(testProjectPath, { recursive: true, force: true });
    }
  });

  describe("injectStyleHook + isHookInstalled", () => {
    test("creates .claude/settings.json with hook", () => {
      const result = injectStyleHook(testProjectPath, "claude");
      expect(result.success).toBe(true);
      expect(result.agent).toBe("claude");
      expect(result.alreadyInstalled).toBe(false);
      expect(existsSync(join(testProjectPath, ".claude", "settings.json"))).toBe(true);
    });

    test("detects already installed hook", () => {
      injectStyleHook(testProjectPath, "claude");
      const result = injectStyleHook(testProjectPath, "claude");
      expect(result.alreadyInstalled).toBe(true);
    });

    test("isHookInstalled returns true after injection", () => {
      injectStyleHook(testProjectPath, "claude");
      expect(isHookInstalled(testProjectPath, "claude")).toBe(true);
    });

    test("isHookInstalled returns false for non-existent agent", () => {
      expect(isHookInstalled(testProjectPath, "claude")).toBe(false);
    });

    test("injects gemini hook", () => {
      const result = injectStyleHook(testProjectPath, "gemini");
      expect(result.success).toBe(true);
      expect(existsSync(join(testProjectPath, ".gemini", "settings.json"))).toBe(true);
    });

    test("injects codex hook", () => {
      const result = injectStyleHook(testProjectPath, "codex");
      expect(result.success).toBe(true);
      expect(existsSync(join(testProjectPath, ".codex", "config.toml"))).toBe(true);
    });

    test("injects opencode hook", () => {
      const result = injectStyleHook(testProjectPath, "opencode");
      expect(result.success).toBe(true);
      expect(existsSync(join(testProjectPath, ".opencode", "config.json"))).toBe(true);
    });

    test("injects pi hook", () => {
      const result = injectStyleHook(testProjectPath, "pi");
      expect(result.success).toBe(true);
      expect(existsSync(join(testProjectPath, ".pi", "config.json"))).toBe(true);
    });

    test("default agent is claude", () => {
      const result = injectStyleHook(testProjectPath);
      expect(result.agent).toBe("claude");
    });
  });

  describe("removeStyleHook", () => {
    test("removes claude hook", () => {
      injectStyleHook(testProjectPath, "claude");
      expect(isHookInstalled(testProjectPath, "claude")).toBe(true);
      removeStyleHook(testProjectPath, "claude");
      expect(isHookInstalled(testProjectPath, "claude")).toBe(false);
    });

    test("no-op for non-installed hook", () => {
      expect(() => removeStyleHook(testProjectPath, "claude")).not.toThrow();
    });

    test("removes gemini hook", () => {
      injectStyleHook(testProjectPath, "gemini");
      removeStyleHook(testProjectPath, "gemini");
      expect(isHookInstalled(testProjectPath, "gemini")).toBe(false);
    });
  });

  describe("injectAllStyleHooks + removeAllStyleHooks", () => {
    test("returns null for undetected agents", () => {
      const results = injectAllStyleHooks(testProjectPath);
      // No agent dirs exist, so all should be null
      for (const [, val] of Object.entries(results)) {
        expect(val).toBeNull();
      }
    });

    test("injects for detected agents only", () => {
      mkdirSync(join(testProjectPath, ".claude"));
      const results = injectAllStyleHooks(testProjectPath);
      expect(results.claude).not.toBeNull();
      expect(results.gemini).toBeNull();
    });

    test("removeAllStyleHooks", () => {
      mkdirSync(join(testProjectPath, ".claude"));
      injectAllStyleHooks(testProjectPath);
      removeAllStyleHooks(testProjectPath);
      expect(isHookInstalled(testProjectPath, "claude")).toBe(false);
    });
  });

  describe("getInstalledAgentHooks", () => {
    test("returns empty when no hooks", () => {
      expect(getInstalledAgentHooks(testProjectPath)).toEqual([]);
    });

    test("returns agents with hooks", () => {
      mkdirSync(join(testProjectPath, ".claude"));
      injectStyleHook(testProjectPath, "claude");
      const hooks = getInstalledAgentHooks(testProjectPath);
      expect(hooks).toContain("claude");
    });
  });

  describe("getClaudeSettingsPath", () => {
    test("returns correct path", () => {
      const path = getClaudeSettingsPath(testProjectPath);
      expect(path).toContain(".claude");
      expect(path).toContain("settings.json");
    });
  });
});
