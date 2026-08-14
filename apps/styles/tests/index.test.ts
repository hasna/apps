import { describe, expect, test } from "bun:test";

import {
  STYLES,
  CATEGORIES,
  getStyle,
  searchStyles,
  getStylesByCategory,
  findSimilarStyles,
  ALL_STYLE_NAMES,
  createProfile,
  getProfile,
  getPref,
  setPref,
  runHealthCheck,
  isCerebrasAvailable,
  getDefaultRules,
  checkFile,
  inspectFile,
  inspectProject,
  getDb,
  initDb,
  DB_PATH,
  getStylesDir,
  hashProjectPath,
  initProjectDir,
  getProjectConfig,
  setProjectConfig,
  listProjectDirs,
  deleteProfile,
  listProfiles,
  updateProfile,
  deletePref,
  listPrefs,
  getPrefs,
  BUILTIN_RULES,
} from "../src/index.js";

describe("Key exports from src/index.ts", () => {
  test("STYLES is exported and is an array", () => {
    expect(Array.isArray(STYLES)).toBe(true);
    expect(STYLES.length).toBe(10);
  });

  test("CATEGORIES is exported and is an array", () => {
    expect(Array.isArray(CATEGORIES)).toBe(true);
    expect(CATEGORIES.length).toBeGreaterThan(0);
  });

  test("getStyle is exported and is a function", () => {
    expect(typeof getStyle).toBe("function");
    expect(getStyle("minimalist")).toBeDefined();
  });

  test("searchStyles is exported and is a function", () => {
    expect(typeof searchStyles).toBe("function");
    expect(Array.isArray(searchStyles(""))).toBe(true);
  });

  test("getStylesByCategory is exported and is a function", () => {
    expect(typeof getStylesByCategory).toBe("function");
  });

  test("findSimilarStyles is exported and is a function", () => {
    expect(typeof findSimilarStyles).toBe("function");
  });

  test("ALL_STYLE_NAMES is exported", () => {
    expect(ALL_STYLE_NAMES).toBeDefined();
    expect(ALL_STYLE_NAMES.length).toBe(10);
  });

  test("createProfile is exported and is a function", () => {
    expect(typeof createProfile).toBe("function");
  });

  test("getProfile is exported and is a function", () => {
    expect(typeof getProfile).toBe("function");
  });

  test("getPref is exported and is a function", () => {
    expect(typeof getPref).toBe("function");
  });

  test("setPref is exported and is a function", () => {
    expect(typeof setPref).toBe("function");
  });

  test("runHealthCheck is exported and is a function", () => {
    expect(typeof runHealthCheck).toBe("function");
  });

  test("isCerebrasAvailable is exported and is a function", () => {
    expect(typeof isCerebrasAvailable).toBe("function");
    // Should return boolean
    expect(typeof isCerebrasAvailable()).toBe("boolean");
  });

  test("getDefaultRules is exported and is a function", () => {
    expect(typeof getDefaultRules).toBe("function");
  });

  test("checkFile is exported and is a function", () => {
    expect(typeof checkFile).toBe("function");
  });

  test("inspectFile is exported and is a function", () => {
    expect(typeof inspectFile).toBe("function");
  });

  test("inspectProject is exported and is a function", () => {
    expect(typeof inspectProject).toBe("function");
  });

  test("DB exports are present", () => {
    expect(typeof getDb).toBe("function");
    expect(typeof initDb).toBe("function");
    expect(typeof DB_PATH).toBe("string");
  });

  test("FS exports are present", () => {
    expect(typeof getStylesDir).toBe("function");
    expect(typeof hashProjectPath).toBe("function");
    expect(typeof initProjectDir).toBe("function");
    expect(typeof getProjectConfig).toBe("function");
    expect(typeof setProjectConfig).toBe("function");
    expect(typeof listProjectDirs).toBe("function");
  });

  test("BUILTIN_RULES is exported and is an array", () => {
    expect(Array.isArray(BUILTIN_RULES)).toBe(true);
    expect(BUILTIN_RULES.length).toBeGreaterThan(0);
  });
});
