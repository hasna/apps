import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  bunGlobalDependencyBinDirs,
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

  test("commonExecutableDirs searches the Bun global dependency bin dir, which is never on PATH", () => {
    const dirs = commonExecutableDirs({
      HOME: "/home/example",
      BUN_INSTALL: "/opt/bun",
    });
    // `bun add -g <pkg>` links only the top-level package's bins into
    // `<BUN_INSTALL>/bin`; every transitive dependency's bins are materialized
    // here instead, and bun does not export this directory.
    expect(dirs).toContain("/opt/bun/install/global/node_modules/.bin");
    // The default install root must be searched even with BUN_INSTALL unset.
    expect(commonExecutableDirs({ HOME: "/home/example" })).toContain(
      "/home/example/.bun/install/global/node_modules/.bin",
    );
    expect(bunGlobalDependencyBinDirs({ HOME: "/home/example", BUN_INSTALL: "/opt/bun" })).toEqual([
      "/opt/bun/install/global/node_modules/.bin",
      "/home/example/.bun/install/global/node_modules/.bin",
    ]);
  });

  test("normalizeExecutionPath resolves a dependency-installed CLI that bun left unlinked in $BUN_INSTALL/bin", () => {
    // The real shape of a station global install, reproduced on disk:
    //
    //   <BUN_INSTALL>/bin/                                     <- top-level links only
    //   <BUN_INSTALL>/install/global/node_modules/@hasna/accounts
    //   <BUN_INSTALL>/install/global/node_modules/.bin/accounts <- the CLI itself
    //
    // `accounts` is installed as a dependency, so no `<BUN_INSTALL>/bin/accounts`
    // symlink exists — the preflight's `command -v accounts` sees nothing and the
    // remote bootstrap exits 127 on a healthy machine. The resolver is the fix.
    const root = mkdtempSync(join(tmpdir(), "loops-env-bun-global-"));
    const bunInstall = join(root, "bun");
    const topLevelBin = join(bunInstall, "bin");
    const dependencyBin = join(bunInstall, "install", "global", "node_modules", ".bin");
    mkdirSync(topLevelBin, { recursive: true });
    mkdirSync(dependencyBin, { recursive: true });
    const dependencyCli = join(dependencyBin, "openloops-env-accounts");
    writeFileSync(dependencyCli, "#!/bin/sh\nexit 0\n");
    chmodSync(dependencyCli, 0o755);
    try {
      const env = { HOME: root, BUN_INSTALL: bunInstall, PATH: "/usr/bin:/bin" };
      // The contract: bun produced no top-level link, so PATH alone cannot see it…
      expect(existsSync(join(topLevelBin, "openloops-env-accounts"))).toBe(false);
      expect(executableExists("openloops-env-accounts", env)).toBe(false);
      // …and the resolution path the executor actually hands its children does.
      const resolved = { ...env, PATH: normalizeExecutionPath(env) };
      expect(executableExists("openloops-env-accounts", resolved)).toBe(true);
      expect(normalizeExecutionPath(env)).toContain(dependencyBin);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
