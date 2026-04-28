import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import {
  ensureDir,
  listJsonFiles,
  readJsonFile,
  writeJsonFile,
  readHighWaterMark,
  writeHighWaterMark,
  getFileMtimeMs,
  parseTimestamp,
  appendSyncConflict,
} from "./sync-utils.js";

describe("ensureDir", () => {
  it("should create a new directory", () => {
    const dir = `/tmp/todos-test-ensure-${Date.now()}`;
    try {
      ensureDir(dir);
      expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should create nested directories", () => {
    const root = `/tmp/todos-test-nested-${Date.now()}`;
    const dir = `${root}/a/b/c`;
    try {
      ensureDir(dir);
      expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("should not throw if directory already exists", () => {
    const dir = `/tmp/todos-test-existing-${Date.now()}`;
    try {
      mkdirSync(dir);
      ensureDir(dir);
      expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("listJsonFiles", () => {
  const testDir = `/tmp/todos-test-json-${Date.now()}`;

  beforeEach(() => { ensureDir(testDir); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("should return empty array for non-existent dir", () => {
    expect(listJsonFiles("/tmp/nonexistent-todos-12345")).toEqual([]);
  });

  it("should list only .json files", () => {
    writeFileSync(`${testDir}/a.json`, "{}");
    writeFileSync(`${testDir}/b.json`, "{}");
    writeFileSync(`${testDir}/c.txt`, "text");

    const files = listJsonFiles(testDir);
    expect(files).toHaveLength(2);
    expect(files).toContain("a.json");
    expect(files).toContain("b.json");
  });

  it("should return empty for dir with no json files", () => {
    writeFileSync(`${testDir}/readme.md`, "# readme");
    expect(listJsonFiles(testDir)).toEqual([]);
  });
});

describe("readJsonFile", () => {
  const testFile = `/tmp/todos-test-read-${Date.now()}.json`;

  afterEach(() => { try { rmSync(testFile); } catch {} });

  it("should parse valid JSON", () => {
    writeFileSync(testFile, JSON.stringify({ key: "value" }));
    const result = readJsonFile<{ key: string }>(testFile);
    expect(result).toEqual({ key: "value" });
  });

  it("should return null for non-existent file", () => {
    expect(readJsonFile("/tmp/nonexistent-todos-read-99999.json")).toBeNull();
  });

  it("should return null for invalid JSON", () => {
    writeFileSync(testFile, "not json");
    expect(readJsonFile(testFile)).toBeNull();
  });
});

describe("writeJsonFile", () => {
  const testFile = `/tmp/todos-test-write-${Date.now()}.json`;

  afterEach(() => { try { rmSync(testFile); } catch {} });

  it("should write formatted JSON", () => {
    writeJsonFile(testFile, { name: "test", count: 42 });
    const content = readFileSync(testFile, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({ name: "test", count: 42 });
    // Should be pretty-printed (contains newline)
    expect(content).toContain("\n");
  });

  it("should end with a newline", () => {
    writeJsonFile(testFile, { a: 1 });
    const content = readFileSync(testFile, "utf-8");
    expect(content.endsWith("\n")).toBe(true);
  });
});

describe("readHighWaterMark", () => {
  const testDir = `/tmp/todos-test-hwm-${Date.now()}`;

  beforeEach(() => { ensureDir(testDir); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("should return 1 when no mark file exists", () => {
    expect(readHighWaterMark(testDir)).toBe(1);
  });

  it("should return the stored value", () => {
    writeHighWaterMark(testDir, 42);
    expect(readHighWaterMark(testDir)).toBe(42);
  });

  it("should return 1 for invalid content", () => {
    writeFileSync(`${testDir}/.highwatermark`, "not-a-number");
    expect(readHighWaterMark(testDir)).toBe(1);
  });
});

describe("writeHighWaterMark", () => {
  const testDir = `/tmp/todos-test-hwm-write-${Date.now()}`;

  beforeEach(() => { ensureDir(testDir); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("should write a numeric value to .highwatermark", () => {
    writeHighWaterMark(testDir, 99);
    const content = readFileSync(`${testDir}/.highwatermark`, "utf-8");
    expect(content.trim()).toBe("99");
  });
});

describe("getFileMtimeMs", () => {
  const testFile = `/tmp/todos-test-mtime-${Date.now()}.txt`;

  afterEach(() => { try { rmSync(testFile); } catch {} });

  it("should return mtime for existing file", () => {
    writeFileSync(testFile, "content");
    const mtime = getFileMtimeMs(testFile);
    expect(mtime).not.toBeNull();
    expect(typeof mtime).toBe("number");
    expect(mtime).toBeGreaterThan(0);
  });

  it("should return null for non-existent file", () => {
    expect(getFileMtimeMs("/tmp/nonexistent-todos-mtime-99999.txt")).toBeNull();
  });
});

describe("parseTimestamp", () => {
  it("should parse valid ISO string", () => {
    const result = parseTimestamp("2026-01-15T12:00:00.000Z");
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(0);
  });

  it("should return null for non-string input", () => {
    expect(parseTimestamp(123)).toBeNull();
    expect(parseTimestamp(null as any)).toBeNull();
    expect(parseTimestamp(undefined as any)).toBeNull();
  });

  it("should return null for invalid date string", () => {
    expect(parseTimestamp("not-a-date")).toBeNull();
  });
});

describe("appendSyncConflict", () => {
  it("should add conflict to empty metadata", () => {
    const result = appendSyncConflict({}, { file: "test.txt", type: "content", message: "conflict" });
    expect(Array.isArray(result.sync_conflicts)).toBe(true);
    expect(result.sync_conflicts).toHaveLength(1);
    expect(result.sync_conflicts[0]).toEqual({ file: "test.txt", type: "content", message: "conflict" });
  });

  it("should prepend new conflicts", () => {
    const meta: any = { sync_conflicts: [{ file: "old.txt", type: "content", message: "old" }] };
    const result = appendSyncConflict(meta, { file: "new.txt", type: "content", message: "new" });
    expect(result.sync_conflicts[0]).toHaveProperty("file", "new.txt");
    expect(result.sync_conflicts[1]).toHaveProperty("file", "old.txt");
  });

  it("should respect limit", () => {
    const meta: any = { sync_conflicts: [] };
    const result = appendSyncConflict(meta, { file: "a.txt", type: "content", message: "a" }, 2);
    const withMore = appendSyncConflict(result, { file: "b.txt", type: "content", message: "b" }, 2);
    const withThird = appendSyncConflict(withMore, { file: "c.txt", type: "content", message: "c" }, 2);
    expect(withThird.sync_conflicts).toHaveLength(2);
    expect(withThird.sync_conflicts[0].file).toBe("c.txt");
    expect(withThird.sync_conflicts[1].file).toBe("b.txt");
  });

  it("should preserve other metadata keys", () => {
    const meta: any = { other_key: "value" };
    const result = appendSyncConflict(meta, { file: "test.txt", type: "content", message: "conflict" });
    expect(result.other_key).toBe("value");
    expect(result.sync_conflicts).toBeDefined();
  });

  it("should handle non-array sync_conflicts as empty", () => {
    const meta: any = { sync_conflicts: "not-an-array" };
    const result = appendSyncConflict(meta, { file: "test.txt", type: "content", message: "conflict" });
    expect(result.sync_conflicts).toHaveLength(1);
  });
});
