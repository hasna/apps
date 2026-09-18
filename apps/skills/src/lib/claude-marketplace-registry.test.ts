import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { captureClaudeMarketplaceRegistry, CLAUDE_MARKETPLACE_REGISTRY_LIMITS as limits } from "./claude-marketplace-registry.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(bytes: string | Buffer = "{}") {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "skills-marketplace-witness-")); roots.push(root);
  const folder = join(root, "input"); mkdirSync(folder);
  const path = join(folder, "known_marketplaces.json"); writeFileSync(path, bytes); return path;
}
function registry() {
  return {
    official: { source: { source: "github", repo: "example/plugins" }, installLocation: "/fixture/marketplaces/official", lastUpdated: "2026-09-18T09:00:46.367Z" },
    owner: { source: { source: "directory", path: "/fixture/owner/plugins" }, installLocation: "/fixture/owner/plugins", lastUpdated: "2026-09-18T08:39:19.748Z" },
  };
}
const digest = (value: unknown) => captureClaudeMarketplaceRegistry(fixture(JSON.stringify(value))).sha256;

test("known github and directory rows ignore only valid update timestamp values", () => {
  const value = registry(), before = digest(value);
  value.official.lastUpdated = "2024-02-29T23:59:59.999Z";
  expect(digest(value)).toBe(before);
  value.owner.lastUpdated = "2025-01-01T00:00:00.000Z";
  expect(digest(value)).toBe(before);
  const path = fixture(JSON.stringify(value, null, 2));
  expect(captureClaudeMarketplaceRegistry(path)).toEqual({ path, hashMode: "claude-marketplace-registry", sha256: before });
  expect(before).not.toBe(createHash("sha256").update(JSON.stringify(value)).digest("hex"));
});

test("capture preserves the exact input bytes and metadata", () => {
  const path = fixture(JSON.stringify(registry(), null, 2) + "\n"), before = readFileSync(path), metadata = statSync(path);
  captureClaudeMarketplaceRegistry(path);
  expect(readFileSync(path)).toEqual(before);
  const after = statSync(path);
  expect([after.ino, after.size, after.mtimeMs, after.ctimeMs]).toEqual([metadata.ino, metadata.size, metadata.mtimeMs, metadata.ctimeMs]);
});

test("membership, names, source locations and install paths remain bound", () => {
  const before = digest(registry());
  const changes: Array<(value: any) => void> = [
    value => { delete value.official; },
    value => { value.added = value.official; },
    value => { value.renamed = value.official; delete value.official; },
    value => { value.official.source.repo = "example/other"; },
    value => { value.owner.source.path = "/fixture/other"; },
    value => { value.official.installLocation = "/fixture/other"; },
    value => { value.owner.installLocation = "/fixture/other"; },
    value => { delete value.official.lastUpdated; },
    value => { value.official.source.ref = "release"; },
    value => { value.official.source.url = "https://example.com/plugins"; },
    value => { value.official.source = { source: "directory", path: "/fixture/plugins" }; },
  ];
  for (const change of changes) { const value = registry(); change(value); expect(digest(value)).not.toBe(before); }
});

test("unknown row and source fields disable the timestamp exemption without dropping anything", () => {
  for (const unknown of [
    { ...registry().official, future: true },
    { ...registry().official, autoUpdate: false },
    { ...registry().official, source: { ...registry().official.source, ref: "main" } },
    { ...registry().official, source: { ...registry().official.source, url: "https://example.com/plugins" } },
    { ...registry().official, source: { source: "future", repo: "example/plugins" } },
    { source: null, installLocation: "/fixture", lastUpdated: "not-a-date" },
  ]) {
    const before = digest({ unknown });
    expect(digest({ unknown: { ...unknown, lastUpdated: "2026-09-18T10:00:00.000Z" } })).not.toBe(before);
    expect(digest({ unknown: { ...unknown, additional: "field" } })).not.toBe(before);
  }
  expect(digest({ unknown: { ...registry().official, future: 1 } })).not.toBe(digest({ unknown: { ...registry().official, future: 2 } }));
  expect(digest({ unknown: { ...registry().official, autoUpdate: false } })).not.toBe(digest({ unknown: { ...registry().official, autoUpdate: true } }));
  expect(digest({ row: ["one", "two"] })).not.toBe(digest({ row: ["two", "one"] }));
  expect(digest({ row: true })).not.toBe(digest({ row: "true" }));
  expect(digest({ row: null })).not.toBe(digest({ row: "null" }));
  expect(digest({ row: 1 })).not.toBe(digest({ row: "1" }));
});

