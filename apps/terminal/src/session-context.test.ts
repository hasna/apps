import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadContext, saveContext, formatContext } from "./session-context.js";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { getTerminalDir } from "./paths.js";

describe("session-context", () => {
  const CTX_FILE = join(getTerminalDir(), "session-context.json");

  beforeEach(() => {
    if (existsSync(CTX_FILE)) rmSync(CTX_FILE);
  });

  afterEach(() => {
    if (existsSync(CTX_FILE)) rmSync(CTX_FILE);
  });

  it("returns empty array when no context exists", () => {
    expect(loadContext()).toEqual([]);
  });

  it("saves and loads context entries", () => {
    saveContext("list files", "ls -la", "total 42\ndrwxr-xr-x file.txt");
    const ctx = loadContext();
    expect(ctx.length).toBe(1);
    expect(ctx[0].command).toBe("ls -la");
  });

  it("truncates output to 500 chars", () => {
    const longOutput = "x".repeat(1000);
    saveContext("test", "echo", longOutput);
    const ctx = loadContext();
    expect(ctx[0].output.length).toBe(500);
  });

  it("keeps only last 5 entries", () => {
    for (let i = 0; i < 8; i++) {
      saveContext(`query ${i}`, `cmd ${i}`, `out ${i}`);
    }
    const ctx = loadContext();
    expect(ctx.length).toBeLessThanOrEqual(5);
  });

  it("formatContext returns empty when no entries", () => {
    expect(formatContext()).toBe("");
  });

  it("formatContext returns formatted entries", () => {
    saveContext("show auth code", "cat auth.ts", "const auth = {};");
    const formatted = formatContext();
    expect(formatted).toContain("RECENT SESSION CONTEXT");
    expect(formatted).toContain("show auth code");
    expect(formatted).toContain("cat auth.ts");
  });
});
