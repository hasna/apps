import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOOPS_DAEMON_REFUSAL_PREFIX, resolveLoopsDaemonStartupGate } from "./index.js";

/**
 * `loops-daemon` fails closed at startup (owner ruling 2026-09-07,
 * hasna/apps#1720). On 0.7.0 every subcommand of the daemon bin constructed
 * `new Store()` with no credential check at all — the whole bin was fail-OPEN
 * (T1 §3.5). The daemon is the on-box scheduler, so it has exactly one
 * legitimate route: the explicit `HASNA_LOOPS_LOCAL=1` opt-in. Every other
 * route refuses BEFORE the data dir is touched.
 *
 * Hermetic: a fully constructed env (no inherited variables), the absent
 * Keychain account via the HASNA_STATION sentinel, an empty HASNA_HOME, a
 * scratch LOOPS_DATA_DIR.
 */

const LOOPS_ROOT = join(import.meta.dir, "../..");
const HOSTED_ENV = { HASNA_LOOPS_API_URL: "https://loops.example.invalid", HASNA_LOOPS_API_KEY: "test-key-not-a-real-secret" } as const;

function sqliteFilesUnder(dir: string, depth = 0): string[] {
  if (depth > 8 || !existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full, depth + 1));
    else if (/\.(?:db|sqlite3?)(?:-wal|-shm)?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function runDaemon(args: string[], overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "loops-daemon-failclosed-"));
  const home = join(root, "home");
  const hasnaHome = join(root, "hasna");
  const dataDir = join(root, "data");
  mkdirSync(home, { recursive: true });
  mkdirSync(hasnaHome, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  try {
    const result = spawnSync(process.execPath, ["--no-env-file", "run", "src/daemon/index.ts", ...args], {
      cwd: LOOPS_ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home,
        USER: process.env.USER ?? "loops-test",
        HASNA_HOME: hasnaHome,
        HASNA_STATION: "no-such-station",
        LOOPS_DATA_DIR: dataDir,
        NO_COLOR: "1",
        ...overrides,
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    return {
      ...result,
      dataDirEntries: readdirSync(dataDir),
      sqliteFiles: [...sqliteFilesUnder(dataDir), ...sqliteFilesUnder(hasnaHome), ...sqliteFilesUnder(home)],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("loops-daemon startup gate (in-process)", () => {
  test("nothing configured refuses on one line naming the tiers and the opt-in", () => {
    const gate = resolveLoopsDaemonStartupGate({ HOME: "/nonexistent", HASNA_STATION: "no-such-station" });
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("unreachable");
    const [firstLine] = gate.message.split("\n");
    expect(firstLine.startsWith(LOOPS_DAEMON_REFUSAL_PREFIX)).toBe(true);
    expect(firstLine).toContain("no loops client connection is configured");
    expect(firstLine).toContain("hasna.credentials.loops.api-key");
    expect(firstLine).toContain("HASNA_LOOPS_API_KEY");
    expect(firstLine).toContain("HASNA_LOOPS_LOCAL=1");
  });

  test("a hosted credential refuses as REMOTE_COMMAND_UNSUPPORTED pointing at loops-runner, never a value", () => {
    const gate = resolveLoopsDaemonStartupGate({ HOME: "/nonexistent", ...HOSTED_ENV });
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("unreachable");
    expect(gate.message).toContain("REMOTE_COMMAND_UNSUPPORTED");
    expect(gate.message).toContain("loops-runner");
    expect(gate.message).toContain("HASNA_LOOPS_LOCAL=1");
    expect(gate.message).not.toContain("test-key-not-a-real-secret");
  });

  test("the retired HASNA_LOOPS_CONNECTION=file is refused with the migration hint, even beside the new opt-in", () => {
    for (const env of [{ HASNA_LOOPS_CONNECTION: "file" }, { HASNA_LOOPS_CONNECTION: "file", HASNA_LOOPS_LOCAL: "1" }]) {
      const gate = resolveLoopsDaemonStartupGate({ HOME: "/nonexistent", ...env });
      expect(gate.ok).toBe(false);
      if (gate.ok) throw new Error("unreachable");
      expect(gate.message).toContain("HASNA_LOOPS_CONNECTION=file is retired");
      expect(gate.message).toContain("HASNA_LOOPS_LOCAL=1");
    }
  });

  test("the explicit opt-in (canonical or alias) admits the daemon without consulting anything", () => {
    expect(resolveLoopsDaemonStartupGate({ HOME: "/nonexistent", HASNA_LOOPS_LOCAL: "1" })).toEqual({ ok: true });
    expect(resolveLoopsDaemonStartupGate({ HOME: "/nonexistent", LOOPS_LOCAL: "1" })).toEqual({ ok: true });
  });

  test("a configured environment outranks the opt-in", () => {
    const gate = resolveLoopsDaemonStartupGate({ HOME: "/nonexistent", HASNA_LOOPS_LOCAL: "1", ...HOSTED_ENV });
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("unreachable");
    expect(gate.message).toContain("REMOTE_COMMAND_UNSUPPORTED");
  });
});

describe("loops-daemon bin fails closed at startup (spawned)", () => {
  test("FAILING INPUT (0.7.0 opened the store): `status` with nothing configured exits non-zero before touching the data dir", () => {
    const result = runDaemon(["status"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    const [firstLine] = result.stderr.split("\n");
    expect(firstLine).toContain(LOOPS_DAEMON_REFUSAL_PREFIX);
    expect(firstLine).toContain("no loops client connection is configured");
    expect(firstLine).toContain("hasna.credentials.loops.api-key");
    expect(firstLine).toContain("HASNA_LOOPS_LOCAL=1");
    expect(result.stderr).not.toMatch(/^\s+at /m);
    expect(result.dataDirEntries).toEqual([]);
    expect(result.sqliteFiles).toEqual([]);
  }, 30_000);

  test("`run` and `install` are gated the same way with nothing configured", () => {
    for (const args of [["run"], ["install"]]) {
      const result = runDaemon(args);
      expect(result.status, JSON.stringify(args)).not.toBe(0);
      expect(result.stderr).toContain(LOOPS_DAEMON_REFUSAL_PREFIX);
      expect(result.dataDirEntries).toEqual([]);
      expect(result.sqliteFiles).toEqual([]);
    }
  }, 60_000);

  test("under a hosted credential `status` refuses REMOTE_COMMAND_UNSUPPORTED, opens nothing, leaks nothing", () => {
    const result = runDaemon(["status"], { ...HOSTED_ENV });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("REMOTE_COMMAND_UNSUPPORTED");
    expect(result.stderr).toContain("loops-runner");
    expect(result.stdout + result.stderr).not.toContain("test-key-not-a-real-secret");
    expect(result.dataDirEntries).toEqual([]);
    expect(result.sqliteFiles).toEqual([]);
  }, 30_000);

  test("the retired HASNA_LOOPS_CONNECTION=file (what 0.7.0 units exported) is refused and opens nothing", () => {
    const result = runDaemon(["status"], { HASNA_LOOPS_CONNECTION: "file" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HASNA_LOOPS_CONNECTION=file is retired");
    expect(result.stderr).toContain("HASNA_LOOPS_LOCAL=1");
    expect(result.dataDirEntries).toEqual([]);
    expect(result.sqliteFiles).toEqual([]);
  }, 30_000);

  test("CONTROL: HASNA_LOOPS_LOCAL=1 runs `status` against the on-box store and announces LOCAL mode once", () => {
    const result = runDaemon(["status"], { HASNA_LOOPS_LOCAL: "1" });
    expect(result.status, result.stderr).toBe(0);
    const status = JSON.parse(result.stdout) as { running: boolean; loops: { total: number } };
    expect(status.running).toBe(false);
    expect(status.loops.total).toBe(0);
    expect(result.stderr.match(/loops: LOCAL mode/g)?.length ?? 0).toBe(1);
    expect(result.dataDirEntries).toContain("loops.db");
  }, 30_000);

  test("--help and --version answer ahead of the gate and open nothing", () => {
    const help = runDaemon(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("loops-daemon");
    expect(help.dataDirEntries).toEqual([]);
    const version = runDaemon(["--version"]);
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(version.dataDirEntries).toEqual([]);
  }, 60_000);
});
