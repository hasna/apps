import { describe, test, expect } from "bun:test";
import * as path from "node:path";
import { Command } from "commander";
import {
  formatDigestContinuationCommand,
  registerMessagingCommands,
  sendDesktopNotification,
} from "./messaging";

type RunnerCall = unknown[];

function captureRunner(calls: RunnerCall[]) {
  return (...args: unknown[]) => {
    calls.push(args);
  };
}

describe("macOS desktop notifications", () => {
  test("passes injection-shaped title and body as osascript argv data", () => {
    const calls: RunnerCall[] = [];
    const title = "sender $(touch /tmp/conversations-title)";
    const body = "body `touch /tmp/conversations-body`; printf injected";

    sendDesktopNotification(title, body, "darwin", captureRunner(calls));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("osascript");
    expect(calls[0]?.[1]).toEqual([
      "-e",
      'display notification "body `touch /tmp/conversations-body`; printf injected" with title "sender $(touch /tmp/conversations-title)"',
    ]);
    expect(calls[0]?.[2]).toEqual({ timeout: 3000 });
  });

  test("does not hand injection payload to a shell command runner", () => {
    const calls: RunnerCall[] = [];
    const payload = '$(touch /tmp/conversations-injected); `touch /tmp/conversations-backtick`';
    const runner = (...args: unknown[]) => {
      calls.push(args);
      if (typeof args[0] === "string" && !Array.isArray(args[1])) {
        throw new Error("shell command runner received interpolated input");
      }
    };

    expect(() => sendDesktopNotification(payload, payload, "darwin", runner)).not.toThrow();
    expect(calls[0]?.[0]).toBe("osascript");
    expect(Array.isArray(calls[0]?.[1])).toBe(true);
  });
});

