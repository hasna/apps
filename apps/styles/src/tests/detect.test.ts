import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync, mkdirSync, rmdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { detectProjectPath, detectAgents, hasAnyAgent, getDetectedAgentNames } from "../lib/detect.js";

describe("detectAgents", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `styles-detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (existsSync(testDir)) {
      // Remove subdirs recursively
      for (const sub of [".claude", ".gemini", ".codex", ".opencode", ".pi", ".styles"]) {
        const subPath = join(testDir, sub);
        if (existsSync(subPath)) rmdirSync(subPath);
      }
      rmdirSync(testDir);
    }
  });

  test("detects no agents when no dirs exist", () => {
    const agents = detectAgents(testDir);
    expect(agents.claude).toBe(false);
    expect(agents.gemini).toBe(false);
    expect(agents.codex).toBe(false);
    expect(agents.opencode).toBe(false);
    expect(agents.pi).toBe(false);
    expect(hasAnyAgent(testDir)).toBe(false);
    expect(getDetectedAgentNames(testDir)).toEqual([]);
  });

  test("detects .claude directory", () => {
    mkdirSync(join(testDir, ".claude"));
    const agents = detectAgents(testDir);
    expect(agents.claude).toBe(true);
    expect(hasAnyAgent(testDir)).toBe(true);
    expect(getDetectedAgentNames(testDir)).toContain("claude");
  });

  test("detects multiple agent directories", () => {
    mkdirSync(join(testDir, ".claude"));
    mkdirSync(join(testDir, ".gemini"));
    const agents = detectAgents(testDir);
    expect(agents.claude).toBe(true);
    expect(agents.gemini).toBe(true);
    expect(agents.codex).toBe(false);
    expect(getDetectedAgentNames(testDir)).toEqual(["claude", "gemini"]);
  });

  test("detects all agents", () => {
    mkdirSync(join(testDir, ".claude"));
    mkdirSync(join(testDir, ".gemini"));
    mkdirSync(join(testDir, ".codex"));
    mkdirSync(join(testDir, ".opencode"));
    mkdirSync(join(testDir, ".pi"));
    const agents = detectAgents(testDir);
    for (const a of ["claude", "gemini", "codex", "opencode", "pi"]) {
      expect((agents as Record<string, boolean>)[a]).toBe(true);
    }
    expect(getDetectedAgentNames(testDir).length).toBe(5);
  });

  test("detectProjectPath walks up from cwd", () => {
    mkdirSync(join(testDir, ".styles"));
    const result = detectProjectPath(testDir);
    expect(result).toBe(testDir);
  });

  test("detectProjectPath finds .claude dir", () => {
    mkdirSync(join(testDir, ".claude"));
    const result = detectProjectPath(testDir);
    expect(result).toBe(testDir);
  });

  test("detectProjectPath falls back to package.json", () => {
    // No agent or styles dirs — need to check package.json scan
    // It walks up, so test that the function doesn't throw
    const result = detectProjectPath(testDir);
    expect(typeof result).toBe("string");
  });
});
