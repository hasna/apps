import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We need to test fs.ts in isolation without touching ~/.styles
// All functions in fs.ts use getStylesDir() which returns join(homedir(), ".styles")
// For testing, we test the pure utility functions and those that accept a projectPath

import {
  getStylesDir,
  hashProjectPath,
  initProjectDir,
  getProjectConfig,
  setProjectConfig,
  listProjectDirs,
  getProjectDir,
} from "../src/lib/fs.js";

// We can't easily override homedir(), so we test what we can:
// - getStylesDir() returns a path containing ".styles"
// - hashProjectPath() is deterministic and returns a string
// - setProjectConfig + getProjectConfig round-trips (these write to ~/.styles, so we test via actual calls)

describe("getStylesDir", () => {
  test("returns a path containing '.styles'", () => {
    const dir = getStylesDir();
    expect(dir).toContain(".styles");
  });
});

describe("hashProjectPath", () => {
  test("returns a string", () => {
    const hash = hashProjectPath("/some/project");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  test("is deterministic — same input yields same output", () => {
    const a = hashProjectPath("/some/project");
    const b = hashProjectPath("/some/project");
    expect(a).toBe(b);
  });

  test("different paths produce different hashes", () => {
    const a = hashProjectPath("/path/to/project-a");
    const b = hashProjectPath("/path/to/project-b");
    expect(a).not.toBe(b);
  });

  test("includes the basename in the hash", () => {
    const hash = hashProjectPath("/some/myproject");
    expect(hash).toContain("myproject");
  });
});

describe("initProjectDir + getProjectDir", () => {
  test("initProjectDir creates the directory", () => {
    const testProjectPath = join(tmpdir(), `test-project-${Date.now()}`);
    // initProjectDir uses getStylesDir() internally so will create under ~/.styles/projects/
    // We just verify it doesn't throw
    expect(() => initProjectDir(testProjectPath)).not.toThrow();

    const dir = getProjectDir(testProjectPath);
    expect(existsSync(dir)).toBe(true);

    // Clean up
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("setProjectConfig + getProjectConfig", () => {
  test("round-trips project config correctly", () => {
    const testProjectPath = join(tmpdir(), `test-proj-config-${Date.now()}`);

    const config = {
      projectPath: testProjectPath,
      profileId: "test-profile-id",
      activeTemplateId: null,
      customOverrides: { font: "Inter" },
      hookInstalled: false,
      updatedAt: Date.now(),
    };

    setProjectConfig(testProjectPath, config);
    const retrieved = getProjectConfig(testProjectPath);

    expect(retrieved).toBeDefined();
    expect(retrieved!.projectPath).toBe(testProjectPath);
    expect(retrieved!.profileId).toBe("test-profile-id");
    expect(retrieved!.customOverrides).toEqual({ font: "Inter" });

    // Clean up
    const dir = getProjectDir(testProjectPath);
    rmSync(dir, { recursive: true, force: true });
  });

  test("getProjectConfig returns null for nonexistent project", () => {
    const result = getProjectConfig("/nonexistent/project/path/xyz/abc");
    expect(result).toBeNull();
  });
});

describe("listProjectDirs", () => {
  test("returns an array", () => {
    const result = listProjectDirs();
    expect(Array.isArray(result)).toBe(true);
  });

  test("includes newly created project paths", () => {
    const testProjectPath = join(tmpdir(), `test-list-proj-${Date.now()}`);
    const config = {
      projectPath: testProjectPath,
      profileId: null,
      activeTemplateId: null,
      customOverrides: {},
      hookInstalled: false,
      updatedAt: Date.now(),
    };

    setProjectConfig(testProjectPath, config);
    const dirs = listProjectDirs();
    expect(dirs).toContain(testProjectPath);

    // Clean up
    const dir = getProjectDir(testProjectPath);
    rmSync(dir, { recursive: true, force: true });
  });
});
