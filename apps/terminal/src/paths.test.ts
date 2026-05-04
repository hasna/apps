import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getTerminalDir } from "./paths.js";
import { existsSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("getTerminalDir", () => {
  const origHasna = process.env.HASNA_TERMINAL_DIR;
  const origTerm = process.env.TERMINAL_DIR;

  beforeEach(() => {
    process.env.HASNA_TERMINAL_DIR = "";
    process.env.TERMINAL_DIR = "";
  });

  afterEach(() => {
    if (origHasna) process.env.HASNA_TERMINAL_DIR = origHasna;
    else delete process.env.HASNA_TERMINAL_DIR;
    if (origTerm) process.env.TERMINAL_DIR = origTerm;
    else delete process.env.TERMINAL_DIR;
  });

  it("uses HASNA_TERMINAL_DIR env override", () => {
    const dir = join(tmpdir(), "custom-terminal");
    process.env.HASNA_TERMINAL_DIR = dir;
    expect(getTerminalDir()).toBe(dir);
  });

  it("uses TERMINAL_DIR env override", () => {
    const dir = join(tmpdir(), "fallback-terminal");
    process.env.HASNA_TERMINAL_DIR = "";
    process.env.TERMINAL_DIR = dir;
    expect(getTerminalDir()).toBe(dir);
  });

  it("returns ~/.hasna/terminal when HASNA_TERMINAL_DIR is set", () => {
    process.env.HASNA_TERMINAL_DIR = "/custom/path";
    expect(getTerminalDir()).toBe("/custom/path");
  });
});

describe("getTerminalDir default", () => {
  it("returns a path ending with terminal", () => {
    const dir = getTerminalDir();
    expect(dir).toMatch(/terminal$/);
  });

  it("creates the directory if it doesn't exist", () => {
    expect(existsSync(getTerminalDir())).toBe(true);
  });
});
