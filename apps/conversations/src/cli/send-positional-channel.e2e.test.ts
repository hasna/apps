import { afterAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Regression for todos 4a2a4ac1 (P-00946): the fleet's documented form
// `conversations send <channel> "<message>" --from X` (charter working
// agreement, ~/.claude/rules/communication.md, dispatch briefs) exits rc=1
// with "Recipient is required" because the CLI declared only `<message>` as a
// positional: the channel token binds to <message>, the real body is dropped
// as an excess argument, and no recipient is ever set.
//
// The fix must accept the documented positional form while leaving the two
// established flag forms (`--channel X "<message>"` and `--to A "<message>"`)
// unchanged.

const TEST_DB = join(tmpdir(), `conversations-cli-send-positional-${Date.now()}.db`);
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

describe("send positional channel form (documented in charter and .claude/rules)", () => {
  afterAll(() => {
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(`${TEST_DB}-wal`); } catch {}
    try { unlinkSync(`${TEST_DB}-shm`); } catch {}
  });

  function seedChannel(channel: string): void {
    const created = runCli(["channel", "create", channel, "--from", "alice"], "alice");
    expect(created.exitCode, created.stderr).toBe(0);
    const joined = runCli(["channel", "join", channel, "--from", "bob"], "bob");
    expect(joined.exitCode, joined.stderr).toBe(0);
  }

  test("`send <channel> \"<message>\" --from X` sends to the channel with the real body", () => {
    const channel = "pos-channel-documented";
    seedChannel(channel);

    const sent = runCli(
      ["send", channel, "positional form body", "--from", "alice", "--json"],
      "alice",
    );
    expect(sent.exitCode, sent.stderr).toBe(0);
    const message = JSON.parse(sent.stdout) as { id: number; content: string; channel: string };
    expect(message.channel).toBe(channel);
    // The real body must be the SECOND positional. The pre-fix parse bound
    // the channel token to <message> and silently dropped the actual body.
    expect(message.content).toBe("positional form body");
    expect(message.content).not.toBe(channel);

    const shown = runCli(["show", String(message.id), "--json"], "bob");
    expect(shown.exitCode, shown.stderr).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      id: message.id,
      channel,
      content: "positional form body",
    });
  });

  test("flag form `send \"<message>\" --channel X --from A` is unchanged", () => {
    const channel = "pos-channel-flag";
    seedChannel(channel);

    const sent = runCli(
      ["send", "flag form body", "--channel", channel, "--from", "alice", "--json"],
      "alice",
    );
    expect(sent.exitCode, sent.stderr).toBe(0);
    const message = JSON.parse(sent.stdout) as { id: number; content: string; channel: string };
    expect(message.channel).toBe(channel);
    expect(message.content).toBe("flag form body");
  });

  test("agent-addressed DM flag form `send \"<message>\" --to <agent>` is refused", () => {
    // Agent-addressed DMs were removed from conversations (staged behind the
    // messages-app v1 release gate); the --to agent-addressing flag is gone.
    const sent = runCli(
      ["send", "direct message body", "--to", "bob", "--from", "alice", "--json"],
      "alice",
    );
    expect(sent.exitCode).not.toBe(0);
    expect(sent.stderr).toContain("unknown option");
  });
});
