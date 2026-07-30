import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Proof at the process boundary for the two halves of the redactor defect.
 *
 * The unit tests in `src/lib/content-safety.span-redaction.test.ts` prove the
 * redactor's semantics. They cannot prove the thing that actually hurt: that an
 * author running `conversations send` is TOLD when the body was rewritten. That
 * only shows up in the exit code and stderr of a real process, so it is measured
 * here against the real CLI.
 *
 * The failure being closed: rc=0, a real message id, and a body replaced
 * wholesale by a tag. All three known losses were found by a different agent
 * reading the channel, never by the author.
 */

const CLI = ["bun", "run", "src/cli/index.tsx"];
const REDACTION_EXIT_CODE = 2;

let TMP_DIR: string;
let TEST_DB: string;

function syntheticDatabaseUrl(): string {
  return ["postgres", "://", "e2e_user:synthetic-password", "@db.example.invalid:5432/app"].join("");
}

/** The #609657 fixture: the sanctioned credential presence test. */
const PRESENCE_REPORT = [
  "Correcting my earlier post: the host is only half repaired.",
  "HASNA_TODOS_API_KEY=set",
  "HASNA_CONVERSATIONS_API_KEY=set",
  "HASNA_EMAILS_API_KEY=unset",
  "Reopening the incident.",
].join("\n");

function runCli(args: string[], agent = "e2e-sender") {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONVERSATIONS_DB_PATH: TEST_DB,
      CONVERSATIONS_AGENT_ID: agent,
      CONVERSATIONS_STORAGE_MODE: "local",
      HASNA_CONVERSATIONS_STORAGE_MODE: "local",
      FORCE_COLOR: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

beforeAll(() => {
  TMP_DIR = mkdtempSync(join(tmpdir(), "conversations-redaction-e2e-"));
  TEST_DB = join(TMP_DIR, "redaction.db");
});

afterAll(() => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

describe("sender notification at the process boundary", () => {
  test("the notice CAN fire: stderr warning and a distinct exit code", () => {
    // A check that cannot fail is not evidence. Drive the notifier directly
    // with a whole-message replacement and confirm the process actually
    // reports it, rather than trusting that the call site exists.
    const script = [
      `import { warnIfRedacted } from "${join(process.cwd(), "src/cli/redaction-notice.ts")}";`,
      `warnIfRedacted("the original body of an incident correction", "[REDACTED:DATABASE_URL]");`,
      `process.exit(process.exitCode ?? 0);`,
    ].join("\n");

    const result = Bun.spawnSync({
      cmd: ["bun", "-e", script],
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.stderr.toString()).toContain("WARNING");
    expect(result.stderr.toString()).toContain("ENTIRE body was replaced");
    expect(result.exitCode).toBe(REDACTION_EXIT_CODE);
  });

  test("the notice stays SILENT on clean content, so it is not noise", () => {
    const script = [
      `import { warnIfRedacted } from "${join(process.cwd(), "src/cli/redaction-notice.ts")}";`,
      `warnIfRedacted("an ordinary message", "an ordinary message");`,
      `process.exit(process.exitCode ?? 0);`,
    ].join("\n");

    const result = Bun.spawnSync({
      cmd: ["bun", "-e", script],
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.stderr.toString()).not.toContain("WARNING");
    expect(result.exitCode).toBe(0);
  });
});

describe("end-to-end through the real CLI", () => {
  test("#609657: the presence report sends and reads back intact", () => {
    const sent = runCli(["send", PRESENCE_REPORT, "--to", "e2e-reader", "--from", "e2e-sender"]);

    expect(sent.code).toBe(0);
    expect(sent.stderr).not.toContain("WARNING");

    const read = runCli(["read", "--to", "e2e-reader", "--verbose", "-j"], "e2e-reader");
    expect(read.code).toBe(0);

    // Every line survives — including the correction that was destroyed.
    expect(read.stdout).toContain("Reopening the incident");
    expect(read.stdout).toContain("HASNA_EMAILS_API_KEY=unset");
    expect(read.stdout).not.toContain("[REDACTED");
  });

  test("positive control: a real credential is still refused and never stored", () => {
    const secret = syntheticDatabaseUrl();
    const sent = runCli(["send", `the dsn is ${secret} please rotate`, "--to", "e2e-reader", "--from", "e2e-sender"]);

    // Loud refusal, not a silent rewrite.
    expect(sent.code).not.toBe(0);
    expect(`${sent.stdout}${sent.stderr}`).toContain("sensitive content");

    // And it must not have landed anywhere readable.
    const read = runCli(["read", "--to", "e2e-reader", "--verbose", "-j"], "e2e-reader");
    expect(read.stdout).not.toContain("synthetic-password");
    expect(read.stdout).not.toContain(secret);
  });
});
