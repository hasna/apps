// agent-authored: the SOL consult refused on two distinct accounts
// (usage-limit, then model-at-capacity), so this gap analysis and test
// spec were authored by Paulinus from direct source reading. Zero test
// files in this package imported src/lib/portable-command.ts directly;
// prepareWindowsBatchCommand was reachable only through claude-launch-cli.
// These tests pin the win32 resolution/escaping contract, which the
// Linux-only indirect coverage could never exercise.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  preparePortableCommand,
  prepareWindowsBatchCommand,
  type PortableCommand,
  type WindowsBatchCommand,
} from "./portable-command.js";

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
function setPlatform(value: string): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}
afterEach(() => {
  if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
});

const WIN_PATH = "C:\\Windows\\System32\\cmd.exe";

describe("preparePortableCommand — non-win32 (live platform)", () => {
  test("passes the command and args through untouched without verbatim flag", () => {
    const prepared = preparePortableCommand("claude", ["--version"], process.env);
    expect(prepared).toEqual({ command: "claude", args: ["--version"] } satisfies PortableCommand);
    expect(prepared.windowsVerbatimArguments).toBeUndefined();
  });

  test("never routes a .cmd executable through cmd.exe off win32", () => {
    const prepared = preparePortableCommand("claude.cmd", ["--bg"], process.env);
    expect(prepared).toEqual({ command: "claude.cmd", args: ["--bg"] });
  });
});

