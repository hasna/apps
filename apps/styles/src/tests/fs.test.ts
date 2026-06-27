import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  getStylesDir,
  getProjectsDir,
  initStylesDir,
  hashProjectPath,
  getProjectDir,
  initProjectDir,
  getProjectConfig,
  setProjectConfig,
  listProjectDirs,
  writeStyleContextFile,
} from "../lib/fs.js";

let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let testHome = "";

beforeEach(() => {
  originalHome = process.env["HOME"];
  originalUserProfile = process.env["USERPROFILE"];
  testHome = join(tmpdir(), `styles-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env["HOME"] = testHome;
  delete process.env["USERPROFILE"];
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  if (originalUserProfile === undefined) delete process.env["USERPROFILE"];
  else process.env["USERPROFILE"] = originalUserProfile;
  rmSync(testHome, { recursive: true, force: true });
});

describe("fs utilities", () => {
  describe("getStylesDir", () => {
    test("returns canonical path in ~/.hasna/styles", () => {
      const dir = getStylesDir();
      expect(dir).toBe(join(testHome, ".hasna", "styles"));
    });

    test("copies legacy ~/.open-styles before ~/.styles without touching project-local .styles", () => {
      mkdirSync(join(testHome, ".open-styles", "nested"), { recursive: true });
      mkdirSync(join(testHome, ".styles"), { recursive: true });
      writeFileSync(join(testHome, ".open-styles", "config.json"), "{\"source\":\"open\"}");
      writeFileSync(join(testHome, ".open-styles", "nested", "note.txt"), "open");
      writeFileSync(join(testHome, ".styles", "config.json"), "{\"source\":\"old\"}");

      const dir = getStylesDir();

      expect(readFileSync(join(dir, "config.json"), "utf-8")).toBe("{\"source\":\"open\"}");
      expect(readFileSync(join(dir, "nested", "note.txt"), "utf-8")).toBe("open");
    });
  });

  describe("getProjectsDir", () => {
    test("returns subdirectory of styles dir", () => {
      const dir = getProjectsDir();
      expect(dir).toContain(getStylesDir());
      expect(dir).toContain("projects");
    });
  });

  describe("initStylesDir", () => {
    test("does not throw", () => {
      expect(() => initStylesDir()).not.toThrow();
    });

    test("creates directories", () => {
      initStylesDir();
      expect(existsSync(getStylesDir())).toBe(true);
      expect(existsSync(getProjectsDir())).toBe(true);
    });
  });

  describe("hashProjectPath", () => {
    test("returns stable, predictable format", () => {
      const hash1 = hashProjectPath("/Users/alice/my-app");
      const hash2 = hashProjectPath("/Users/alice/my-app");
      expect(hash1).toBe(hash2);
      expect(hash1).toContain("my-app");
    });

    test("different paths produce different hashes", () => {
      const hash1 = hashProjectPath("/app-a");
      const hash2 = hashProjectPath("/app-b");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("getProjectDir", () => {
    test("returns a subdirectory of projects dir with hash", () => {
      const dir = getProjectDir("/some/app");
      expect(dir).toContain(getProjectsDir());
    });
  });
});

describe("project config", () => {
  let testProjectPath = "";

  beforeEach(() => {
    testProjectPath = join(tmpdir(), `styles-fs-proj-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testProjectPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(testProjectPath, { recursive: true, force: true });
  });

  describe("initProjectDir", () => {
    test("creates project dir structure", () => {
      initProjectDir(testProjectPath);
      const projectDir = getProjectDir(testProjectPath);
      expect(existsSync(projectDir)).toBe(true);
    });
  });

  describe("setProjectConfig + getProjectConfig", () => {
    test("round-trip: set and get", () => {
      setProjectConfig(testProjectPath, {
        projectPath: testProjectPath,
        profileId: "profile-1",
        activeTemplateId: "tpl-1",
        customOverrides: { key: "val" },
        hookInstalled: true,
        updatedAt: Date.now(),
      });

      const config = getProjectConfig(testProjectPath);
      expect(config).not.toBeNull();
      expect(config!.profileId).toBe("profile-1");
      expect(config!.activeTemplateId).toBe("tpl-1");
      expect(config!.hookInstalled).toBe(true);
    });

    test("returns null for missing config", () => {
      expect(getProjectConfig(testProjectPath)).toBeNull();
    });
  });

  describe("listProjectDirs", () => {
    test("returns array", () => {
      initStylesDir();
      const dirs = listProjectDirs();
      expect(Array.isArray(dirs)).toBe(true);
    });
  });
});

describe("writeStyleContextFile", () => {
  let testProjectPath = "";

  beforeEach(() => {
    testProjectPath = join(tmpdir(), `styles-fs-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testProjectPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(testProjectPath, { recursive: true, force: true });
  });

  test("writes style.md in .styles directory", () => {
    writeStyleContextFile(testProjectPath, "# Test Style\n\nThis is a test.");
    const mdPath = join(testProjectPath, ".styles", "style.md");
    expect(existsSync(mdPath)).toBe(true);
    const content = readFileSync(mdPath, "utf-8");
    expect(content).toBe("# Test Style\n\nThis is a test.");
  });
});
