import { describe, test, expect } from "bun:test";
import { Command } from "commander";
import { formatDigestContinuationCommand, registerMessagingCommands } from "./messaging";

describe("registerMessagingCommands", () => {
  test("registers send command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const send = program.commands.find((c) => c.name() === "send");
    expect(send).toBeDefined();
    expect(send?.options.some((o) => o.long === "--to")).toBe(true);
    expect(send?.options.some((o) => o.long === "--channel")).toBe(true);
  });

  test("registers read command", () => {
    const program = new Command();
    registerMessagingCommands(program);

    const read = program.commands.find((c) => c.name() === "read");
    expect(read).toBeDefined();
    expect(read?.options.some((o) => o.long === "--session")).toBe(true);
    expect(read?.options.some((o) => o.long === "--unread")).toBe(true);
    expect(read?.options.some((o) => o.long === "--unread-only")).toBe(true);
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
  });

  test("formats digest continuation commands for channel, session, and recipient scopes", () => {
    expect(formatDigestContinuationCommand({
      channel: "engineering",
      session_id: null,
      to: null,
      next_cursor: 42,
      max_bytes: 8192,
    })).toBe("conversations digest engineering --cursor 42 --max-bytes 8192");

    expect(formatDigestContinuationCommand({
      channel: null,
      session_id: "session-123",
      to: null,
      next_cursor: 43,
      max_bytes: 4096,
    })).toBe("conversations digest --session session-123 --cursor 43 --max-bytes 4096");

    expect(formatDigestContinuationCommand({
      channel: null,
      session_id: null,
      to: "agent-two",
      next_cursor: 44,
      max_bytes: 2048,
    })).toBe("conversations digest --to agent-two --cursor 44 --max-bytes 2048");

    expect(formatDigestContinuationCommand({
      channel: null,
      session_id: "session with spaces",
      to: null,
      next_cursor: 45,
      max_bytes: 1024,
    })).toBe("conversations digest --session 'session with spaces' --cursor 45 --max-bytes 1024");

    expect(formatDigestContinuationCommand({
      channel: null,
      session_id: null,
      to: "agent$(echo injected)",
      next_cursor: 46,
      max_bytes: 1024,
    })).toBe("conversations digest --to 'agent$(echo injected)' --cursor 46 --max-bytes 1024");

    expect(formatDigestContinuationCommand({
      channel: null,
      session_id: null,
      to: "agent`echo injected`",
      next_cursor: 47,
      max_bytes: 1024,
    })).toBe("conversations digest --to 'agent`echo injected`' --cursor 47 --max-bytes 1024");

    expect(formatDigestContinuationCommand({
      channel: null,
      session_id: null,
      to: "agent's-space",
      next_cursor: 48,
      max_bytes: 1024,
    })).toBe("conversations digest --to 'agent'\\''s-space' --cursor 48 --max-bytes 1024");
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
});
