import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  adoptResolverHome,
  getExactDataRoot,
  getHomeDir,
  getTerminalDir,
  legacyHomeDir,
  resolverHome,
} from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_TERMINAL_DIR",
  "TERMINAL_DIR",
] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let tempHome: string | null = null;
const cleanups: string[] = [];

beforeEach(() => {
  saved = {};
  tempHome = null;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved = {};
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (tempHome !== null) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
});

/** Isolate the process env: capture all keys, delete them, and set HOME to a fresh temp dir. */
function isolateHome(): string {
  if (tempHome !== null) throw new Error("isolateHome called twice without afterEach");
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  tempHome = mkdtempSync(join(tmpdir(), "terminal-paths-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  return tempHome;
}

describe("getTerminalDir env overrides", () => {
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

  it("returns the HASNA_TERMINAL_DIR value when it is set", () => {
    process.env.HASNA_TERMINAL_DIR = "/custom/path";
    expect(getTerminalDir()).toBe("/custom/path");
  });

  it("treats empty exact-app overrides as unset", () => {
    const home = isolateHome();
    process.env.HASNA_TERMINAL_DIR = "";
    process.env.TERMINAL_DIR = "   ";
    expect(getExactDataRoot()).toBeUndefined();
    expect(getTerminalDir()).toBe(join(home, ".hasna", "terminal"));
  });

  it("resolves exact-app overrides to absolute paths", () => {
    const base = mkdtempSync(join(tmpdir(), "terminal-abs-")); cleanups.push(base);
    const raw = join(base, "..", "terminal-abs-rel");
    process.env.HASNA_TERMINAL_DIR = raw;
    expect(getExactDataRoot()).toBe(resolve(raw));
    expect(getExactDataRoot()?.startsWith("/")).toBe(true);
  });
});

describe("getTerminalDir legacy migration", () => {
  it("copies legacy ~/.terminal data into ~/.hasna/terminal and returns the new dir", () => {
    const tempHome = isolateHome();

    const legacyDir = join(tempHome, ".terminal");
    const newDir = join(tempHome, ".hasna", "terminal");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "history.json"), JSON.stringify([{ command: "echo ok" }]));

    expect(getTerminalDir()).toBe(newDir);
    expect(readFileSync(join(newDir, "history.json"), "utf8")).toContain("echo ok");
    expect(existsSync(join(legacyDir, "history.json"))).toBe(true);
  });

  it("copies legacy files when ~/.hasna/terminal already exists", () => {
    const tempHome = isolateHome();

    const legacyDir = join(tempHome, ".terminal");
    const newDir = join(tempHome, ".hasna", "terminal");
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(legacyDir, "history.json"), JSON.stringify([{ command: "echo legacy" }]));
    writeFileSync(join(newDir, "config.json"), JSON.stringify({ active: "new" }));

    expect(getTerminalDir()).toBe(newDir);
    expect(readFileSync(join(newDir, "history.json"), "utf8")).toContain("legacy");
    expect(readFileSync(join(newDir, "config.json"), "utf8")).toContain("new");
  });
});

describe("resolver (XDG) data-root resolution", () => {
  it("home resolves HOME first, then the OS user database", () => {
    const home = isolateHome();
    expect(getHomeDir()).toBe(home);
  });

  it("resolver data root follows @hasna/paths under a fake HOME", () => {
    const home = isolateHome();
    expect(resolverHome()).toBe(join(home, ".local", "share", "hasna", "terminal"));
    expect(legacyHomeDir()).toBe(join(home, ".hasna", "terminal"));
  });
});

describe("resolver (XDG) adoption — the legacy home must never become invisible", () => {
  it("legacy ~/.hasna/terminal stays the effective dir until adopted", () => {
    const home = isolateHome();
    expect(adoptResolverHome(resolverHome())).toBe(false);
    expect(getTerminalDir()).toBe(join(home, ".hasna", "terminal"));
  });

  it("HASNA_DATA_HOME adopts the resolver (XDG) data root", () => {
    const home = isolateHome();
    const base = mkdtempSync(join(tmpdir(), "terminal-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverHome(resolverHome())).toBe(true);
    expect(getTerminalDir()).toBe(join(base, "terminal"));
  });

  it("an existing config.json at the resolver data root adopts it even without HASNA_DATA_HOME", () => {
    const home = isolateHome();
    const xdg = join(home, ".local", "share", "hasna", "terminal");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "config.json"), "{}");
    expect(adoptResolverHome(resolverHome())).toBe(true);
    expect(getTerminalDir()).toBe(xdg);
  });

  it("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "terminal-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverHome(resolverHome())).toBe(false);
    expect(getTerminalDir()).toBe(join(home, ".hasna", "terminal"));
  });

  it("exact-app overrides win over both the resolver and legacy roots", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "terminal-hasna-dir-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "terminal-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would adopt the XDG root, but the override must win
    process.env.HASNA_TERMINAL_DIR = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getTerminalDir()).toBe(override);
  });
});

describe("getTerminalDir default", () => {
  it("returns a path ending with terminal", () => {
    isolateHome();
    const dir = getTerminalDir();
    expect(dir).toMatch(/terminal$/);
  });

  it("creates the directory if it doesn't exist", () => {
    const home = isolateHome();
    expect(existsSync(getTerminalDir())).toBe(true);
    expect(getTerminalDir()).toBe(join(home, ".hasna", "terminal"));
  });
});