describe("preparePortableCommand — win32 executable resolution (platform stubbed)", () => {
  test("bare name resolving to a .cmd shim routes through COMSPEC as a batch command", () => {
    setPlatform("win32");
    const binDir = mkdtempSync(join(tmpdir(), "accounts-portable-cmd-"));
    writeFileSync(join(binDir, "tool.cmd"), "@echo off\r\n");
    const prepared = preparePortableCommand("tool", [], {
      PATH: binDir,
      COMSPEC: WIN_PATH,
    });
    expect(prepared.command).toBe(WIN_PATH);
    expect(prepared.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(prepared.args[3]).toContain("tool.cmd");
    expect(prepared.windowsVerbatimArguments).toBe(true);
  });

  test("bare name resolving to a non-batch executable passes through plainly", () => {
    setPlatform("win32");
    const binDir = mkdtempSync(join(tmpdir(), "accounts-portable-exe-"));
    writeFileSync(join(binDir, "tool.exe"), "MZ");
    const prepared = preparePortableCommand("tool", ["--go"], { PATH: binDir });
    expect(prepared).toEqual({ command: join(binDir, "tool.exe"), args: ["--go"] });
    expect(prepared.windowsVerbatimArguments).toBeUndefined();
  });

  test("defaults COMSPEC to cmd.exe when the environment carries none", () => {
    setPlatform("win32");
    const binDir = mkdtempSync(join(tmpdir(), "accounts-portable-comspec-"));
    writeFileSync(join(binDir, "shim.bat"), "@echo off\r\n");
    const prepared = preparePortableCommand("shim", [], { PATH: binDir });
    expect(prepared.command).toBe("cmd.exe");
    expect(prepared.args[0]).toBe("/d");
  });

  test("PATHEXT order decides the resolved executable when several extensions exist", () => {
    setPlatform("win32");
    const binDir = mkdtempSync(join(tmpdir(), "accounts-portable-pathext-"));
    writeFileSync(join(binDir, "tool.bat"), "@echo off\r\n");
    writeFileSync(join(binDir, "tool.cmd"), "@echo off\r\n");
    // PATHEXT lists .CMD before .BAT: the .cmd shim must win.
    const prepared = preparePortableCommand("tool", [], {
      PATH: binDir,
      PATHEXT: ".CMD;.BAT",
    });
    expect(prepared.command).toBe("cmd.exe");
    expect(prepared.args[3]).toContain("tool.cmd");
    expect(prepared.args[3]).not.toContain("tool.bat");
  });

  test("PATH order decides when two directories hold the same bare name", () => {
    setPlatform("win32");
    const first = mkdtempSync(join(tmpdir(), "accounts-portable-first-"));
    const second = mkdtempSync(join(tmpdir(), "accounts-portable-second-"));
    writeFileSync(join(first, "tool.cmd"), "@echo off\r\n");
    writeFileSync(join(second, "tool.cmd"), "@echo off\r\n");
    const prepared = preparePortableCommand("tool", [], {
      PATH: `${first}${require("node:path").delimiter}${second}`,
    });
    expect(prepared.args[3]).toContain(first);
    expect(prepared.args[3]).not.toContain(second);
  });

  test("probes the upper-case extension variant when only it exists on disk", () => {
    setPlatform("win32");
    const binDir = mkdtempSync(join(tmpdir(), "accounts-portable-upper-"));
    // The module uppercases the extension only (`tool` + `.CMD`), so the
    // fixture must carry the mixed-case name; Windows resolves it, Linux
    // would not.
    writeFileSync(join(binDir, "tool.CMD"), "@echo off\r\n");
    const prepared = preparePortableCommand("tool", [], { PATH: binDir });
    expect(prepared.args[3]).toContain("tool.CMD");
  });

  test("quoted PATH entries are unquoted and empty entries are skipped", () => {
    setPlatform("win32");
    const binDir = mkdtempSync(join(tmpdir(), "accounts-portable-quoted-"));
    writeFileSync(join(binDir, "tool.cmd"), "@echo off\r\n");
    // The module splits PATH on the platform delimiter captured at import
    // (":" on this host); quote one entry and pad with empty entries.
    const prepared = preparePortableCommand("tool", [], {
      PATH: `:"${binDir}":`,
    });
    expect(prepared.args[3]).toContain(binDir);
  });

  test("an unresolved bare name is returned unchanged", () => {
    setPlatform("win32");
    const emptyDir = mkdtempSync(join(tmpdir(), "accounts-portable-empty-"));
    const prepared = preparePortableCommand("missing-tool", ["arg"], { PATH: emptyDir });
    expect(prepared).toEqual({ command: "missing-tool", args: ["arg"] });
  });

  test("environment lookups are case-insensitive", () => {
    setPlatform("win32");
    const binDir = mkdtempSync(join(tmpdir(), "accounts-portable-case-"));
    writeFileSync(join(binDir, "tool.cmd"), "@echo off\r\n");
    const prepared = preparePortableCommand("tool", [], {
      path: binDir,
      pathext: ".CMD",
      comspec: WIN_PATH,
    });
    expect(prepared.command).toBe(WIN_PATH);
    expect(prepared.args[3]).toContain("tool.cmd");
  });

  test("an absolute or separator-bearing executable skips PATH probing", () => {
    setPlatform("win32");
    const nowhere = mkdtempSync(join(tmpdir(), "accounts-portable-abs-"));
    const absolute = preparePortableCommand(join(nowhere, "tool.exe"), [], { PATH: nowhere });
    expect(absolute).toEqual({ command: join(nowhere, "tool.exe"), args: [] });
    const withSlash = preparePortableCommand(".\\tool.exe", [], { PATH: nowhere });
    expect(withSlash).toEqual({ command: ".\\tool.exe", args: [] });
  });
});

describe("prepareWindowsBatchCommand — escaping contract", () => {
  test("assembles the /d /s /c form with verbatim args and the given interpreter", () => {
    const command = prepareWindowsBatchCommand("claude.cmd", ["Prompt"], WIN_PATH);
    expect(command.command).toBe(WIN_PATH);
    expect(command.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(command.args).toHaveLength(4);
    expect(command.windowsVerbatimArguments).toBe(true);
  });

  test("escapes executable metacharacters so the raw command cannot inject", () => {
    const command = prepareWindowsBatchCommand("C:\\Tools & Stuff\\claude.cmd", [], "cmd.exe");
    const serialized = command.args[3];
    expect(serialized).toBe('"C:\\Tools^ ^&^ Stuff\\claude.cmd"');
    expect(serialized).not.toContain("& Stuff");
  });

  test("double-escapes argument metacharacters for the batch shim", () => {
    const command = prepareWindowsBatchCommand("claude.cmd", ["x&whoami", "%PATH%"], "cmd.exe");
    const serialized = command.args[3];
    // The inner argument is quoted, and both passes caret-escape every
    // metacharacter: `&` renders as `^&` twice -> `^^^&`; `%` similarly.
    expect(serialized).toContain("x^^^&whoami");
    expect(serialized).toContain("^^^%PATH^^^%");
    // No raw metacharacter may survive into the serialized command line.
    expect(serialized).not.toContain("x&whoami");
    expect(serialized).not.toContain("%PATH%");
  });

  test("escapes carets and quotes inside argument values", () => {
    const command = prepareWindowsBatchCommand("claude.cmd", ["caret^value", "quote\"value"], "cmd.exe");
    const serialized = command.args[3];
    expect(serialized).toContain("caret^^^^value");
    expect(serialized).toContain("quote\\^^^\"value");
    expect(serialized).not.toContain("quote\"value");
  });

  test("doubles trailing backslashes and escapes embedded quotes", () => {
    const command = prepareWindowsBatchCommand("claude.cmd", ["trailing\\", "a\"b"], "cmd.exe");
    const serialized = command.args[3];
    expect(serialized).toContain("trailing\\\\^^^\"");
    expect(serialized).toContain("a\\^^^\"b");
  });

  test("rejects line breaks in any batch argument", () => {
    expect(() => prepareWindowsBatchCommand("claude.cmd", ["line\nbreak"], "cmd.exe")).toThrow(
      "Windows batch arguments cannot contain line breaks",
    );
    expect(() => prepareWindowsBatchCommand("claude.cmd", ["line\rbreak"], "cmd.exe")).toThrow(
      "Windows batch arguments cannot contain line breaks",
    );
  });
});
