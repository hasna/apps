import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  commandNotFoundMessage,
  commonExecutableDirs,
  executableExists,
  normalizeExecutionPath,
} from "./env.js";

describe("env", () => {
  test("commonExecutableDirs derives user bin dirs from HOME and package manager env", () => {
    const dirs = commonExecutableDirs({
      HOME: "/home/example",
      BUN_INSTALL: "/opt/bun",
      PNPM_HOME: "/opt/pnpm",
      NPM_CONFIG_PREFIX: "/opt/npm-global",
    });
    expect(dirs).toContain("/home/example/.local/bin");
    expect(dirs).toContain("/home/example/.bun/bin");
    expect(dirs).toContain("/home/example/.cargo/bin");
    expect(dirs).toContain("/opt/bun/bin");
    expect(dirs).toContain("/opt/pnpm");
    expect(dirs).toContain("/opt/npm-global/bin");
    expect(dirs).toContain("/usr/bin");
    expect(dirs).toContain("/bin");
  });

  test("commonExecutableDirs drops blank and duplicate entries", () => {
    const dirs = commonExecutableDirs({ HOME: "/home/example", PNPM_HOME: "  ", BUN_INSTALL: "/home/example/.bun" });
    expect(dirs.filter((dir) => dir === "/home/example/.bun/bin")).toHaveLength(1);
    expect(dirs.every((dir) => dir.trim().length > 0)).toBe(true);
    expect(new Set(dirs).size).toBe(dirs.length);
  });

  test("normalizeExecutionPath keeps existing PATH order first and dedupes", () => {
    const path = normalizeExecutionPath({
      HOME: "/home/example",
      PATH: ["/custom/bin", "", "/usr/bin", "/custom/bin"].join(delimiter),
    });
    const parts = path.split(delimiter);
    expect(parts[0]).toBe("/custom/bin");
    expect(parts.filter((part) => part === "/custom/bin")).toHaveLength(1);
    expect(parts.filter((part) => part === "/usr/bin")).toHaveLength(1);
    expect(parts).toContain("/home/example/.local/bin");
    expect(parts).not.toContain("");
  });

  test("executableExists resolves bare commands through PATH and honors the execute bit", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-env-exec-"));
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const runnable = join(bin, "openloops-env-runnable");
    writeFileSync(runnable, "#!/bin/sh\nexit 0\n");
    chmodSync(runnable, 0o755);
    const plainFile = join(bin, "openloops-env-plain");
    writeFileSync(plainFile, "not executable\n");
    chmodSync(plainFile, 0o644);
    try {
      const env = { PATH: `${bin}${delimiter}/usr/bin` };
      expect(executableExists("openloops-env-runnable", env)).toBe(true);
      expect(executableExists("openloops-env-plain", env)).toBe(false);
      expect(executableExists("openloops-env-missing", env)).toBe(false);
      expect(executableExists(runnable, { PATH: "" })).toBe(true);
      expect(executableExists(plainFile, { PATH: "" })).toBe(false);
      expect(executableExists("openloops-env-runnable", { PATH: "" })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("commandNotFoundMessage reports the command and effective PATH", () => {
    expect(commandNotFoundMessage("missing-tool", { PATH: "/usr/bin" })).toBe(
      "Executable not found in PATH: missing-tool. Effective PATH=/usr/bin",
    );
    expect(commandNotFoundMessage("missing-tool", { PATH: "" })).toContain("Effective PATH=(empty)");
  });
});
