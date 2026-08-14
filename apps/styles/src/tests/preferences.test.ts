import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { getPref, setPref, deletePref, listPrefs, getPrefs } from "../lib/preferences.js";
import { resetDb, setDbPath } from "../lib/db.js";

let testDbPath = "";

beforeEach(() => {
  testDbPath = join(tmpdir(), `styles-prefs-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  setDbPath(testDbPath);
});

afterEach(() => {
  resetDb();
  if (existsSync(testDbPath)) unlinkSync(testDbPath);
  for (const suffix of ["-wal", "-shm"]) {
    const p = testDbPath + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
});

describe("preferences", () => {
  describe("setPref + getPref", () => {
    test("sets and gets global preference", () => {
      setPref("color-scheme", "dark", "global");
      expect(getPref("color-scheme")).toBe("dark");
    });

    test("sets and gets project-scoped preference", () => {
      setPref("font-size", "16px", "project", "/path/to/project");
      expect(getPref("font-size", "/path/to/project")).toBe("16px");
    });

    test("project scope takes precedence over global", () => {
      setPref("theme", "light", "global");
      setPref("theme", "dark", "project", "/path/to/project");
      expect(getPref("theme", "/path/to/project")).toBe("dark");
    });

    test("falls back to global when no project pref", () => {
      setPref("theme", "light", "global");
      expect(getPref("theme", "/path/to/project")).toBe("light");
    });

    test("returns null for unknown key", () => {
      expect(getPref("nonexistent")).toBeNull();
    });

    test("returns null when project path provided but no pref exists", () => {
      expect(getPref("unknown", "/some/project")).toBeNull();
    });

    test("setPref sets a value that can be retrieved", () => {
      setPref("key1", "v1", "global");
      setPref("key2", "v2", "global");
      expect(getPref("key1")).toBe("v1");
      expect(getPref("key2")).toBe("v2");
    });
  });

  describe("deletePref", () => {
    test("deletes global preference", () => {
      setPref("key", "val", "global");
      deletePref("key", "global");
      expect(getPref("key")).toBeNull();
    });

    test("deletes project-scoped preference", () => {
      setPref("key", "val", "project", "/proj");
      deletePref("key", "project", "/proj");
      expect(getPref("key", "/proj")).toBeNull();
    });

    test("no-op for non-existent preference", () => {
      expect(() => deletePref("nonexistent", "global")).not.toThrow();
    });
  });

  describe("listPrefs", () => {
    test("returns empty array when no prefs", () => {
      expect(listPrefs()).toEqual([]);
    });

    test("lists all global prefs sorted by key", () => {
      setPref("beta", "1", "global");
      setPref("alpha", "2", "global");
      const prefs = listPrefs();
      expect(prefs.length).toBe(2);
      expect(prefs[0].key).toBe("alpha");
      expect(prefs[1].key).toBe("beta");
    });

    test("project scope prefs override globals in list", () => {
      setPref("theme", "light", "global");
      setPref("theme", "dark", "project", "/proj");
      const prefs = listPrefs("/proj");
      expect(prefs.length).toBe(1);
      expect(prefs[0].value).toBe("dark");
      expect(prefs[0].scope).toBe("project");
    });

    test("returns only global prefs when no projectPath", () => {
      setPref("g1", "v1", "global");
      setPref("p1", "v2", "project", "/proj");
      const prefs = listPrefs();
      expect(prefs.length).toBe(1);
      expect(prefs[0].key).toBe("g1");
    });
  });

  describe("getPrefs (batch)", () => {
    test("returns map of key → value", () => {
      setPref("a", "1", "global");
      setPref("b", "2", "global");
      const result = getPrefs(["a", "b", "c"]);
      expect(result).toEqual({ a: "1", b: "2", c: null });
    });
  });

  describe("setPref validation", () => {
    test("throws when project scope is used without projectPath", () => {
      expect(() => setPref("key", "val", "project")).toThrow("projectPath is required");
    });
  });
});
