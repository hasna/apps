/**
 * Regression: `hooks remove` must resolve custom, registry-synced and bundled
 * hooks and remove the settings registration, the store dir, the lock pin and
 * the DB record (QA-1 BUG-A / QA-4: bundled-only resolution, nothing removed).
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { uninstallHook } from "./installer.js";
import { readCustomManifest } from "./manifest.js";
import { getPinnedHook, setPinnedHook, getHookRecord, upsertHookRecord } from "./store.js";
import { getDb, closeDb } from "../db/index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-remove-test-"));
const SETTINGS = join(TEST_DIR, ".claude", "settings.json");

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = ":memory:";
  process.env.HASNA_HOOKS_CLAUDE_SETTINGS_PATH = SETTINGS;
  process.env.HASNA_HOOKS_GEMINI_SETTINGS_PATH = join(TEST_DIR, ".gemini", "settings.json");
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  delete process.env.HASNA_HOOKS_CLAUDE_SETTINGS_PATH;
  delete process.env.HASNA_HOOKS_GEMINI_SETTINGS_PATH;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeCustomHookFixture(name: string, version = "1.0.0"): { dir: string; script: string } {
  const dir = join(TEST_DIR, "hooks", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ name, version, events: ["PreToolUse"], script: "script.sh" }),
  );
  const script = join(dir, "script.sh");
  writeFileSync(script, "#!/bin/bash\necho ok\n", { mode: 0o755 });
  return { dir, script };
}

function writeSettings(settings: Record<string, unknown>): void {
  mkdirSync(join(TEST_DIR, ".claude"), { recursive: true });
  writeFileSync(SETTINGS, JSON.stringify(settings));
}

describe("uninstallHook — custom/registry/bundled/nonexistent (QA-1 BUG-A / QA-4)", () => {
  test("custom hook: store dir + pin + DB record + settings all removed", () => {
    const { dir } = writeCustomHookFixture("rm-custom");
    const sha = "a".repeat(64);
    setPinnedHook("rm-custom", { version: "1.0.0", sha256: sha, source: "custom" });
    const db = getDb();
    upsertHookRecord(db, { name: "rm-custom", version: "1.0.0", sha256: sha, source_type: "custom" });
    // Simulate settings registration
    writeSettings({
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "hooks run rm-custom" }] }] },
    });

    const result = uninstallHook("rm-custom", "global", "claude");
    expect(result.removed).toBe(true);
    expect(result.source).toBe("custom");
    expect(result.storeDirRemoved).toBe(true);
    expect(result.pinRemoved).toBe(true);
    expect(result.dbRecordRemoved).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(getPinnedHook("rm-custom")).toBeUndefined();
    expect(getHookRecord(getDb(), "rm-custom")).toBeNull();
    const settings = JSON.parse(require("fs").readFileSync(SETTINGS, "utf-8"));
    expect(settings.hooks ?? {}).toEqual({});
  });

  test("registry-synced hook (store manifest, remote pin) is resolved and removed", () => {
    const { dir } = writeCustomHookFixture("rm-registry", "2.0.0");
    setPinnedHook("rm-registry", { version: "2.0.0", sha256: "b".repeat(64), source: "remote" });
    const db = getDb();
    upsertHookRecord(db, { name: "rm-registry", version: "2.0.0", sha256: "b".repeat(64), source_type: "remote" });

    const result = uninstallHook("rm-registry", "global", "claude");
    expect(result.removed).toBe(true);
    expect(result.source).toBe("custom"); // store manifest = custom dir source
    expect(result.storeDirRemoved).toBe(true);
    expect(result.pinRemoved).toBe(true);
    expect(result.dbRecordRemoved).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(readCustomManifest("rm-registry")).toBeUndefined();
  });

  test("bundled hook: registration + pin + DB removed, package files untouched", () => {
    setPinnedHook("gitguard", { version: getBundledVersion(), sha256: "c".repeat(64), source: "bundled" });
    const db = getDb();
    upsertHookRecord(db, { name: "gitguard", version: getBundledVersion(), sha256: "c".repeat(64), source_type: "bundled" });
    writeSettings({
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "hooks run gitguard" }] }] },
    });

    const result = uninstallHook("gitguard", "global", "claude");
    expect(result.removed).toBe(true);
    expect(result.source).toBe("bundled");
    expect(result.storeDirRemoved).toBe(false); // package files never removed
    expect(result.pinRemoved).toBe(true);
    expect(result.dbRecordRemoved).toBe(true);
    const settings = JSON.parse(require("fs").readFileSync(SETTINGS, "utf-8"));
    expect(settings.hooks ?? {}).toEqual({});
  });

  test("nonexistent hook: removed=false with a clear error", () => {
    const result = uninstallHook("does-not-exist-xyz", "global", "claude");
    expect(result.removed).toBe(false);
    expect(result.error).toContain("not found");
  });

  test("registered-only hook (no store dir, no bundled meta) is unregistered", () => {
    writeSettings({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "hooks run legacy-wired" }] }] },
    });
    const result = uninstallHook("legacy-wired", "global", "claude");
    expect(result.removed).toBe(true);
    expect(result.source).toBe("registered-only");
    const settings = JSON.parse(require("fs").readFileSync(SETTINGS, "utf-8"));
    expect(settings.hooks ?? {}).toEqual({});
  });
});

function getBundledVersion(): string {
  const { getHook } = require("./registry.js");
  return getHook("gitguard").version;
}
