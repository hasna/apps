// LIST-FILTER VALUES THE CLI USED TO SWALLOW.
//
// Two silent-wrong-answer shapes, both CLI-layer (tasks a126c676, 6d5ebed5):
//
//  * `inbox list --folder starrred` (any unknown folder) silently listed the
//    INBOX: `normalizeCliMailbox` mapped every unrecognised value to "inbox",
//    so a typo answered with the wrong folder's mail and exit 0.
//  * `scheduled list --status bogus` (and its `schedule list` twin) returned
//    `[]` with exit 0: the status was a blind type-cast, so a typo like
//    `--status canceled` read as "nothing is cancelled" — while the sibling
//    `email list --status bogus` on the same store correctly refuses.
//
// Both now refuse, naming the value and the valid set.
//
// WHY A SUBPROCESS. `handleError` (src/cli/utils.ts) ends in `process.exit(1)`;
// same harness as email-log-provider-filter.test.ts: temp HOME, authenticated API,
// environment scrubbed BY PREFIX (an operator shell may export this package's whole
// client configuration, and enumerating those keys here would add references
// the mode-axis ratchet counts).

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPrepublishTestEnv } from "../../../scripts/prepublish-local-test.mjs";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
let api: V1Stub;
const tempDirs: string[] = [];
beforeAll(async () => { api = await startV1Stub({ openapi: true, apiKey: crypto.randomUUID() }); });
afterEach(() => {
  for (const dir of tempDirs) expect(readdirSync(dir, { recursive: true }).filter(name => /\.(?:db|sqlite)(?:-|$)/.test(String(name)))).toEqual([]);
});
function apiEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "emails-list-filter-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "tmp"), { mode: 0o700 });
  return { ...buildPrepublishTestEnv(process.env, dir), HASNA_STATION: `emails-filter-${crypto.randomUUID()}`, HASNA_EMAILS_API_URL: api.baseUrl, HASNA_EMAILS_API_KEY: api.apiKey, EMAILS_CLIENT_ENV_LOADED: "1", NO_COLOR: "1" };
}

interface CliRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: NodeJS.ProcessEnv): CliRun {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "src/cli/index.tsx", ...args],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

afterAll(() => {
  api.stop();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("inbox --folder validates its value", () => {
  // STRONG: the refusal, with the valid set named so the operator can fix the
  // typo instead of re-running blind.
  it("refuses `inbox list --folder starrred` instead of listing the inbox", () => {
    const env = apiEnv();
    const run = runCli(["--json", "inbox", "list", "--folder", "starrred", "--limit", "3"], env);

    expect(run.exitCode, `expected a refusal, got: ${run.stdout}`).not.toBe(0);
    const failure = JSON.parse(run.stderr) as { error: { message: string } };
    expect(failure.error.message).toContain("starrred");
    for (const folder of ["inbox", "unread", "starred", "sent", "archived", "spam", "trash"]) {
      expect(failure.error.message).toContain(folder);
    }
  }, 120_000);

  it("refuses `inbox search --folder bogus` the same way", () => {
    const env = apiEnv();
    const run = runCli(["--json", "inbox", "search", "anything", "--folder", "bogus"], env);

    expect(run.exitCode, `expected a refusal, got: ${run.stdout}`).not.toBe(0);
    const failure = JSON.parse(run.stderr) as { error: { message: string } };
    expect(failure.error.message).toContain("bogus");
    expect(failure.error.message).toContain("starred");
  }, 120_000);

  // The complement: every valid folder still answers. An unconditional refusal
  // would also make the two cases above pass.
  it("still lists every valid folder on an empty store", () => {
    const env = apiEnv();
    for (const folder of ["inbox", "unread", "starred", "sent", "archived", "spam", "trash"]) {
      const run = runCli(["--json", "inbox", "list", "--folder", folder, "--limit", "1"], env);
      expect(run.exitCode, `--folder ${folder} failed: ${run.stderr}`).toBe(0);
    }
  }, 120_000);
});

describe("scheduled --status validates against the enum", () => {
  for (const command of [["scheduled", "list"], ["schedule", "list"]] as const) {
    it(`refuses \`${command.join(" ")} --status bogus\` instead of answering []`, () => {
      const env = apiEnv();
      const run = runCli(["--json", ...command, "--status", "bogus"], env);

      expect(run.exitCode, `expected a refusal, got: ${run.stdout}`).not.toBe(0);
      const failure = JSON.parse(run.stderr) as { error: { message: string } };
      expect(failure.error.message).toContain("bogus");
      for (const status of ["pending", "sent", "cancelled", "failed"]) {
        expect(failure.error.message).toContain(status);
      }
      // The refusal must not be dressed as a plausible empty answer.
      expect(run.stdout.trim()).not.toBe("[]");
    }, 120_000);
  }

  it("still answers a valid --status filter", () => {
    const env = apiEnv();
    const run = runCli(["--json", "scheduled", "list", "--status", "pending"], env);
    expect(run.exitCode, `valid status refused: ${run.stderr}`).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([]);
  }, 120_000);
});
