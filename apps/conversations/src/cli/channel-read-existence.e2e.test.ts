import { afterAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-channel-read-existence-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runCli(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONVERSATIONS_DB_PATH: TEST_DB,
      CONVERSATIONS_AGENT_ID: "tester",
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

describe("channel read existence (e2e)", () => {
  afterAll(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(`${TEST_DB}${suffix}`); } catch {}
    }
  });

  test("a missing channel fails with a distinct not-found error", () => {
    const result = runCli(["channel", "read", "definitely-missing", "--limit", "1"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Channel #definitely-missing not found.");
    expect(result.stderr).not.toContain("No messages");
  });

  test("an existing empty channel still succeeds with the empty-channel message", () => {
    const created = runCli(["channel", "create", "empty-channel", "--from", "tester"]);
    expect(created.exitCode).toBe(0);

    const result = runCli(["channel", "read", "empty-channel", "--limit", "1"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("No messages in #empty-channel.");
  });

  test("a missing channel preserves the JSON error contract", () => {
    const result = runCli(["channel", "read", "missing-json", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ error: "Channel #missing-json not found." });
  });
});
