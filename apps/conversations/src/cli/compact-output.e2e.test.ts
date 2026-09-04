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

function syntheticDatabaseUrl(): string {
  return ["postgres", "://", "cli_user:synthetic-password", "@db.example.invalid/app"].join("");
}

describe("compact CLI output", () => {
function seedChannel(channel: string, reader: string): void {
  expect(runCli(["channel", "create", channel], "alice").exitCode).toBe(0);
  expect(runCli(["channel", "join", channel], reader).exitCode).toBe(0);
}


  afterAll(() => {
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(`${TEST_DB}-wal`); } catch {}
    try { unlinkSync(`${TEST_DB}-shm`); } catch {}
  });

  test("collection reads stay bounded and exact show keeps full content", () => {
    // Recipient-addressed DMs were removed (staged behind the messages-app v1
    // release gate); the seed lives in a channel the reader joins.
    const channel = "compact-channel";
    expect(runCli(["channel", "create", channel], "alice").exitCode).toBe(0);
    expect(runCli(["channel", "join", channel], "bob").exitCode).toBe(0);

    const content = `Compact output starts here ${"x ".repeat(140)}TAIL_ONLY_IN_VERBOSE`;
    const send = runCli(["send", content, "--channel", channel], "alice");
    expect(send.exitCode, send.stderr).toBe(0);

    const compact = runCli(["read", "--channel", channel, "--limit", "1"], "bob");
    expect(compact.exitCode).toBe(0);
    expect(compact.stdout).toContain("Compact output starts here");
    expect(compact.stdout).not.toContain("TAIL_ONLY_IN_VERBOSE");
    expect(compact.stdout).toContain("Use --verbose");
    expect(compact.stdout).toContain("conversations show <id>");

    const verbose = runCli(["read", "--channel", channel, "--limit", "1", "--verbose"], "bob");
    expect(verbose.exitCode).toBe(0);
    expect(verbose.stdout).not.toContain("TAIL_ONLY_IN_VERBOSE");

    const json = runCli(["read", "--channel", channel, "--limit", "1", "--json"], "bob");
    expect(json.exitCode).toBe(0);
    const preview = JSON.parse(json.stdout).messages[0] as { id: number; preview: string };
    expect(preview.preview).not.toContain("TAIL_ONLY_IN_VERBOSE");
    expect(preview).not.toHaveProperty("content");
    const exact = runCli(["show", String(preview.id), "--json"], "bob");
    expect(exact.exitCode).toBe(0);
    expect(JSON.parse(exact.stdout).content).toContain("TAIL_ONLY_IN_VERBOSE");
  }, 15_000);

  // `--limit 1` is a recency window, so the displayed page is the NEWEST message
  // and that is the one marked. This test previously asserted the opposite —
  // that the OLDEST was displayed and marked — which pinned the ordering defect
  // in todos 2c25973b rather than the intended contract. The contract the name
  // states, "only the displayed page is marked", is unchanged and still checked.
  test("mark-read marks only the displayed compact page", () => {
    seedChannel("mark-channel", "mark-target");
    runCli(["channel", "send", "mark-channel", "older page message"], "alice");
    runCli(["channel", "send", "mark-channel", "newer page message"], "alice");

    const marked = runCli(["read", "--channel", "mark-channel", "--limit", "1", "--mark-read"], "mark-target");
    expect(marked.exitCode).toBe(0);
    expect(marked.stdout).toContain("newer page message");
    expect(marked.stdout).not.toContain("older page message");

    const unread = runCli(["read", "--channel", "mark-channel", "--unread", "--json"], "mark-target");
    expect(unread.exitCode).toBe(0);
    const messages = JSON.parse(unread.stdout).messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].preview).toBe("older page message");
  });

  test("read accepts --unread-only after agent registration", () => {
    const agent = "unread-only-reader";
    const register = runCli(["agents", "register", agent, "--session", "unread-only-session"], agent);
    expect(register.exitCode).toBe(0);

    seedChannel("unread-only-channel", agent);
    runCli(["channel", "send", "unread-only-channel", "already read"], "alice");
    const marked = runCli(["read", "--channel", "unread-only-channel", "--mark-read"], agent);
    expect(marked.exitCode).toBe(0);
    runCli(["channel", "send", "unread-only-channel", "still unread"], "alice");

    const unread = runCli(["read", "--channel", "unread-only-channel", "--unread-only", "--json"], agent);
    expect(unread.exitCode).toBe(0);
    expect(JSON.parse(unread.stdout).messages.map((message: { preview: string }) => message.preview)).toEqual(["still unread"]);
  }, 15_000);

  test("send exits nonzero for sensitive content without echoing the value", () => {
    const blocked = syntheticDatabaseUrl();
    seedChannel("blocked-channel", "blocked-target");
    const send = runCli(["send", `blocked ${blocked}`, "--channel", "blocked-channel"], "alice");

    expect(send.exitCode).not.toBe(0);
    expect(send.stderr).toContain("sensitive content detected");
    expect(send.stderr).not.toContain(blocked);

    const read = runCli(["read", "--channel", "blocked-channel", "--json"], "blocked-target");
    expect(read.exitCode).toBe(0);
    expect(JSON.parse(read.stdout).messages).toHaveLength(0);
  });

  test("send exits nonzero for sensitive metadata without echoing the value", () => {
    const blocked = syntheticDatabaseUrl();
    seedChannel("metadata-blocked-channel", "metadata-blocked");
    const send = runCli([
      "send",
      "metadata should be checked",
      "--channel",
      "metadata-blocked-channel",
      "--metadata",
      JSON.stringify({ dsn: blocked }),
    ], "alice");

    expect(send.exitCode).not.toBe(0);
    expect(send.stderr).toContain("sensitive content detected");
    expect(send.stderr).not.toContain(blocked);

    const read = runCli(["read", "--channel", "metadata-blocked-channel", "--json"], "metadata-blocked");
    expect(read.exitCode).toBe(0);
    expect(JSON.parse(read.stdout).messages).toHaveLength(0);
  });

  test("pinned --json returns a preview page envelope", () => {
    seedChannel("pin-channel", "pin-reader");
    const send = runCli(["send", "pin me", "--channel", "pin-channel"], "pin-writer");
    expect(send.exitCode).toBe(0);

    const read = runCli(["read", "--channel", "pin-channel", "--limit", "1", "--json"], "pin-reader");
    expect(read.exitCode).toBe(0);
    const id = JSON.parse(read.stdout).messages[0].id as number;

    const pin = runCli(["pin", String(id)], "pin-reader");
    expect(pin.exitCode).toBe(0);

    const pinned = runCli(["pinned", "--json"], "pin-reader");
    expect(pinned.exitCode).toBe(0);
    const body = JSON.parse(pinned.stdout) as { messages: Array<{ id: number }>; has_more: boolean; skipped_count: number; byte_length: number };
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages[0].id).toBe(id);
    expect(typeof body.has_more).toBe("boolean");
    expect(typeof body.skipped_count).toBe("number");
    expect(typeof body.byte_length).toBe("number");
  });

  test("channel send exits nonzero for sensitive channel input without echoing the value", () => {
    const blocked = syntheticDatabaseUrl();
    const send = runCli(["channel", "send", blocked, "channel should be checked"], "alice");

    expect(send.exitCode).not.toBe(0);
    expect(send.stderr).toContain("sensitive content detected");
    expect(send.stderr).not.toContain(blocked);
  });

  test("send exits nonzero for truncated metadata JSON", () => {
    const send = runCli(["send", "metadata parse check", "--channel", "metadata-target-channel", "--metadata", "{\"broken\":"], "alice");

    expect(send.exitCode).not.toBe(0);
    expect(send.stderr).toContain("Invalid --metadata JSON.");
  });
});
