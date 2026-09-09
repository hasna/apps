import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hasTmuxExecutable } from "./tmux-availability.js";

/**
 * The gate decides whether the real-tmux suites run at all; a broken installed
 * tmux must fail rather than make a suite appear green. These tests drive the gate in a subprocess with
 * a fake `tmux` on PATH — the child's PATH is what resolves the binary.
 */

const GATE = join(import.meta.dir, "tmux-availability.ts");
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "dispatch_tmux_gate_"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A fake `tmux` that answers `-V` but exits `newSessionStatus` for `new-session`. */
function stubTmux(name: string, newSessionStatus: number): { dir: string; callLog: string } {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const callLog = join(dir, "calls.log");
  writeFileSync(
    join(dir, "tmux"),
    [
      "#!/bin/sh",
      `echo "$@" >> ${JSON.stringify(callLog)}`,
      'case "$1" in',
      "  -V) echo 'tmux 3.4'; exit 0 ;;",
      `  new-session) echo 'no server running on /tmp/tmux-0/default' >&2; exit ${newSessionStatus} ;;`,
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(join(dir, "tmux"), 0o755);
  return { dir, callLog };
}

/** Evaluate the gate in a child process whose PATH (and opt-out) we control. */
function runGate(opts: { path: string; skip?: string; executableOnly?: boolean }): string {
  const src = [
    `const gate = await import(${JSON.stringify(GATE)});`,
    `try { console.log("RESULT:" + gate.${opts.executableOnly ? "hasTmuxExecutable(process.env)" : "canRunTmuxIntegration()"}); }`,
    `catch (err) { console.log("THREW:" + (err instanceof Error ? err.message : String(err))); }`,
  ].join("\n");
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.PATH = opts.path;
  if (opts.skip === undefined) delete env.DISPATCH_SKIP_TMUX_INTEGRATION;
  else env.DISPATCH_SKIP_TMUX_INTEGRATION = opts.skip;
  const res = spawnSync(process.execPath, ["-e", src], { encoding: "utf8", env, timeout: 30_000 });
  return `${res.stdout ?? ""}${res.stderr ?? ""}`;
}

describe("canRunTmuxIntegration", () => {
  test("throws when tmux is installed but cannot start a session", () => {
    const broken = stubTmux("broken", 1);
    const out = runGate({ path: broken.dir });
    expect(out).toContain("THREW:");
    expect(out).toContain("tmux is installed but cannot start a session");
    expect(out).toContain("DISPATCH_SKIP_TMUX_INTEGRATION=1");
    expect(out).not.toContain("RESULT:");
  });

  test("opts out without probing when DISPATCH_SKIP_TMUX_INTEGRATION=1", () => {
    const broken = stubTmux("opted-out", 1);
    const out = runGate({ path: broken.dir, skip: "1" });
    expect(out).toContain("RESULT:false");
    expect(existsSync(broken.callLog)).toBe(false); // tmux was never invoked
  });

  test("skips quietly when tmux is not installed", () => {
    const empty = join(root, "no-tmux");
    mkdirSync(empty, { recursive: true });
    expect(runGate({ path: empty })).toContain("RESULT:false");
  });

  test("runs when tmux can start a session", () => {
    const healthy = stubTmux("healthy", 0);
    expect(runGate({ path: healthy.dir })).toContain("RESULT:true");
  });

  test("the executable check never creates and tears down a disposable last session", () => {
    const healthy = stubTmux("executable-only", 0);
    expect(runGate({ path: healthy.dir, executableOnly: true })).toContain("RESULT:true");
    expect(readFileSync(healthy.callLog, "utf8")).toBe("-V\n");
  });

  test("the CLI suite fails, rather than skips, when its real session cannot start", () => {
    const broken = stubTmux("broken-cli", 1);
    // The CLI suite deliberately passes -f /dev/null before new-session.
    const executable = join(broken.dir, "tmux");
    writeFileSync(executable, readFileSync(executable, "utf8").replace(
      'case "$1" in', 'if [ "$1" = "-f" ]; then shift 2; fi\ncase "$1" in',
    ));
    const env = { ...process.env, PATH: broken.dir, DISPATCH_SKIP_TMUX_INTEGRATION: undefined };
    const result = spawnSync(process.execPath, ["test", join(import.meta.dir, "../cli/cli.integration.test.ts"),
      "-t", "send to a nonexistent target"], { encoding: "utf8", env, timeout: 10000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("failed to start fake agent");
    expect(result.stderr).toContain("1 fail");
    expect(result.stderr).not.toContain("1 skip");
  });

  (hasTmuxExecutable() ? test : test.skip)("a partially successful real CLI setup stops its private server before deleting its directory", () => {
    const dir = join(root, "partial-cli");
    mkdirSync(dir);
    const receipt = join(dir, "server.txt");
    const actualTmux = Bun.which("tmux");
    expect(actualTmux).not.toBeNull();
    const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    writeFileSync(join(dir, "tmux"), [
      "#!/bin/sh",
      // Only inject failure after the real server successfully started.
      'if [ "$1" = "-f" ] && [ "$3" = "new-session" ]; then',
      `  ${quote(actualTmux!)} "$@" || exit $?`,
      `  ${quote(actualTmux!)} display-message -p '#{pid}\t#{socket_path}' > ${quote(receipt)} || exit $?`,
      "  echo 'fictional failure after successful server creation' >&2; exit 1",
      "fi",
      `exec ${quote(actualTmux!)} "$@"`,
      "",
    ].join("\n"), { mode: 0o700 });
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, DISPATCH_SKIP_TMUX_INTEGRATION: undefined };
    const result = spawnSync(process.execPath, ["test", join(import.meta.dir, "../cli/cli.integration.test.ts"),
      "-t", "send to a nonexistent target"], { encoding: "utf8", env, timeout: 10000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("fictional failure after successful server creation");
    const [pid, socket] = readFileSync(receipt, "utf8").trim().split("\t");
    expect(Number.isSafeInteger(Number(pid)) && Number(pid) > 1).toBe(true);
    expect(socket?.startsWith(tmpdir() + "/")).toBe(true);
    expect(() => process.kill(Number(pid), 0)).toThrow("ESRCH");
    expect(existsSync(dirname(dirname(socket!)))).toBe(false);
  }, 15000);
});
