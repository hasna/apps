import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Machine-readable surface sweep (hasna/apps#1602): every telephony data
 * command prints JSON already, so `--json` must be accepted rather than
 * rejected by commander's unknown-option handling. The failing probe on
 * station03 was `telephony number list --json` → "error: unknown option
 * '--json'"; the acceptance bullet is that every list/read command accepts
 * `--json`.
 *
 * These spawn the real CLI entrypoint under a scratch HOME with a scrubbed
 * env (no fleet TELEPHONY variables, no data-home overrides), so a probe can
 * never reach the network or touch the operator's real home. For commands
 * behind the store the no-env run fails closed by design — the assertion here
 * is that commander accepted the flag (no "unknown option" diagnostic), not
 * the command's downstream outcome.
 */

const APP_ROOT = new URL("../../", import.meta.url).pathname; // apps/telephony/
const CLI_ENTRY = new URL("./index.ts", import.meta.url).pathname; // src/cli/index.ts

/** Strip every variable this suite must not inherit (fleet env, data-home overrides). */
function scrubEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (name.includes("TELEPHONY")) continue; // HASNA_TELEPHONY_* and TELEPHONY_*
    if (/^HASNA_(DATA|STATE|CONFIG|CACHE)_HOME$/.test(name)) continue;
    env[name] = value;
  }
  return env;
}

type ProbeResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

async function runEntry(
  entry: string,
  args: string[],
  home: string,
  extra: Record<string, string> = {},
): Promise<ProbeResult> {
  const proc = Bun.spawn([process.execPath, "run", entry, ...args], {
    cwd: APP_ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...scrubEnv(), HOME: home, ...extra },
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(true);
      }, 20_000);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, code: proc.exitCode ?? -1, timedOut };
}

function scratchHome(): string {
  return mkdtempSync(join(tmpdir(), "telephony-jsonsurface-"));
}

/**
 * Every data command whose output is JSON, with the arguments needed to get
 * past parse. Downstream behaviour (fail-closed store gate, provider error,
 * missing file) varies per command and is not what this probe asserts.
 */
const JSON_DATA_COMMANDS: string[][] = [
  // sms
  ["sms", "list"],
  ["sms", "search", "needle"],
  ["sms", "send", "--to", "+1000", "--body", "probe"],
  // whatsapp
  ["whatsapp", "list"],
  ["whatsapp", "send", "--to", "+1000", "--body", "probe"],
  ["whatsapp", "send-audio", "--to", "+1000", "--media-url", "https://example.test/a.mp3"],
  // calls
  ["call", "list"],
  ["call", "make", "--to", "+1000"],
  // voicemail
  ["voicemail", "list"],
  // numbers
  ["number", "search-available"],
  ["number", "list"],
  ["number", "provision", "+1000"],
  ["number", "twilio-list"],
  // agents
  ["agent", "list"],
  ["agent", "get", "probe"],
  ["agent", "register", "--name", "probe"],
  ["agent", "heartbeat", "probe"],
  // projects
  ["project", "list"],
  ["project", "get", "probe"],
  ["project", "create", "--name", "probe", "--path", "/tmp/probe"],
  // schedules
  ["schedule", "list"],
  ["schedule", "create", "--name", "probe", "--cron", "* * * * *", "--action", "sms", "--command", "probe"],
  ["schedule", "run"],
  // speech
  ["stt", "--file", "/nonexistent/probe.wav"],
  // contacts
  ["contact", "list"],
  ["contact", "search", "probe"],
  ["contact", "add", "--name", "probe", "--phone", "+1000"],
  // webhooks
  ["webhook", "list"],
  ["webhook", "create", "--url", "https://example.test/hook"],
  // reads
  ["conversation", "+1000"],
  // diagnostics
  ["config"],
];

describe("telephony data commands accept --json (#1602)", () => {
  // The sweep spawns two fresh `bun run <entry>` subprocesses per command
  // (29 command shapes), and CI spawns them cold under parallel-file load —
  // well beyond bun:test's 5s default budget. The 5s timeout fired mid-loop
  // on the CI runner (dangling-process kill), so the sweep gets an explicit
  // budget sized for 58 cold CLI spawns.
  test("--json never trips commander's unknown-option rejection", async () => {
    const home = scratchHome();
    try {
      for (const args of JSON_DATA_COMMANDS) {
        const plain = await runEntry(CLI_ENTRY, args, home);
        const withJson = await runEntry(CLI_ENTRY, [...args, "--json"], home);
        expect(withJson.timedOut, `${args.join(" ")} --json hung`).toBe(false);
        // Parse acceptance: the only failure the flag may not produce is the
        // commander unknown-option diagnostic the sweep observed on station03.
        const combined = withJson.stdout + withJson.stderr;
        expect(combined, `${args.join(" ")} --json rejected`).not.toContain("unknown option");
        // The flag must be a true no-op on the command's own outcome: same
        // exit code and identical stderr as the run without it.
        expect(withJson.code, `${args.join(" ")} --json changed the exit code`).toBe(plain.code);
        expect(withJson.stderr, `${args.join(" ")} --json changed stderr`).toBe(plain.stderr);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 120_000);

  test("number list --json runs end-to-end under the local opt-in and prints JSON", async () => {
    const home = scratchHome();
    try {
      const result = await runEntry(CLI_ENTRY, ["number", "list", "--json"], home, {
        HASNA_TELEPHONY_LOCAL: "1",
      });
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
      expect(existsSync(join(home, ".hasna", "telephony", "telephony.db"))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