test("unknown numeric values retain precision, sign and scalar identity", () => {
  for (const [a, b] of [["9007199254740992", "9007199254740993"], ["0", "-0"], ["0.1", "0.10000000000000001"], ["1e999", "2e999"]]) {
    const first = captureClaudeMarketplaceRegistry(fixture(`{"unknown":${a}}`));
    const second = captureClaudeMarketplaceRegistry(fixture(`{"unknown":${b}}`));
    expect(first.sha256).not.toBe(second.sha256);
  }
});

test("escaped keys are decoded without losing prototype-like or unknown field names", () => {
  const before = captureClaudeMarketplaceRegistry(fixture('{"__proto__":{"constructor":"first"},"\\u0061":"value"}')).sha256;
  expect(captureClaudeMarketplaceRegistry(fixture('{"__proto__":{"constructor":"first"},"a":"value"}')).sha256).toBe(before);
  expect(captureClaudeMarketplaceRegistry(fixture('{"__proto__":{"constructor":"second"},"a":"value"}')).sha256).not.toBe(before);
});

test("recognized timestamps must be canonical, real UTC dates with millisecond precision", () => {
  for (const timestamp of ["", "tomorrow", "2026-02-29T00:00:00.000Z", "2024-02-30T00:00:00.000Z", "2026-09-18T24:00:00.000Z", "2026-09-18T09:00:60.000Z", "2026-09-18T09:00:00Z", "2026-09-18T09:00:00.000+00:00", "2026-09-18t09:00:00.000z", 123, null, {}]) {
    const value: any = registry(); value.official.lastUpdated = timestamp;
    expect(() => digest(value)).toThrow("Claude marketplace registry");
  }
});

test("recognized path and source fields are validated before any timestamp exemption", () => {
  const changes: Array<(value: any) => void> = [
    value => { value.official.source.repo = null; },
    value => { value.official.source.repo = ""; },
    value => { value.official.source.repo = "example/\u0000plugins"; },
    value => { value.official.installLocation = "relative"; },
    value => { value.official.installLocation = "/fixture/../elsewhere"; },
    value => { value.official.installLocation = 1; },
    value => { value.owner.source.path = "relative"; },
    value => { value.owner.source.path = "/fixture/./plugins"; },
    value => { value.owner.source.path = "/" + "x".repeat(limits.pathCharacters); },
  ];
  for (const change of changes) { const value = registry(); change(value); expect(() => digest(value)).toThrow("Claude marketplace registry"); }
});

test("duplicate decoded keys at every depth are refused", () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"a":{"source":"github","source":"directory"}}', '{"a":[{"x":1,"x":2}]}', '{"__proto__":1,"__proto__":2}']) {
    expect(() => captureClaudeMarketplaceRegistry(fixture(text))).toThrow("duplicate JSON key");
  }
});

test("non-object roots, malformed JSON, BOM and invalid UTF8 refuse", () => {
  for (const text of ["", "[]", "null", "true", "1", '"text"', "{} trailing", '{"a":1,}', '{"a":[1,]}', '{"a":01}', '{"a":+1}', '{"a":NaN}', '{"a":Infinity}', '{"a":"\\x"}', '{"a":"unterminated}', '{"a":"raw\nnewline"}', "\ufeff{}"])
    expect(() => captureClaudeMarketplaceRegistry(fixture(text))).toThrow("Claude marketplace registry");
  expect(() => captureClaudeMarketplaceRegistry(fixture(Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])))).toThrow("UTF-8");
});

test("registry paths must have the exact basename and normalized absolute spelling", () => {
  const path = fixture();
  for (const invalid of ["known_marketplaces.json", join(dirname(path), "installed_plugins.json"), dirname(path) + "/./known_marketplaces.json", path + "\0", "/" + "x".repeat(limits.pathCharacters) + "/known_marketplaces.json"])
    expect(() => captureClaudeMarketplaceRegistry(invalid)).toThrow("Claude marketplace registry");
});

