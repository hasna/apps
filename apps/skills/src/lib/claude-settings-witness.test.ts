import { afterEach, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { captureClaudeSettings, CLAUDE_SETTINGS_WITNESS_LIMITS as limits } from "./claude-settings-witness.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(text = "{}") {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "skills-settings-json-")); roots.push(root);
  const folder = join(root, "config"); mkdirSync(folder);
  const path = join(folder, "settings.json"); writeFileSync(path, text); return path;
}
const digest = (path: string) => captureClaudeSettings(path).sha256;

test.each([
  "autoScrollEnabled", "axScreenReader", "emojiCompletionEnabled", "prefersReducedMotion",
  "showTurnDuration", "spinnerTipsEnabled", "syntaxHighlightingDisabled", "terminalProgressBarEnabled",
  "terminalTitleFromRename", "verbose", "wheelScrollAccelerationEnabled",
])("only valid boolean %s preferences are omitted", key => {
  const path = fixture(), before = digest(path);
  for (const value of [true, false]) { writeFileSync(path, JSON.stringify({ [key]: value })); expect(digest(path)).toBe(before); }
  for (const value of [null, "true", 1, {}, []]) { writeFileSync(path, JSON.stringify({ [key]: value })); expect(() => digest(path)).toThrow("invalid display preference"); }
});

test.each([
  ["editorMode", ["normal", "vim"]], ["tui", ["default", "fullscreen"]], ["viewMode", ["default", "verbose", "focus"]],
] as const)("only documented %s enum preferences are omitted", (key, values) => {
  const path = fixture(), before = digest(path);
  for (const value of values) { writeFileSync(path, JSON.stringify({ [key]: value })); expect(digest(path)).toBe(before); }
  for (const value of ["future-value", null, false, {}]) { writeFileSync(path, JSON.stringify({ [key]: value })); expect(() => digest(path)).toThrow("invalid display preference"); }
});

test("nested keys and whitespace canonicalize without rounding unknown values or reordering arrays", () => {
  const path = fixture('{"z":{"b":2,"a":1},"a":[1,2],"unknown":9007199254740992}'), before = digest(path);
  writeFileSync(path, '{ "unknown":9007199254740992, "a":[1,2], "z":{"a":1,"b":2}}'); expect(digest(path)).toBe(before);
  writeFileSync(path, '{"z":{"b":2,"a":1},"a":[1,2],"unknown":9007199254740993}'); expect(digest(path)).not.toBe(before);
  writeFileSync(path, '{"z":{"b":2,"a":1},"a":[2,1],"unknown":9007199254740992}'); expect(digest(path)).not.toBe(before);
  const empty = fixture(), missing = digest(empty); writeFileSync(empty, '{"unknown":null}'); expect(digest(empty)).not.toBe(missing);
  writeFileSync(empty, '{"unknown":{"verbose":false}}'); const nested = digest(empty);
  writeFileSync(empty, '{"unknown":{"verbose":true}}'); expect(digest(empty)).not.toBe(nested);
});

test.each(["model", "language", "outputStyle", "theme", "modelSettings", "statusLine", "fileSuggestion", "subagentStatusLine", "spinnerTipsOverride", "bashEditDiffEnabled", "env", "processWrapper", "parentSettingsBehavior", "futureUnknownField"])("%s remains bound", key => {
  const path = fixture(), before = digest(path);
  writeFileSync(path, JSON.stringify({ [key]: "changed" })); expect(digest(path)).not.toBe(before);
});

test("recognized model choices are distinct from arbitrary custom/path-like model values", () => {
  const path = fixture(), before = digest(path);
  for (const model of ["sonnet", "opus", "default", "fable", "opus[1m]", "claude-opus-4-6", "claude-fable-5-1", "claude-haiku-4-5-20251001"]) {
    writeFileSync(path, JSON.stringify({ model })); expect(digest(path)).toBe(before);
  }
  for (const model of ["custom-provider-model", "claude-future-99", "../model", "/fixture/model", "opus; echo injected", "opus\n", "provider://deployment/custom"]) {
    writeFileSync(path, JSON.stringify({ model })); expect(digest(path)).not.toBe(before);
    const custom = digest(path); writeFileSync(path, JSON.stringify({ model: "opus" })); expect(digest(path)).not.toBe(custom);
  }
  for (const model of [null, {}, [], 1, false]) { writeFileSync(path, JSON.stringify({ model })); expect(() => digest(path)).toThrow("invalid model selection"); }
});

test.each([
  '{"verbose":false,"verbose":true}', '{"verbose":false,"\\u0076erbose":true}', '{"nested":{"a":1,"a":2}}',
  '{"verbose":true,}', '{} false', '[]', 'null', '{"unknown":NaN}', '\ufeff{}',
])("ambiguous or invalid JSON is refused: %s", text => {
  expect(() => digest(fixture(text))).toThrow();
});

