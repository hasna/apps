import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readMessages } from "../../lib/messages.js";
import { closeDb } from "../../lib/db.js";
import { submitChatViewMessage } from "./ChatView.js";

const TEST_DB = join(tmpdir(), `conversations-chat-view-${Date.now()}.db`);

function syntheticDatabaseUrl(): string {
  return ["postgres", "://", "tui_user:synthetic-password", "@db.example.invalid/app"].join("");
}

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(`${TEST_DB}-wal`); } catch {}
  try { unlinkSync(`${TEST_DB}-shm`); } catch {}
});

describe("submitChatViewMessage", () => {
  test("blocks sensitive content without throwing, echoing, or persisting", () => {
    const blocked = syntheticDatabaseUrl();
    const result = submitChatViewMessage(
      { agent: "tui-sender", recipient: "tui-recipient" },
      `blocked ${blocked}`
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("blocked");
      expect(result.error).not.toContain(blocked);
    }
    expect(readMessages({ to: "tui-recipient" })).toHaveLength(0);
  });

  test("sends safe content", () => {
    const result = submitChatViewMessage(
      { agent: "tui-sender", recipient: "tui-recipient" },
      "safe chat message"
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.content).toBe("safe chat message");
    }
    expect(readMessages({ to: "tui-recipient" })).toHaveLength(1);
  });
});
