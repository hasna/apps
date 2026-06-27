import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getTerminalDir } from "./paths.js";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
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

  it("copies legacy ~/.terminal data into ~/.hasna/terminal and returns the new dir", () => {
    const tempHome = join(tmpdir(), `terminal-home-${Date.now()}`);
    const previousHome = process.env.HOME;
    process.env.HOME = tempHome;
    process.env.HASNA_TERMINAL_DIR = "";
    process.env.TERMINAL_DIR = "";

    try {
      const legacyDir = join(tempHome, ".terminal");
      const newDir = join(tempHome, ".hasna", "terminal");
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "history.json"), JSON.stringify([{ command: "echo ok" }]));

      expect(getTerminalDir()).toBe(newDir);
      expect(readFileSync(join(newDir, "history.json"), "utf8")).toContain("echo ok");
      expect(existsSync(join(legacyDir, "history.json"))).toBe(true);
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
      if (previousHome) process.env.HOME = previousHome;
      else delete process.env.HOME;
    }
  });

  it("copies legacy files when ~/.hasna/terminal already exists", () => {
    const tempHome = join(tmpdir(), `terminal-home-existing-${Date.now()}`);
    const previousHome = process.env.HOME;
    process.env.HOME = tempHome;
    process.env.HASNA_TERMINAL_DIR = "";
    process.env.TERMINAL_DIR = "";

    try {
      const legacyDir = join(tempHome, ".terminal");
      const newDir = join(tempHome, ".hasna", "terminal");
      mkdirSync(legacyDir, { recursive: true });
      mkdirSync(newDir, { recursive: true });
      writeFileSync(join(legacyDir, "history.json"), JSON.stringify([{ command: "echo legacy" }]));
      writeFileSync(join(newDir, "config.json"), JSON.stringify({ active: "new" }));

      expect(getTerminalDir()).toBe(newDir);
      expect(readFileSync(join(newDir, "history.json"), "utf8")).toContain("legacy");
      expect(readFileSync(join(newDir, "config.json"), "utf8")).toContain("new");
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
      if (previousHome) process.env.HOME = previousHome;
      else delete process.env.HOME;
    }
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