test("strict UTF-8, finite budgets and bounded source structure are required", () => {
  const path = fixture(); writeFileSync(path, Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
  expect(() => digest(path)).toThrow("strict UTF-8");
  writeFileSync(path, "{}"); expect(() => captureClaudeSettings(path, { remaining: 1 })).toThrow("aggregate byte limit");
  expect(() => captureClaudeSettings(path, { remaining: Number.NaN })).toThrow("invalid byte budget");
  writeFileSync(path, '{"x":' + '['.repeat(limits.depth + 1) + '0' + ']'.repeat(limits.depth + 1) + '}'); expect(() => digest(path)).toThrow("nesting");
  writeFileSync(path, JSON.stringify({ x: "x".repeat(limits.stringCharacters + 1) })); expect(() => digest(path)).toThrow("string limit");
  writeFileSync(path, " ".repeat(limits.bytes + 1)); expect(() => digest(path)).toThrow("bounded regular file");
});

test("file paths are normalized settings files and never follow links or directories", () => {
  const path = fixture(), root = join(path, "..");
  expect(() => digest(join(root, "other.json"))).toThrow("settings.json");
  expect(() => digest(path.replace("/settings.json", "/../settings.json"))).toThrow("normalized absolute path");
  const target = join(root, "real.json"); renameSync(path, target); symlinkSync(target, path);
  expect(() => digest(path)).toThrow("bounded regular file"); rmSync(path); mkdirSync(path);
  expect(() => digest(path)).toThrow("bounded regular file");
  rmSync(path, { recursive: true }); const linked = join(root, "linked"); symlinkSync(root, linked);
  expect(() => digest(join(linked, "settings.json"))).toThrow("symlink");
});

test("an atomic rewrite with identical semantic content remains valid", () => {
  const path = fixture('{"verbose":false,"permissions":{"allow":["Skill(skills-cli)"]}}'), before = digest(path);
  const replacement = join(path, "../replacement.json"); writeFileSync(replacement, readFileSync(path)); renameSync(replacement, path);
  expect(digest(path)).toBe(before);
});

test("real open/read replacements, symlinks, FIFO, mutation and parent swaps refuse", () => {
  const script = `
import { mock } from "bun:test";
import * as original from "node:fs";
import { dirname } from "node:path";
const fs = { ...original }, [target, mode, modulePath] = process.argv.slice(2); let changed = false;
mock.module("node:fs", () => ({ ...fs,
  openSync(path, ...args) {
    if (String(path) === target && !changed && mode.startsWith("open-")) {
      changed = true; fs.renameSync(target, target + "-original");
      if (mode === "open-fifo") { if (Bun.spawnSync(["mkfifo", target]).exitCode !== 0) throw Error("fixture FIFO failed"); }
      else if (mode === "open-symlink") fs.symlinkSync(target + "-original", target);
      else fs.writeFileSync(target, "{}");
    }
    return fs.openSync(path, ...args);
  },
  readSync(...args) {
    const count = fs.readSync(...args);
    if (!changed && mode.startsWith("read-")) {
      changed = true;
      if (mode === "read-replace") { fs.renameSync(target, target + "-original"); fs.writeFileSync(target, "{}"); }
      else if (mode === "read-grow") fs.truncateSync(target, 1024 * 1024 + 1);
      else if (mode === "read-shrink") fs.truncateSync(target, 0);
      else if (mode === "read-mutate") { fs.writeFileSync(target, "[]"); fs.utimesSync(target, new Date(0), new Date(0)); }
      else { const folder = dirname(target); fs.renameSync(folder, folder + "-original"); fs.symlinkSync(folder + "-original", folder); }
    }
    return count;
  }
}));
const { captureClaudeSettings } = await import(modulePath);
let refused = false; try { captureClaudeSettings(target); } catch { refused = true; }
process.stdout.write(JSON.stringify({ changed, refused })); process.exitCode = changed && refused ? 0 : 2;
`;
  const modulePath = new URL("./claude-settings-witness.ts", import.meta.url).href;
  for (const mode of ["open-replace", "open-symlink", "open-fifo", "read-replace", "read-grow", "read-shrink", "read-mutate", "read-parent"]) {
    const path = fixture(), scriptPath = join(dirname(dirname(path)), "race.mjs"); writeFileSync(scriptPath, script);
    const result = Bun.spawnSync([process.execPath, "--no-env-file", scriptPath, path, mode, modulePath], { timeout: 5000, env: { PATH: process.env.PATH!, HOME: process.env.HOME! } });
    expect({ mode, exitCode: result.exitCode, stderr: result.stderr.toString() }).toEqual({ mode, exitCode: 0, stderr: "" });
    expect(JSON.parse(result.stdout.toString())).toEqual({ changed: true, refused: true });
  }
});
