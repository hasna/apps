/**
 * Transport independence (owner directive 2026-08-15: the storage-mode axis
 * is retired). The CLI must NEVER gate a command on the transport: every
 * command works hosted (registry authority + credential resolved by the
 * @hasna/contracts chain — env pair, Keychain, or the credentials file) or
 * local (bundled registry + on-box SQLite store, which is the baseline when
 * no authority resolves and the explicit `HASNA_HOOKS_LOCAL=1` selection
 * stays accepted).
 *
 * The ONE strict-pair refusal that survives is credential validation, not
 * transport selection: an environment that DECLARES an authority (env URL
 * without a key) is a refusal — a named tier never falls through to a
 * different dataset.
 *
 * These tests spawn the real CLI entrypoint in a sandboxed environment that
 * strips every transport env key and pins the data root into a fresh tmp dir.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
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
  const root = mkdtempSync(join(tmpdir(), "hooks-no-gate-"));
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

describe("no transport gating (storage-mode axis retired)", () => {
  test("a bare environment runs `hooks list` on the local store — no refusal", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    const result = await runCli(["list", "--limit", "2"], cleanEnv(sb));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(REFUSING);
    expect(result.stdout).toContain("Available hooks");
    expect(result.stdout).toContain("gitguard");
  });

  test("a bare environment runs `hooks log tail` against the local SQLite store", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    const result = await runCli(["log", "tail"], cleanEnv(sb));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(REFUSING);
    // The local store was created — the baseline transport, not a refused one.
    expect(existsSync(join(sb.dataDir, "hooks.db"))).toBe(true);
  });

  test("a bare environment runs `hooks sync` against the bundled registry", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    const result = await runCli(["sync", "--json"], cleanEnv(sb));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(REFUSING);
    const plan = JSON.parse(result.stdout);
    expect(plan.api_url).toBeNull();
    expect(plan.diff.added.length).toBeGreaterThan(20);
  });

  test("a bare environment runs `hooks storage status` (local surfaces are never gated)", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    const result = await runCli(["storage", "status", "--json"], cleanEnv(sb));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(REFUSING);
    const status = JSON.parse(result.stdout);
    expect(status.backend).toBe("sqlite");
  });

  test("a bare environment resolves a pinned install from the bundled registry", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    const result = await runCli(["install", "gitguard@0.1.0", "--json"], cleanEnv(sb));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(REFUSING);
    // install --json streams one line per hook and finishes with the summary.
    const payload = JSON.parse(result.stdout.trim().split("\n").pop()!);
    expect(payload.installed).toContain("gitguard");
  });

  test("HASNA_HOOKS_LOCAL=1 remains an accepted explicit local selection", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    const env = cleanEnv(sb);
    env.HASNA_HOOKS_LOCAL = "1";
    const list = await runCli(["list", "--limit", "1"], env);
    expect(list.timedOut).toBe(false);
    expect(list.exitCode).toBe(0);
    expect(list.stderr).not.toContain(REFUSING);
    // The local store is the on-box surface for log reads too.
    const tail = await runCli(["log", "tail"], env);
    expect(tail.timedOut).toBe(false);
    expect(tail.exitCode).toBe(0);
    expect(existsSync(join(sb.dataDir, "hooks.db"))).toBe(true);
  });

  test("a STRICT env pair (URL + key) runs against the hosted authority", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    const env = cleanEnv(sb);
    env.HASNA_HOOKS_API_URL = "https://api.hasna.com/hooks";
    env.HASNA_HOOKS_API_KEY = "gate-test-key";
    const result = await runCli(["list", "--limit", "1"], env);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(REFUSING);
  });

  test("a URL-only environment is a strict-pair refusal at the registry command — declared intent never falls through", async () => {
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
  });

  test("an unknown token routes to the interactive default — refused only for the missing TTY, never for the transport", async () => {
    // `interactive` is the default command, so commander routes any token that
    // matches no command to it. No transport gate exists to refuse the run:
    // the Ink TUI itself requires a TTY (raw-mode input), and this harness
    // stdin is not one, so the CLI refuses cleanly with the TTY message and
    // the non-interactive alternatives — exit 1 naming the TTY, never the
    // store, and never an Ink raw-mode stack on stdout.
    const sb = makeSandbox();
    sandboxes.push(sb);
    const result = await runCli(["frobnicate"], cleanEnv(sb), 8000);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain(REFUSING);
    expect(result.stderr).toContain("requires a TTY terminal");
    expect(result.stderr).toContain("hooks search <query>");
    expect(result.stdout).not.toContain("Raw mode");
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
  });

  test("the retired config.json api_url does not resurrect remote routing — list still runs locally", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    // config.json (api_url / api_key_ref) was the app's own key store; it is
    // retired (hasna/apps#1720) — the resolver never reads it, so a leftover
    // file must not resurrect remote routing. The command still runs on the
    // local store: no transport gate.
    mkdirSync(sb.dataDir, { recursive: true });
    writeFileSync(
      join(sb.dataDir, "config.json"),
      JSON.stringify({ api_url: "https://api.hasna.com/hooks" }, null, 2) + "\n",
    );
    const env = cleanEnv(sb);
    const result = await runCli(["list", "--limit", "1"], env);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(REFUSING);
    expect(result.stdout).toContain("gitguard");
  });

  test("a config.json without api_url does not affect anything", async () => {
    const sb = makeSandbox();
    sandboxes.push(sb);
    mkdirSync(sb.dataDir, { recursive: true });
    writeFileSync(join(sb.dataDir, "config.json"), "{}\n");
    const result = await runCli(["list", "--limit", "1"], cleanEnv(sb));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("gitguard");
  });
});
