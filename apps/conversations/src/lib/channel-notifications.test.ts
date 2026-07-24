import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "./db";
import { sendMessage } from "./messages";
import { createChannel } from "./channels";
import { buildMessagePreview, listChannelNotificationSubscriptions, markAllChannelNotificationsRead, markChannelNotificationsRead, readChannelNotifications, subscribeToChannelNotifications, unsubscribeFromChannelNotifications } from "./channel-notifications";

const TEST_DB = join(tmpdir(), `conversations-test-channel-notifications-${Date.now()}.db`);

function syntheticDatabaseUrl(): string {
  return ["postgres", "://", "notify_user:synthetic-password", "@db.example.invalid/app"].join("");
}

function insertLegacyChannelMessage(channel: string, content: string): number {
  const result = getDb().prepare(`
    INSERT INTO messages (session_id, from_agent, to_agent, channel, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(`channel:${channel}`, "legacy-sender", channel, channel, content);
  return Number(result.lastInsertRowid);
}

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
  delete process.env.CONVERSATIONS_DB_PATH;
});

describe("channel notification subscriptions", () => {
  test("creates and lists subscriptions", () => {
    createChannel("ops", "creator");
    const subscription = subscribeToChannelNotifications("ops", "agent-a", { preview_chars: 90 });
    expect(subscription.channel).toBe("ops");
    expect(subscription.agent).toBe("agent-a");
    expect(subscription.preview_chars).toBe(90);
    expect(subscription.since_message_id).toBe(0);

    const list = listChannelNotificationSubscriptions("agent-a");
    expect(list).toHaveLength(1);
    expect(list[0].channel).toBe("ops");
  });

  test("updates preview length on re-subscribe", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a", { preview_chars: 80 });
    const updated = subscribeToChannelNotifications("ops", "agent-a", { preview_chars: 120 });
    expect(updated.preview_chars).toBe(120);
    expect(listChannelNotificationSubscriptions("agent-a")).toHaveLength(1);
  });

  test("unsubscribes cleanly", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");
    expect(unsubscribeFromChannelNotifications("ops", "agent-a")).toBe(true);
    expect(unsubscribeFromChannelNotifications("ops", "agent-a")).toBe(false);
  });
});

describe("channel notifications", () => {
  test("starts notifying only for messages sent after subscription", () => {
    createChannel("ops", "creator");
    const historical = sendMessage({
      from: "alice",
      to: "ops",
      channel: "ops",
      session_id: "channel:ops",
      content: "sent before subscribing",
    });

    const subscription = subscribeToChannelNotifications("ops", "agent-a");
    expect(subscription.since_message_id).toBe(historical.id);
    expect(readChannelNotifications({ agent: "agent-a" })).toHaveLength(0);

    const fresh = sendMessage({
      from: "alice",
      to: "ops",
      channel: "ops",
      session_id: "channel:ops",
      content: "sent after subscribing",
    });

    const notifications = readChannelNotifications({ agent: "agent-a" });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message_id).toBe(fresh.id);
  });

  test("returns preview-only notifications for subscribed channels", () => {
    createChannel("ops", "creator");
    createChannel("other", "creator");
    subscribeToChannelNotifications("ops", "agent-a", { preview_chars: 20 });

    sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: "## deploy _finished_ successfully after validation" });
    sendMessage({ from: "alice", to: "other", channel: "other", session_id: "channel:other", content: "should not show" });
    sendMessage({ from: "agent-a", to: "ops", channel: "ops", session_id: "channel:ops", content: "my own message" });

    const notifications = readChannelNotifications({ agent: "agent-a" });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].channel).toBe("ops");
    expect(notifications[0].preview).toBe("deploy finished succ…");
    expect(notifications[0].preview).not.toContain("#");
    expect(notifications[0].preview).not.toContain("_");
    expect(notifications[0].unread).toBe(true);
  });

  test("redacts legacy sensitive content from notification previews", () => {
    const blocked = syntheticDatabaseUrl();
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a", { preview_chars: 120 });

    const id = insertLegacyChannelMessage("ops", `legacy DSN ${blocked}`);
    const notifications = readChannelNotifications({ agent: "agent-a" });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].message_id).toBe(id);
    expect(notifications[0].preview).toContain("[REDACTED:DATABASE URL]");
    expect(notifications[0].preview).not.toContain(blocked);
  });

  test("marks notifications read by ids and all", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");

    const one = sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: "first notification" });
    const two = sendMessage({ from: "bob", to: "ops", channel: "ops", session_id: "channel:ops", content: "second notification" });

    expect(markChannelNotificationsRead("agent-a", [one.id])).toBe(1);

    let unread = readChannelNotifications({ agent: "agent-a" });
    expect(unread).toHaveLength(1);
    expect(unread[0].message_id).toBe(two.id);

    expect(markAllChannelNotificationsRead("agent-a", "ops")).toBe(1);
    unread = readChannelNotifications({ agent: "agent-a" });
    expect(unread).toHaveLength(0);
  });

  test("mark_read option clears unread state on read", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");

    sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: "preview me" });
    const notifications = readChannelNotifications({ agent: "agent-a", mark_read: true });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].unread).toBe(false);
    expect(readChannelNotifications({ agent: "agent-a" })).toHaveLength(0);
  });
});

describe("buildMessagePreview", () => {
  test("strips markdown-ish formatting and truncates", () => {
    expect(buildMessagePreview("## hello _world_", 12)).toBe("hello world");
    expect(buildMessagePreview("abcdef ghijkl mnop", 8)).toBe("abcdef g…");
  });
});
