import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getLearned, recordMapping, learnedStats } from "./usage-cache.js";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { getTerminalDir } from "./paths.js";

describe("usage-cache", () => {
  const CACHE_FILE = join(getTerminalDir(), "learned.json");

  beforeEach(() => {
    if (existsSync(CACHE_FILE)) rmSync(CACHE_FILE);
  });

  afterEach(() => {
    if (existsSync(CACHE_FILE)) rmSync(CACHE_FILE);
  });

  it("returns null for unknown prompt", () => {
    expect(getLearned("never seen before prompt")).toBeNull();
  });

  it("returns learned command after 3 mappings", () => {
    for (let i = 0; i < 3; i++) {
      recordMapping("list files", "ls -la");
    }
    expect(getLearned("list files")).toBe("ls -la");
  });

  it("does not return command before threshold", () => {
    recordMapping("list files", "ls -la");
    recordMapping("list files", "ls -la");
    expect(getLearned("list files")).toBeNull();
  });

  it("different commands reset the count", () => {
    recordMapping("list files", "ls -la");
    recordMapping("list files", "find .");
    recordMapping("list files", "ls -la");
    expect(getLearned("list files")).toBeNull(); // count is 1 for ls -la
  });

  it("stats reflect cache state", () => {
    for (let i = 0; i < 3; i++) {
      recordMapping("list files", "ls -la");
    }
    const stats = learnedStats();
    expect(stats.entries).toBe(1);
    expect(stats.cached).toBe(1);
  });

  it("case insensitive prompt matching", () => {
    for (let i = 0; i < 3; i++) {
      recordMapping("LIST FILES", "ls");
    }
    expect(getLearned("list files")).toBe("ls");
  });
});
