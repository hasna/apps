import { afterAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-cli-compact-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runCli(args: string[], agent: string) {
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

describe("compact CLI output", () => {
  afterAll(() => {
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(`${TEST_DB}-wal`); } catch {}
    try { unlinkSync(`${TEST_DB}-shm`); } catch {}
  });

  test("read is compact by default but verbose and json keep full content", () => {
    const content = `Compact output starts here ${"x ".repeat(140)}TAIL_ONLY_IN_VERBOSE`;
    const send = runCli(["send", content, "--to", "bob"], "alice");
    expect(send.exitCode).toBe(0);

    const compact = runCli(["read", "--to", "bob", "--limit", "1"], "bob");
    expect(compact.exitCode).toBe(0);
    expect(compact.stdout).toContain("Compact output starts here");
    expect(compact.stdout).not.toContain("TAIL_ONLY_IN_VERBOSE");
    expect(compact.stdout).toContain("Use --verbose");
    expect(compact.stdout).toContain("conversations show <id>");

    const verbose = runCli(["read", "--to", "bob", "--limit", "1", "--verbose"], "bob");
    expect(verbose.exitCode).toBe(0);
    expect(verbose.stdout).toContain("TAIL_ONLY_IN_VERBOSE");

    const json = runCli(["read", "--to", "bob", "--limit", "1", "--json"], "bob");
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)[0].content).toContain("TAIL_ONLY_IN_VERBOSE");
  });

  test("mark-read marks only the displayed compact page", () => {
    runCli(["send", "first page message", "--to", "mark-target"], "alice");
    runCli(["send", "second page message", "--to", "mark-target"], "alice");

    const marked = runCli(["read", "--to", "mark-target", "--limit", "1", "--mark-read"], "mark-target");
    expect(marked.exitCode).toBe(0);

    const unread = runCli(["read", "--to", "mark-target", "--unread", "--json"], "mark-target");
    expect(unread.exitCode).toBe(0);
    const messages = JSON.parse(unread.stdout);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("second page message");
  });
});
