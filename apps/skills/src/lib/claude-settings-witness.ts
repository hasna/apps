/** Explicit settings witness: typed display and recognized model selections may vary. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type BigIntStats } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export const CLAUDE_SETTINGS_WITNESS_LIMITS = Object.freeze({ bytes: 1024 * 1024, rows: 1024, depth: 32, nodes: 65536, stringCharacters: 16384, pathCharacters: 4096 });
export interface ClaudeSettingsWitnessBudget { remaining: number }
function need(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`Claude settings witness ${reason}`);
}
function absolutePath(value: unknown): asserts value is string {
  need(typeof value === "string" && value.length > 0 && value.length <= CLAUDE_SETTINGS_WITNESS_LIMITS.pathCharacters && !/[\x00-\x1f\x7f]/.test(value) && isAbsolute(value) && resolve(value) === value, "requires a normalized absolute path");
}
const sameFile = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
function parents(path: string): Array<[string, BigIntStats]> {
  const result: Array<[string, BigIntStats]> = [];
  for (let at = dirname(path); ; at = dirname(at)) {
    const stat = lstatSync(at, { bigint: true });
    need(stat.isDirectory() && !stat.isSymbolicLink(), "path traverses a symlink or non-directory");
    result.push([at, stat]);
    if (at === dirname(at)) return result;
  }
}
function readSettings(path: string, budget: ClaudeSettingsWitnessBudget): string {
  absolutePath(path); need(basename(path) === "settings.json", "requires settings.json");
  need(Number.isSafeInteger(budget.remaining) && budget.remaining >= 0, "has an invalid byte budget");
  const ancestors = parents(path), initial = lstatSync(path, { bigint: true });
  need(initial.isFile() && !initial.isSymbolicLink() && initial.size <= BigInt(CLAUDE_SETTINGS_WITNESS_LIMITS.bytes), "is not a bounded regular file");
  need(initial.size <= BigInt(budget.remaining), "exceeds its aggregate byte limit");
  // Nonblocking open also refuses a FIFO substituted after lstat without hanging.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd, { bigint: true });
    need(opened.isFile() && sameFile(initial, opened), "changed during open");
    const bytes = Buffer.alloc(Number(opened.size) + 1); let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true });
    need(current.isFile() && sameFile(opened, after) && sameFile(after, current) && BigInt(length) === opened.size, "changed during read");
    for (const [ancestor, before] of ancestors) {
      const now = lstatSync(ancestor, { bigint: true });
      need(now.isDirectory() && before.dev === now.dev && before.ino === now.ino && before.mode === now.mode, "parent changed during read");
    }
    budget.remaining -= length;
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)); }
    catch { throw new Error("Claude settings witness is not strict UTF-8"); }
  } finally { closeSync(fd); }
}

// A small tagged syntax tree rejects duplicate decoded keys and retains unknown
// numbers without rounding (including large integers and negative zero).
// Number spelling stays bound; object keys are canonicalized after parsing.
type ObjectValue = { kind: "object"; entries: Array<[string, Value]> };
type Value = ObjectValue | { kind: "array"; items: Value[] } | { kind: "string"; value: string } | { kind: "number"; value: string } | { kind: "literal"; value: "true" | "false" | "null" };
function parse(text: string): ObjectValue {
  let at = 0, nodes = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const space = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at]!)) at++; };
  function string(): string {
    need(text[at] === '"', "contains invalid JSON");
    const start = at++;
    while (at < text.length) {
      const character = text[at++]!;
      if (character === '"') {
        let value: string;
        try { value = JSON.parse(text.slice(start, at)); } catch { throw new Error("Claude settings witness contains invalid JSON string"); }
        need(value.length <= CLAUDE_SETTINGS_WITNESS_LIMITS.stringCharacters, "exceeds its string limit");
        return value;
      }
      if (character === "\\") at++;
    }
    throw new Error("Claude settings witness contains an unterminated JSON string");
  }
  function value(depth: number): Value {
    need(depth <= CLAUDE_SETTINGS_WITNESS_LIMITS.depth && ++nodes <= CLAUDE_SETTINGS_WITNESS_LIMITS.nodes, "exceeds its nesting or node limit");
    space();
    const character = text[at];
    if (character === '"') return { kind: "string", value: string() };
    if (character === "{" || character === "[") {
      at++; space();
      const object = character === "{", end = object ? "}" : "]", entries: ObjectValue["entries"] = [], items: Value[] = [], keys = new Set<string>();
      if (text[at] !== end) while (true) {
        if (object) {
          space(); const key = string();
          need(!keys.has(key), "contains a duplicate JSON key"); keys.add(key);
          space(); need(text[at++] === ":", "contains invalid JSON");
          entries.push([key, value(depth + 1)]);
        } else items.push(value(depth + 1));
        space(); if (text[at] === end) break;
        need(text[at++] === ",", "contains invalid JSON");
      }
      at++;
      return object ? { kind: "object", entries } : { kind: "array", items };
    }
    for (const literal of ["true", "false", "null"] as const) if (text.startsWith(literal, at)) { at += literal.length; return { kind: "literal", value: literal }; }
    numberPattern.lastIndex = at;
    const number = numberPattern.exec(text);
    need(number, "contains invalid JSON"); at += number[0].length;
    return { kind: "number", value: number[0] };
  }
  const root = value(0); space();
  need(at === text.length && root.kind === "object", "requires a JSON object without trailing content");
  need(root.entries.length <= CLAUDE_SETTINGS_WITNESS_LIMITS.rows, "exceeds its settings field limit");
  return root;
}

// Everything not explicitly listed remains bound, including unknown fields,
// language, outputStyle, theme, command-bearing UI and provider mappings.
const BOOLEAN_PREFERENCES = new Set([
  "autoScrollEnabled", "axScreenReader", "emojiCompletionEnabled", "prefersReducedMotion",
  "showTurnDuration", "spinnerTipsEnabled", "syntaxHighlightingDisabled", "terminalProgressBarEnabled",
  "terminalTitleFromRename", "verbose", "wheelScrollAccelerationEnabled",
]);
const ENUM_PREFERENCES: Record<string, readonly string[]> = Object.freeze({
  editorMode: ["normal", "vim"], tui: ["default", "fullscreen"], viewMode: ["default", "verbose", "focus"],
});
// Fixed v1 model-selection values from the official model-config and models
// overview references. These select inference, not files or discovery roots.
// Provider mappings, modelOverrides/modelPicker, environment and switch hooks
// remain bound. Never expand this to a prefix/path/custom-provider wildcard.
const BUILTIN_MODEL_SELECTIONS = new Set([
  "default", "best", "fable", "fable[1m]", "sonnet", "sonnet[1m]", "opus", "opus[1m]", "haiku", "opusplan",
  "claude-fable-5-1", "claude-fable-5", "claude-fable-5[1m]", "claude-opus-5", "claude-sonnet-5",
  "claude-haiku-4-5-20251001", "claude-opus-4-6", "claude-sonnet-4-5", "claude-sonnet-4-5-20250929",
  "claude-opus-4-8", "claude-opus-4-8[1m]", "claude-opus-4-7", "claude-sonnet-4-6",
  "claude-opus-4-5-20251101", "claude-opus-4-5", "claude-haiku-4-5",
  "claude-fable-5-1[1m]", "claude-opus-5[1m]", "claude-opus-4-7[1m]", "claude-opus-4-6[1m]", "claude-sonnet-4-6[1m]",
]);
function canonical(value: Value): Value {
  if (value.kind === "object") return { kind: "object", entries: value.entries.map(([key, child]): [string, Value] => [key, canonical(child)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) };
  if (value.kind === "array") return { kind: "array", items: value.items.map(canonical) };
  return value;
}
function settingsDigest(text: string): string {
  const value = parse(text);
  value.entries = value.entries.filter(([key, child]) => {
    if (key === "model") {
      need(child.kind === "string", "contains an invalid model selection");
      return !BUILTIN_MODEL_SELECTIONS.has(child.value);
    }
    if (BOOLEAN_PREFERENCES.has(key)) {
      need(child.kind === "literal" && (child.value === "true" || child.value === "false"), "contains an invalid display preference");
      return false;
    }
    if (Object.hasOwn(ENUM_PREFERENCES, key)) {
      need(child.kind === "string" && ENUM_PREFERENCES[key]!.includes(child.value), "contains an invalid display preference");
      return false;
    }
    return true;
  });
  return createHash("sha256").update("hasna.skills.claude-settings.v1\0").update(JSON.stringify(canonical(value))).digest("hex");
}
/** Hash only reviewed installer-rendered settings after the disk preimage has been verified. */
export function hashClaudeSettingsReplacement(text: string, budget: ClaudeSettingsWitnessBudget): string {
  need(typeof text === "string", "requires settings text");
  const bytes = Buffer.byteLength(text);
  need(bytes <= CLAUDE_SETTINGS_WITNESS_LIMITS.bytes && Number.isSafeInteger(budget.remaining) && budget.remaining >= bytes, "exceeds its byte limit");
  budget.remaining -= bytes;
  return settingsDigest(text);
}
/** Explicit capture never converts a stored legacy raw witness or changes settings. */
export function captureClaudeSettings(path: string, budget: ClaudeSettingsWitnessBudget = { remaining: 256 * 1024 * 1024 }): { path: string; hashMode: "claude-settings-v1"; sha256: string } {
  return { path, hashMode: "claude-settings-v1", sha256: settingsDigest(readSettings(path, budget)) };
}
