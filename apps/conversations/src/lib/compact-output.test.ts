import { describe, expect, test } from "bun:test";
import {
  compactCollection,
  previewText,
  resolveOutputWindow,
  summarizeMessage,
  summarizeSession,
  windowItems,
} from "./compact-output";
import type { Message, Session } from "../types";

describe("compact output helpers", () => {
  test("previewText normalizes whitespace and truncates long values", () => {
    expect(previewText("hello\n\nworld", 20)).toBe("hello world");
    expect(previewText("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefg...");
  });

  test("resolveOutputWindow defaults and caps large limits", () => {
    expect(resolveOutputWindow()).toMatchObject({ limit: 10, offset: 0, limitCapped: false });
    expect(resolveOutputWindow({ limit: 250, cursor: 5 })).toMatchObject({
      limit: 100,
      offset: 5,
      requestedLimit: 250,
      limitCapped: true,
    });
  });

  test("windowItems reports next cursor for additional rows", () => {
    const window = resolveOutputWindow({ limit: 2, cursor: 1 });
    const page = windowItems(["a", "b", "c", "d"], window);

    expect(page.items).toEqual(["b", "c"]);
    expect(page.total).toBe(4);
    expect(page.nextCursor).toBe(3);
    expect(page.hasMore).toBe(true);
  });

  test("compactCollection returns bounded collection metadata", () => {
    const result = compactCollection([1, 2, 3], { limit: 2 });

    expect(result).toEqual({
      items: [1, 2],
      count: 2,
      total: 3,
      limit: 2,
      cursor: 0,
      next_cursor: 2,
      has_more: true,
      limit_capped: false,
    });
  });

  test("summarizeMessage omits full content and exposes a preview", () => {
    const msg: Message = {
      id: 42,
      session_id: "session-1",
      from_agent: "alice",
      to_agent: "bob",
      channel: null,
      project_id: null,
      content: "x".repeat(40),
      priority: "normal",
      working_dir: null,
      repository: null,
      branch: null,
      metadata: null,
      created_at: "2026-01-01T00:00:00.000",
      read_at: null,
      edited_at: null,
      pinned_at: null,
      blocking: false,
      attachments: null,
      reply_to: null,
    };

    const summary = summarizeMessage(msg, 12);
    expect(summary.preview).toBe("xxxxxxxxx...");
    expect(summary.truncated).toBe(true);
    expect(summary).not.toHaveProperty("content");
    expect(summary.unread).toBe(true);
  });

  test("summarizeSession bounds participant lists", () => {
    const session: Session = {
      session_id: "session-1",
      participants: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      last_message_at: "2026-01-01T00:00:00.000",
      message_count: 5,
      unread_count: 1,
    };

    const summary = summarizeSession(session);
    expect(summary.participants).toHaveLength(8);
    expect(summary.participant_count).toBe(9);
    expect(summary.participants_truncated).toBe(true);
  });
});
