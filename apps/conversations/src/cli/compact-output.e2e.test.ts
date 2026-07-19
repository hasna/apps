import { afterAll, describe, expect, test } from "bun:test";
import { createDisposableStore, hermeticSpawnEnv } from "../test/hermetic";

const TEST_STORE = createDisposableStore("cli-compact");
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runCli(args: string[], agent: string) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: hermeticSpawnEnv({
      CONVERSATIONS_DB_PATH: TEST_STORE.dbPath,
      CONVERSATIONS_AGENT_ID: agent,
      FORCE_COLOR: "0",
    }),
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
    TEST_STORE.cleanup();
  });

  test("read and verbose stay preview-only while exact show keeps full content", () => {
    const content = `Compact output starts here ${"x ".repeat(140)}TAIL_ONLY_IN_VERBOSE`;
    const send = runCli(["send", content, "--to", "bob", "--json"], "alice");
    expect(send.exitCode).toBe(0);
    const sent = JSON.parse(send.stdout);

    const compact = runCli(["read", "--to", "bob", "--limit", "1"], "bob");
    expect(compact.exitCode).toBe(0);
    expect(compact.stdout).toContain("Compact output starts here");
    expect(compact.stdout).not.toContain("TAIL_ONLY_IN_VERBOSE");
    expect(compact.stdout).toContain("conversations show <id>");

    const verbose = runCli(["read", "--to", "bob", "--limit", "1", "--verbose"], "bob");
    expect(verbose.exitCode).toBe(0);
    expect(verbose.stdout).not.toContain("TAIL_ONLY_IN_VERBOSE");
    expect(verbose.stdout).toContain("conversations show <id>");

    const json = runCli(["read", "--to", "bob", "--limit", "1", "--json"], "bob");
    expect(json.exitCode).toBe(0);
    const page = JSON.parse(json.stdout);
    expect(page.messages[0].content).toBeUndefined();
    expect(page.messages[0].preview).not.toContain("TAIL_ONLY_IN_VERBOSE");

    const exact = runCli(["show", String(sent.id), "--json"], "bob");
    expect(exact.exitCode).toBe(0);
    expect(JSON.parse(exact.stdout).content).toContain("TAIL_ONLY_IN_VERBOSE");
  });

  test("mark-read marks only the displayed compact page", () => {
    runCli(["send", "first page message", "--to", "mark-target"], "alice");
    runCli(["send", "second page message", "--to", "mark-target"], "alice");

    const marked = runCli(["read", "--to", "mark-target", "--limit", "1", "--mark-read"], "mark-target");
    expect(marked.exitCode).toBe(0);

    const unread = runCli(["read", "--to", "mark-target", "--unread", "--json"], "mark-target");
    expect(unread.exitCode).toBe(0);
    const page = JSON.parse(unread.stdout);
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].content).toBeUndefined();
    expect(page.messages[0].preview).toBe("second page message");
  });
});
