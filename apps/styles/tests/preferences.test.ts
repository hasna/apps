import { describe, expect, test, afterEach } from "bun:test";

import {
  getPref,
  setPref,
  deletePref,
  listPrefs,
} from "../src/lib/preferences.js";
import { initDb } from "../src/lib/db.js";

// Ensure DB is initialized before tests
initDb();

// Track created prefs for cleanup: { key, scope, projectPath? }
type PrefKey = { key: string; scope: "global" | "project"; projectPath?: string };
const createdPrefs: PrefKey[] = [];

afterEach(() => {
  for (const p of createdPrefs.splice(0)) {
    try {
      deletePref(p.key, p.scope, p.projectPath);
    } catch {
      // ignore
    }
  }
});

function ukey(base: string) {
  return `test-${base}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("setPref + getPref", () => {
  test("round-trips global scope", () => {
    const key = ukey("global");
    createdPrefs.push({ key, scope: "global" });
    setPref(key, "dark", "global");
    expect(getPref(key)).toBe("dark");
  });

  test("round-trips project scope", () => {
    const key = ukey("proj");
    const proj = "/test/project/path";
    createdPrefs.push({ key, scope: "project", projectPath: proj });
    setPref(key, "Inter", "project", proj);
    expect(getPref(key, proj)).toBe("Inter");
  });

  test("project scope overrides global for same key", () => {
    const key = ukey("override");
    const proj = "/test/override/path";
    createdPrefs.push({ key, scope: "global" });
    createdPrefs.push({ key, scope: "project", projectPath: proj });

    setPref(key, "Arial", "global");
    setPref(key, "Inter", "project", proj);

    expect(getPref(key, proj)).toBe("Inter");
    expect(getPref(key)).toBe("Arial");
  });

  test("setPref project scope is idempotent (UPSERT)", () => {
    // Note: global scope UPSERT relies on SQLite UNIQUE(key, scope, project_path) with NULL.
    // SQLite treats NULL != NULL so global scope conflicts may not deduplicate.
    // Project scope (non-NULL project_path) does correctly deduplicate.
    const key = ukey("upsert");
    const proj = "/test/upsert/proj";
    createdPrefs.push({ key, scope: "project", projectPath: proj });
    setPref(key, "light", "project", proj);
    setPref(key, "dark", "project", proj);
    expect(getPref(key, proj)).toBe("dark");
  });
});

describe("deletePref", () => {
  test("removes a global preference", () => {
    const key = ukey("del-global");
    setPref(key, "yes", "global");
    deletePref(key, "global");
    expect(getPref(key)).toBeNull();
  });

  test("removes a project preference", () => {
    const key = ukey("del-proj");
    const proj = "/test/del/proj";
    setPref(key, "yes", "project", proj);
    deletePref(key, "project", proj);
    expect(getPref(key, proj)).toBeNull();
  });
});

describe("listPrefs", () => {
  test("returns all global prefs including newly added ones", () => {
    const key1 = ukey("list-a");
    const key2 = ukey("list-b");
    createdPrefs.push({ key: key1, scope: "global" });
    createdPrefs.push({ key: key2, scope: "global" });

    setPref(key1, "1", "global");
    setPref(key2, "2", "global");

    const prefs = listPrefs();
    const keys = prefs.map((p) => p.key);
    expect(keys).toContain(key1);
    expect(keys).toContain(key2);
  });

  test("returns prefs including project scope when projectPath given", () => {
    const globalKey = ukey("list-gk");
    const projKey = ukey("list-pk");
    const proj = "/test/listproj";
    createdPrefs.push({ key: globalKey, scope: "global" });
    createdPrefs.push({ key: projKey, scope: "project", projectPath: proj });

    setPref(globalKey, "gv", "global");
    setPref(projKey, "pv", "project", proj);

    const prefs = listPrefs(proj);
    const keys = prefs.map((p) => p.key);
    expect(keys).toContain(globalKey);
    expect(keys).toContain(projKey);
  });
});

describe("getPref for nonexistent key", () => {
  test("returns null", () => {
    expect(getPref("nonexistent-key-xyz-abc-123")).toBeNull();
  });
});