describe("registerMessagingCommands", () => {
  test("registers send command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const send = program.commands.find((c) => c.name() === "send");
    expect(send).toBeDefined();
    // Agent-addressed DMs were removed from conversations (staged behind the
    // messages-app v1 release gate) — the --to agent-addressing verb is gone.
    expect(send?.options.some((o) => o.long === "--to")).toBe(false);
    expect(send?.options.some((o) => o.long === "--channel")).toBe(true);
    expect(send?.options.some((o) => o.long === "--attach")).toBe(true);
    expect(send?.options.some((o) => o.long === "--attachment")).toBe(true);
    expect(send?.options.some((o) => o.long === "--reply-to")).toBe(true);
    expect(send?.options.some((o) => o.long === "--working-dir")).toBe(true);
    expect(send?.options.some((o) => o.long === "--repository")).toBe(true);
    expect(send?.options.some((o) => o.long === "--branch")).toBe(true);

    const parsed = send?.parseOptions([
      "--attach", "evidence.txt", "handoff.bundle",
      "--attachment", "alias.json",
      "--reply-to", "42",
      "--working-dir", "/synthetic/cli-context",
      "--repository", "hasna/conversations-cli-context",
      "--branch", "fix/cli-context",
    ]);
    expect(parsed?.unknown).toEqual([]);
    expect(send?.opts()).toMatchObject({
      attach: ["evidence.txt", "handoff.bundle"],
      attachment: ["alias.json"],
      replyTo: "42",
      workingDir: "/synthetic/cli-context",
      repository: "hasna/conversations-cli-context",
      branch: "fix/cli-context",
    });
  });

  test("send help usage line shows the documented channel-first positional order", () => {
    // Regression for todos 5002ed12: the auto-generated usage line read
    // "send [options] <message> [channel]" while the documented and
    // e2e-tested positional form is channel-first (`send <channel> "<message>"`,
    // see send-positional-channel.e2e.test.ts and the handler's swap when a
    // second positional is present). The usage line must not contradict the
    // parsing order.
    const program = new Command();
    registerMessagingCommands(program);

    const send = program.commands.find((c) => c.name() === "send");
    expect(send).toBeDefined();
    const sendHelp = send?.helpInformation() ?? "";
    const usageLine = sendHelp.split("\n").find((line) => line.startsWith("Usage:"));
    expect(usageLine).toBeDefined();
    expect(usageLine).toContain("<channel>");
    expect(usageLine).toContain("<message>");
    expect(usageLine!.indexOf("<channel>")).toBeLessThan(usageLine!.indexOf("<message>"));
  });

  test("registers read command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const read = program.commands.find((c) => c.name() === "read");
    expect(read).toBeDefined();
    expect(read?.options.some((o) => o.long === "--session")).toBe(true);
    expect(read?.options.some((o) => o.long === "--unread")).toBe(true);
    expect(read?.options.some((o) => o.long === "--unread-only")).toBe(true);

    const parsed = read?.parseOptions(["--unread-only"]);
    expect(parsed?.unknown).toEqual([]);
    expect(read?.opts().unreadOnly).toBe(true);
  });

  test("registers show command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const show = program.commands.find((c) => c.name() === "show");
    expect(show).toBeDefined();
  });

  test("registers digest command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const digest = program.commands.find((c) => c.name() === "digest");
    expect(digest).toBeDefined();
    expect(digest?.options.some((o) => o.long === "--cursor")).toBe(true);
    expect(digest?.options.some((o) => o.long === "--max-bytes")).toBe(true);
    expect(digest?.options.some((o) => o.long === "--mark-read")).toBe(true);
    // DM-scoped digest verbs are gone (staged behind the messages-app v1 gate).
    expect(digest?.options.some((o) => o.long === "--session")).toBe(false);
    expect(digest?.options.some((o) => o.long === "--to")).toBe(false);
  });

  test("formats digest continuation commands for the channel scope", () => {
    expect(formatDigestContinuationCommand({
      channel: "engineering",
      session_id: null,
      to: null,
      next_cursor: 42,
      max_bytes: 8192,
    })).toBe("conversations digest engineering --cursor 42 --max-bytes 8192");

    // DM/session scopes no longer produce a continuation command: the
    // formatter emits the channel scope only, and the DM verbs are gone.
    expect(formatDigestContinuationCommand({
      channel: null,
      session_id: "session-123",
      to: null,
      next_cursor: 43,
      max_bytes: 4096,
    })).toBe("conversations digest --cursor 43 --max-bytes 4096");

    expect(formatDigestContinuationCommand({
      channel: null,
      session_id: null,
      to: "agent-two",
      next_cursor: 44,
      max_bytes: 2048,
    })).toBe("conversations digest --cursor 44 --max-bytes 2048");
  });

  test("registers search command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const search = program.commands.find((c) => c.name() === "search");
    expect(search).toBeDefined();
    expect(search?.options.some((o) => o.long === "--channel")).toBe(true);
  });

  test("registers since command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const since = program.commands.find((c) => c.name() === "since");
    expect(since).toBeDefined();
  });

  test("registers reply command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const reply = program.commands.find((c) => c.name() === "reply");
    expect(reply).toBeDefined();
  });

  test("registers mark-read command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const markRead = program.commands.find((c) => c.name() === "mark-read");
    expect(markRead).toBeDefined();
    expect(markRead?.options.some((o) => o.long === "--all")).toBe(true);
  });

  test("registers export command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const exportCmd = program.commands.find((c) => c.name() === "export");
    expect(exportCmd).toBeDefined();
    expect(exportCmd?.options.some((o) => o.long === "--format")).toBe(true);
  });

  test("registers edit command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const edit = program.commands.find((c) => c.name() === "edit");
    expect(edit).toBeDefined();
  });

  test("registers delete command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const deleteCmd = program.commands.find((c) => c.name() === "delete");
    expect(deleteCmd).toBeDefined();
  });

  test("registers pin, unpin, pinned commands", () => {
    const program = new Command();
    registerMessagingCommands(program);

    expect(program.commands.find((c) => c.name() === "pin")).toBeDefined();
    expect(program.commands.find((c) => c.name() === "unpin")).toBeDefined();
    expect(program.commands.find((c) => c.name() === "pinned")).toBeDefined();
  });

  test("registers blockers command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const blockers = program.commands.find((c) => c.name() === "blockers");
    expect(blockers).toBeDefined();
  });

  test("registers notifications command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const notifications = program.commands.find((c) => c.name() === "notifications");
    expect(notifications).toBeDefined();
  });

  test("registers watch command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const watch = program.commands.find((c) => c.name() === "watch");
    expect(watch).toBeDefined();
  });

  test("registers update command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const update = program.commands.find((c) => c.name() === "update");
    expect(update).toBeDefined();
    expect(update?.options.some((o) => o.long === "--check")).toBe(true);
  });

  // Regression for the staged DM removal (Fable ruling, todos b02a31ff):
  // the agent-addressed DM verbs are GONE. Exercised through the real CLI in a
  // subprocess so commander's error exit cannot kill the test runner.
  test("DM verbs are gone: send --to, read --to, digest --session/--to are refused by the CLI", () => {
    const cli = path.resolve(import.meta.dir, "..", "..", "..", "src", "cli", "index.tsx");
    const refused: Array<[string, string[]]> = [
      ["send --to", ["send", "--to", "agent-two", "hello"]],
      ["read --to", ["read", "--to", "agent-two"]],
      ["digest --session", ["digest", "--session", "session-123"]],
      ["digest --to", ["digest", "--to", "agent-two"]],
      ["search --to", ["search", "query", "--to", "agent-two"]],
    ];

    for (const [label, args] of refused) {
      const res = Bun.spawnSync({
        cmd: ["bun", "run", cli, ...args],
        cwd: path.resolve(import.meta.dir, "..", "..", ".."),
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = `${new TextDecoder().decode(res.stdout)}\n${new TextDecoder().decode(res.stderr)}`;
      expect(res.exitCode, `${label} must be refused (got rc=${res.exitCode})`).not.toBe(0);
      expect(out, `${label} must fail on the unknown option`).toContain("unknown option");
    }
  });

  test("send refuses a channel-less message (no DM route remains)", () => {
    const cli = path.resolve(import.meta.dir, "..", "..", "..", "src", "cli", "index.tsx");
    const res = Bun.spawnSync({
      cmd: ["bun", "run", cli, "send", "--from", "test-agent", "hello"],
      cwd: path.resolve(import.meta.dir, "..", "..", ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = `${new TextDecoder().decode(res.stdout)}\n${new TextDecoder().decode(res.stderr)}`;
    expect(res.exitCode, `channel-less send must be refused (got rc=${res.exitCode})`).not.toBe(0);
    expect(out).toContain("--channel");
  });
});
