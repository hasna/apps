import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb } from "./db";
import { sendMessage } from "./messages";
import { createSpace } from "./spaces";
import { buildMessagePreview, listSpaceNotificationSubscriptions, markAllSpaceNotificationsRead, markSpaceNotificationsRead, readSpaceNotifications, subscribeToSpaceNotifications, unsubscribeFromSpaceNotifications } from "./space-notifications";

const TEST_DB = join(tmpdir(), `conversations-test-space-notifications-${Date.now()}.db`);

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

describe("space notification subscriptions", () => {
  test("creates and lists subscriptions", () => {
    createSpace("ops", "creator");
    const subscription = subscribeToSpaceNotifications("ops", "agent-a", { preview_chars: 90 });
    expect(subscription.space).toBe("ops");
    expect(subscription.agent).toBe("agent-a");
    expect(subscription.preview_chars).toBe(90);
    expect(subscription.since_message_id).toBe(0);

    const list = listSpaceNotificationSubscriptions("agent-a");
    expect(list).toHaveLength(1);
    expect(list[0].space).toBe("ops");
  });

  test("updates preview length on re-subscribe", () => {
    createSpace("ops", "creator");
    subscribeToSpaceNotifications("ops", "agent-a", { preview_chars: 80 });
    const updated = subscribeToSpaceNotifications("ops", "agent-a", { preview_chars: 120 });
    expect(updated.preview_chars).toBe(120);
    expect(listSpaceNotificationSubscriptions("agent-a")).toHaveLength(1);
  });

  test("unsubscribes cleanly", () => {
    createSpace("ops", "creator");
    subscribeToSpaceNotifications("ops", "agent-a");
    expect(unsubscribeFromSpaceNotifications("ops", "agent-a")).toBe(true);
    expect(unsubscribeFromSpaceNotifications("ops", "agent-a")).toBe(false);
  });
});

describe("space notifications", () => {
  test("starts notifying only for messages sent after subscription", () => {
    createSpace("ops", "creator");
    const historical = sendMessage({
      from: "alice",
      to: "ops",
      space: "ops",
      session_id: "space:ops",
      content: "sent before subscribing",
    });

    const subscription = subscribeToSpaceNotifications("ops", "agent-a");
    expect(subscription.since_message_id).toBe(historical.id);
    expect(readSpaceNotifications({ agent: "agent-a" })).toHaveLength(0);

    const fresh = sendMessage({
      from: "alice",
      to: "ops",
      space: "ops",
      session_id: "space:ops",
      content: "sent after subscribing",
    });

    const notifications = readSpaceNotifications({ agent: "agent-a" });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message_id).toBe(fresh.id);
  });

  test("returns preview-only notifications for subscribed spaces", () => {
    createSpace("ops", "creator");
    createSpace("other", "creator");
    subscribeToSpaceNotifications("ops", "agent-a", { preview_chars: 20 });

    sendMessage({ from: "alice", to: "ops", space: "ops", session_id: "space:ops", content: "## deploy _finished_ successfully after validation" });
    sendMessage({ from: "alice", to: "other", space: "other", session_id: "space:other", content: "should not show" });
    sendMessage({ from: "agent-a", to: "ops", space: "ops", session_id: "space:ops", content: "my own message" });

    const notifications = readSpaceNotifications({ agent: "agent-a" });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].space).toBe("ops");
    expect(notifications[0].preview).toBe("deploy finished succ…");
    expect(notifications[0].preview).not.toContain("#");
    expect(notifications[0].preview).not.toContain("_");
    expect(notifications[0].unread).toBe(true);
  });

  test("marks notifications read by ids and all", () => {
    createSpace("ops", "creator");
    subscribeToSpaceNotifications("ops", "agent-a");

    const one = sendMessage({ from: "alice", to: "ops", space: "ops", session_id: "space:ops", content: "first notification" });
    const two = sendMessage({ from: "bob", to: "ops", space: "ops", session_id: "space:ops", content: "second notification" });

    expect(markSpaceNotificationsRead("agent-a", [one.id])).toBe(1);

    let unread = readSpaceNotifications({ agent: "agent-a" });
    expect(unread).toHaveLength(1);
    expect(unread[0].message_id).toBe(two.id);

    expect(markAllSpaceNotificationsRead("agent-a", "ops")).toBe(1);
    unread = readSpaceNotifications({ agent: "agent-a" });
    expect(unread).toHaveLength(0);
  });

  test("mark_read option clears unread state on read", () => {
    createSpace("ops", "creator");
    subscribeToSpaceNotifications("ops", "agent-a");

    sendMessage({ from: "alice", to: "ops", space: "ops", session_id: "space:ops", content: "preview me" });
    const notifications = readSpaceNotifications({ agent: "agent-a", mark_read: true });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].unread).toBe(false);
    expect(readSpaceNotifications({ agent: "agent-a" })).toHaveLength(0);
  });
});

describe("buildMessagePreview", () => {
  test("strips markdown-ish formatting and truncates", () => {
    expect(buildMessagePreview("## hello _world_", 12)).toBe("hello world");
    expect(buildMessagePreview("abcdef ghijkl mnop", 8)).toBe("abcdef g…");
  });
});
