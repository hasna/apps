/**
 * Fleet fail-closed doctrine (2026-09-04, hasna/apps#1613, #1720): a CLI run
 * without a resolved registry credential must FAIL CLOSED — non-zero exit,
 * actionable error naming the required env, and no local SQLite fallback —
 * unless local mode was explicitly opted into (HASNA_HOOKS_LOCAL=1) or the
 * @hasna/contracts chain resolves a STRICT pair (URL + key together; a URL
 * without a key is a refusal, never half-open progress).
 *
 * These tests spawn the real CLI entrypoint in a sandboxed environment that
 * strips every transport env key and pins the data root into a fresh tmp dir.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CLI = join(import.meta.dir, "index.tsx");

const TRANSPORT_ENV_KEYS = [
  "HASNA_HOOKS_API_URL",
  "HOOKS_API_URL",
  "HASNA_HOOKS_API_KEY",
  "HOOKS_API_KEY",
  "HASNA_HOOKS_API_KEY_OVERRIDE",
  "HASNA_HOOKS_API_KEY_REF",
  "HASNA_PROFILE",
  "HASNA_HOOKS_LOCAL",
  "HOOKS_LOCAL",
];

const REFUSING = "Refusing to silently fall back to local storage.";

interface Sandbox {
  root: string; // parent tmp dir, removed after the test
  dataDir: string; // pinned HASNA_HOOKS_DATA_DIR (created lazily by commands)
  home: string; // pinned HOME
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "hooks-fail-closed-"));
  return {
    root,
    dataDir: join(root, "data"),
    home: join(root, "home"),
  };
}

function cleanEnv(sb: Sandbox): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of TRANSPORT_ENV_KEYS) delete env[key];
  env.HOME = sb.home;
  env.HASNA_HOOKS_DATA_DIR = sb.dataDir;
  env.HASNA_HOOKS_DB_PATH = join(sb.dataDir, "hooks.db");
  env.HASNA_HOOKS_LOCK_PATH = join(sb.dataDir, "hooks.lock");
  env.HASNA_HOOKS_CONFIG_PATH = join(sb.dataDir, "config.json");
  env.HASNA_HOOKS_CLAUDE_SETTINGS_PATH = join(sb.home, ".claude", "settings.json");
  env.NO_COLOR = "1";
  return env;
}

const sandboxes: Sandbox[] = [];

afterEach(() => {
  const sb = sandboxes.pop();
  if (sb) rmSync(sb.root, { recursive: true, force: true });
});

async function runCli(
  args: string[],
  env: Record<string, string>,
  timeoutMs = 20_000,
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env,
  });
  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {
      // already exited
    }
  }, timeoutMs);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
  ]);
  const exitCode = await proc.exited;
  clearTimeout(killer);
  return { stdout, stderr, exitCode, timedOut };
}

describe("hooks transport gate (fleet fail-closed)", () => {
  test("hooks list without API env or local opt-in fails closed and creates nothing on disk", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    const result = await runCli(["list"], cleanEnv(sb));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("HASNA_HOOKS_API_URL");
    expect(result.stderr).toContain("HASNA_HOOKS_LOCAL=1");
    expect(result.stderr).toContain(REFUSING);
    // No local store, no data dir, no settings writes anywhere in the sandbox.
    expect(existsSync(sb.dataDir)).toBe(false);
    expect(existsSync(join(sb.dataDir, "hooks.db"))).toBe(false);
    expect(existsSync(join(sb.home, ".claude"))).toBe(false);
  });

  test("bare `hooks` (interactive) without API env or local opt-in fails closed instead of opening local mode", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    const result = await runCli([], cleanEnv(sb));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("HASNA_HOOKS_API_URL");
    expect(result.stderr).toContain(REFUSING);
    expect(existsSync(sb.dataDir)).toBe(false);
  });

  test("help and version stay available without any transport configuration", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    const help = await runCli(["--help"], cleanEnv(sb));
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("Install hooks for AI coding agents");
    const version = await runCli(["--version"], cleanEnv(sb));
    expect(version.exitCode).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(existsSync(sb.dataDir)).toBe(false);
  });

  test("an unknown token fails closed instead of falling into the interactive TUI", async () => {
    // `interactive` is the default command, so commander routes ANY token that
    // matches no command to the interactive TUI — a local-catalog browsing
    // surface. Without an API URL or local opt-in that must fail closed, not
    // open local mode.
    const sb = makeSandbox();
    sandboxes.push(sb);
    const result = await runCli(["frobnicate"], cleanEnv(sb));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("HASNA_HOOKS_API_URL");
    expect(result.stderr).toContain(REFUSING);
    expect(existsSync(sb.dataDir)).toBe(false);
  });

  test("HASNA_HOOKS_LOCAL=1 opts into local mode: list and log tail run against the local store", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    const env = cleanEnv(sb);
    env.HASNA_HOOKS_LOCAL = "1";
    const list = await runCli(["list"], env);
    expect(list.timedOut).toBe(false);
    expect(list.exitCode).toBe(0);
    expect(list.stderr).not.toContain(REFUSING);
    // Local mode SAYS so on stderr, once per process ("local on stderr").
    expect(list.stderr).toMatch(/LOCAL mode/);
    // log tail opens the local SQLite store at the pinned data root.
    const tail = await runCli(["log", "tail"], env);
    expect(tail.timedOut).toBe(false);
    expect(tail.exitCode).toBe(0);
    expect(tail.stderr).not.toContain(REFUSING);
    expect(existsSync(join(sb.dataDir, "hooks.db"))).toBe(true);
  });

  test("a STRICT env pair (URL + key) opens the gate: list runs without touching SQLite", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    // The pair is the unit after the @hasna/contracts adoption: a URL alone is
    // a refusal, URL+key together is a complete configuration.
    const env = cleanEnv(sb);
    env.HASNA_HOOKS_API_URL = "https://api.hasna.com/hooks";
    env.HASNA_HOOKS_API_KEY = "gate-test-key";
    const result = await runCli(["list"], env);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(REFUSING);
    // No local SQLite store was opened as a side effect of the gate opening.
    expect(existsSync(join(sb.dataDir, "hooks.db"))).toBe(false);
  });

  test("a URL-only environment fails closed at the registry command — STRICT PAIR, no SQLite", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    const env = cleanEnv(sb);
    env.HASNA_HOOKS_API_URL = "https://api.hasna.com/hooks";
    const result = await runCli(["sync"], env);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("REMOTE_API_KEY_MISSING");
    expect(result.stderr).toContain("HASNA_HOOKS_API_KEY");
    expect(existsSync(sb.dataDir)).toBe(false);
    expect(existsSync(join(sb.home, ".hasna"))).toBe(false);
  });

  test("the retired config.json api_url does NOT open the gate (key store removed)", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    // config.json (api_url / api_key_ref) was the app's own key store; it is
    // retired (hasna/apps#1720) — the resolver never reads it, so a leftover
    // file must not resurrect remote routing.
    mkdirSync(sb.dataDir, { recursive: true });
    writeFileSync(
      join(sb.dataDir, "config.json"),
      JSON.stringify({ api_url: "https://api.hasna.com/hooks" }, null, 2) + "\n",
    );
    const env = cleanEnv(sb);
    const result = await runCli(["list"], env);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("HASNA_HOOKS_API_URL");
    expect(result.stderr).toContain("config.json (api_url / api_key_ref) is RETIRED");
    expect(result.stderr).toContain(REFUSING);
    // No local SQLite store was opened.
    expect(existsSync(join(sb.dataDir, "hooks.db"))).toBe(false);
  });

  test("a config.json without api_url does not open the gate", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    mkdirSync(sb.dataDir, { recursive: true });
    writeFileSync(join(sb.dataDir, "config.json"), "{}\n");
    const result = await runCli(["list"], cleanEnv(sb));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("HASNA_HOOKS_API_URL");
    expect(result.stderr).toContain(REFUSING);
  });
});
