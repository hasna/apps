import { afterAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Regression coverage for the `--json` error contract: every error branch must
// emit a parseable JSON error object on stdout (not plain text), so consumers
// that JSON-parse command output do not crash on failure.
const TEST_DB = join(tmpdir(), `conversations-json-error-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runCli(args: string[], agent = "tester") {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONVERSATIONS_DB_PATH: TEST_DB,
      CONVERSATIONS_AGENT_ID: agent,
      FORCE_COLOR: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function expectJsonError(args: string[]) {
  const res = runCli(args);
  expect(res.exitCode).toBe(1);
  // stdout must be valid JSON with an `error` string — this is the contract.
  let parsed: any;
  expect(() => {
    parsed = JSON.parse(res.stdout.trim());
  }).not.toThrow();
  expect(typeof parsed.error).toBe("string");
  expect(parsed.error.length).toBeGreaterThan(0);
  return { res, parsed };
}

describe("--json error contract", () => {
  afterAll(() => {
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(`${TEST_DB}-wal`); } catch {}
    try { unlinkSync(`${TEST_DB}-shm`); } catch {}
  });

  test("show <missing> --json emits a JSON error object", () => {
    const { parsed } = expectJsonError(["show", "999999999", "--json"]);
    expect(parsed.error).toContain("not found");
  });

  test("send with no recipient --json emits a JSON error object", () => {
    const { parsed } = expectJsonError(["send", "hello", "--json"]);
    expect(parsed.error).toContain("Recipient");
  });

  test("summary <missing> --json emits a JSON error object", () => {
    const { parsed } = expectJsonError(["summary", "nonexistent-channel-xyz", "--json"]);
    expect(parsed.error).toContain("No messages found");
  });

  test("project get <missing> --json emits a JSON error object", () => {
    const { parsed } = expectJsonError(["project", "get", "nonexistent-proj-xyz", "--json"]);
    expect(parsed.error).toContain("not found");
  });

  test("receipts <missing> --json emits a JSON error object", () => {
    const { parsed } = expectJsonError(["receipts", "999999999", "--json"]);
    expect(parsed.error).toContain("not found");
  });

  test("without --json the same error stays human-readable on stderr", () => {
    const res = runCli(["show", "999999999"]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("not found");
    expect(res.stdout.trim()).toBe("");
  });
});
