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
  // getSettingsPath honors HASNA_HOOKS_CODEWITH_CONFIG_PATH for codewith —
  // point it at the test TOML (homedir() is cached per process and cannot
  // be redirected mid-suite).
  process.env.HASNA_HOOKS_CODEWITH_CONFIG_PATH = join(TEST_DIR, ".codewith", "config.toml");
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  delete process.env.HASNA_HOOKS_CLAUDE_SETTINGS_PATH;
  delete process.env.HASNA_HOOKS_GEMINI_SETTINGS_PATH;
  delete process.env.HASNA_HOOKS_CODEWITH_CONFIG_PATH;
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

  test("codewith target: store/lock/DB cleaned and the TOML registration removed losslessly", () => {
    const { dir } = writeCustomHookFixture("rm-codewith", "1.0.0");
    setPinnedHook("rm-codewith", { version: "1.0.0", sha256: "d".repeat(64), source: "custom" });
    const db = getDb();
    upsertHookRecord(db, { name: "rm-codewith", version: "1.0.0", sha256: "d".repeat(64), source_type: "custom" });
    const toml = join(TEST_DIR, ".codewith", "config.toml");
    mkdirSync(join(TEST_DIR, ".codewith"), { recursive: true });
    // The exact fragment shape buildCodewithTomlFragment writes.
    writeFileSync(toml, `[[hooks.Stop]]\n\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "hooks run rm-codewith"\ntimeout = 10\nstatusMessage = "Running rm-codewith"\n\n[[hooks.PreToolUse]]\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "hooks run other-hook"\ntimeout = 10\nstatusMessage = "Running other-hook"\n`);

    const result = uninstallHook("rm-codewith", "global", "codewith");
    expect(result.removed).toBe(true);
    expect(result.storeDirRemoved).toBe(true);
    expect(result.pinRemoved).toBe(true);
    expect(result.dbRecordRemoved).toBe(true);
    expect(result.registrationsRemaining).toHaveLength(0);
    const after = require("fs").readFileSync(toml, "utf-8");
    expect(after).not.toContain("hooks run rm-codewith");
    expect(after).not.toContain("[[hooks.Stop]]"); // consumed block dropped
    expect(after).toContain("hooks run other-hook"); // unrelated entry preserved
    expect(existsSync(dir)).toBe(false);
  });

  test("codewith removal never touches unrelated config sections", () => {
    const config = `[general]\nfoo = "bar"\n\n[[hooks.PreToolUse]]\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "hooks run gitguard"\ntimeout = 10\n\n[[hooks.Stop]]\n\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "hooks run fleet-comms"\ntimeout = 10\n\n[other]\nx = 1\n`;
    const { removeCodewithHookEntry } = require("./installer.js");
    const res = removeCodewithHookEntry(config, "gitguard");
    expect(res.removed).toBe(true);
    expect(res.text).not.toContain("hooks run gitguard");
    expect(res.text).toContain("hooks run fleet-comms");
    expect(res.text).toContain('[general]\nfoo = "bar"');
    expect(res.text).toContain("[other]\nx = 1");
  });

  test("a codewith-only registered hook resolves for --target all and is removed from the TOML", () => {
    const toml = join(TEST_DIR, ".codewith", "config.toml");
    mkdirSync(join(TEST_DIR, ".codewith"), { recursive: true });
    writeFileSync(toml, `[[hooks.Stop]]\n\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "hooks run orphan-only"\ntimeout = 10\n`);
    // No store dir, no bundled meta, no claude/gemini registration.
    const result = uninstallHook("orphan-only", "global", "all");
    expect(result.removed).toBe(true);
    expect(result.source).toBe("registered-only");
    expect(result.registrationsRemaining).toHaveLength(0);
    expect(require("fs").readFileSync(toml, "utf-8")).not.toContain("hooks run orphan-only");
  });

  test("an ambiguous inline codewith entry that survives removal is reported as remaining", () => {
    const toml = join(TEST_DIR, ".codewith", "config.toml");
    mkdirSync(join(TEST_DIR, ".codewith"), { recursive: true });
    // One canonical entry (removable) + one inline-table entry (ambiguous —
    // section remover cannot positively identify it).
    writeFileSync(toml, `[[hooks.Stop]]\n\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "hooks run mix-demo"\ntimeout = 10\n\n[[hooks.PreToolUse]]\nhooks = [{ type = "command", command = "hooks run mix-demo" }]\n`);
    const result = uninstallHook("mix-demo", "global", "codewith");
    expect(result.removed).toBe(true);
    expect(result.registrationsRemaining).toEqual(["codewith"]);
    const after = require("fs").readFileSync(toml, "utf-8");
    // Canonical entry block gone; the ambiguous inline entry survives and is
    // reported as remaining (never silently dropped).
    expect(after).not.toContain("[[hooks.Stop]]");
    expect(after).toContain("[[hooks.PreToolUse]]");
  });

  // PRISTINE-MAIN PROBE 2026-09-04 (SA-issue-batch-B16): comment-only edit to force hooks tests on unmodified code.
test("store dir that cannot be removed keeps trust records intact (fail-closed, no fail-open)", () => {
    const { dir } = writeCustomHookFixture("rm-frozen", "1.0.0");
    setPinnedHook("rm-frozen", { version: "1.0.0", sha256: "e".repeat(64), source: "custom" });
    const db = getDb();
    upsertHookRecord(db, { name: "rm-frozen", version: "1.0.0", sha256: "e".repeat(64), source_type: "custom" });
    // Freeze a SUBDIRECTORY so the recursive removal must fail while the
    // manifest itself stays readable (rmSync needs write access on the dir
    // holding the entries it unlinks).
    const sub = join(dir, "sub");
    mkdirSync(sub);
    writeFileSync(join(sub, "x"), "y");
    const { chmodSync } = require("fs");
    chmodSync(sub, 0o000);
    try {
      const result = uninstallHook("rm-frozen", "global", "claude");
      expect(result.removed).toBe(false);
      expect(result.error).toContain("could not be removed");
      // Trust records must survive — the residual bytes never become
      // self-trusted (security reviewer P1-2).
      expect(getPinnedHook("rm-frozen")).toBeDefined();
      expect(getHookRecord(getDb(), "rm-frozen")).not.toBeNull();
      expect(existsSync(join(dir, "script.sh"))).toBe(true);
    } finally {
      chmodSync(sub, 0o755);
    }
  });
});

function getBundledVersion(): string {
  const { getHook } = require("./registry.js");
  return getHook("gitguard").version;
}