test("row, nesting, string and node bounds are enforced", () => {
  expect(digest(Object.fromEntries(Array.from({ length: limits.rows }, (_, index) => [String(index), null])))).toHaveLength(64);
  expect(() => digest(Object.fromEntries(Array.from({ length: limits.rows + 1 }, (_, index) => [String(index), null])))).toThrow("row limit");
  expect(digest({ value: "x".repeat(limits.stringCharacters) })).toHaveLength(64);
  expect(() => digest({ value: "x".repeat(limits.stringCharacters + 1) })).toThrow("string limit");
  expect(() => digest({ ["x".repeat(limits.stringCharacters + 1)]: null })).toThrow("string limit");
  expect(() => captureClaudeMarketplaceRegistry(fixture('{"value":' + "[".repeat(limits.depth + 1) + "0" + "]".repeat(limits.depth + 1) + "}"))).toThrow("nesting or node limit");
  expect(() => digest({ value: Array(limits.nodes).fill(null) })).toThrow("nesting or node limit");
});

test("byte bounds and caller budgets compose across successful captures", () => {
  const path = fixture("{}" + " ".repeat(limits.bytes - 2)), budget = { remaining: limits.bytes * 2 };
  expect(captureClaudeMarketplaceRegistry(path, budget).sha256).toHaveLength(64);
  expect(budget.remaining).toBe(limits.bytes);
  captureClaudeMarketplaceRegistry(path, budget); expect(budget.remaining).toBe(0);
  expect(() => captureClaudeMarketplaceRegistry(path, budget)).toThrow("aggregate byte limit");
  for (const remaining of [-1, NaN, Infinity, 1.5]) expect(() => captureClaudeMarketplaceRegistry(path, { remaining })).toThrow("invalid byte budget");
  truncateSync(path, limits.bytes + 1); expect(() => captureClaudeMarketplaceRegistry(path)).toThrow("bounded regular file");
});

test("directory, symlink, symlink ancestor, missing file and FIFO inputs refuse", () => {
  const path = fixture(), folder = dirname(path);
  rmSync(path); mkdirSync(path); expect(() => captureClaudeMarketplaceRegistry(path)).toThrow("bounded regular file");
  rmSync(path, { recursive: true }); expect(() => captureClaudeMarketplaceRegistry(path)).toThrow();
  const target = join(folder, "target"); writeFileSync(target, "{}"); symlinkSync(target, path);
  expect(() => captureClaudeMarketplaceRegistry(path)).toThrow("bounded regular file");
  const alias = join(dirname(folder), "alias"); symlinkSync(folder, alias);
  expect(() => captureClaudeMarketplaceRegistry(join(alias, "known_marketplaces.json"))).toThrow("symlink");
  rmSync(path); expect(Bun.spawnSync(["mkfifo", path]).exitCode).toBe(0);
  expect(() => captureClaudeMarketplaceRegistry(path)).toThrow("bounded regular file");
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
const { captureClaudeMarketplaceRegistry } = await import(modulePath);
let refused = false; try { captureClaudeMarketplaceRegistry(target); } catch { refused = true; }
process.stdout.write(JSON.stringify({ changed, refused })); process.exitCode = changed && refused ? 0 : 2;
`;
  const modulePath = new URL("./claude-marketplace-registry.ts", import.meta.url).href;
  for (const mode of ["open-replace", "open-symlink", "open-fifo", "read-replace", "read-grow", "read-shrink", "read-mutate", "read-parent"]) {
    const path = fixture(), scriptPath = join(dirname(dirname(path)), "race.mjs"); writeFileSync(scriptPath, script);
    const result = Bun.spawnSync([process.execPath, "--no-env-file", scriptPath, path, mode, modulePath], { timeout: 5000, env: { PATH: process.env.PATH!, HOME: process.env.HOME! } });
    expect({ mode, exitCode: result.exitCode, stderr: result.stderr.toString() }).toEqual({ mode, exitCode: 0, stderr: "" });
    expect(JSON.parse(result.stdout.toString())).toEqual({ changed: true, refused: true });
  }
});
