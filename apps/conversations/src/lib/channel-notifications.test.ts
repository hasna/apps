import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDb } from "./db";
import { sendMessage } from "./messages";
import { createChannel } from "./channels";
import { buildMessagePreview, listChannelNotificationSubscriptions, markAllChannelNotificationsRead, markChannelNotificationsRead, readChannelNotifications, subscribeToChannelNotifications, unsubscribeFromChannelNotifications } from "./channel-notifications";
import { createDisposableStore, enterHermeticTestEnv } from "../test/hermetic";

let store: ReturnType<typeof createDisposableStore>;
let restoreEnv: () => void;

beforeEach(() => {
  store = createDisposableStore("channel-notifications");
  restoreEnv = enterHermeticTestEnv({ CONVERSATIONS_DB_PATH: store.dbPath });
  closeDb();
});

afterEach(() => {
  closeDb();
  restoreEnv();
  store.cleanup();
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
    expect(readChannelNotifications({ agent: "agent-a" }).notifications).toHaveLength(0);

    const fresh = sendMessage({
      from: "alice",
      to: "ops",
      channel: "ops",
      session_id: "channel:ops",
      content: "sent after subscribing",
    });

    const notifications = readChannelNotifications({ agent: "agent-a" }).notifications;
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

    const notifications = readChannelNotifications({ agent: "agent-a" }).notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].channel).toBe("ops");
    expect(notifications[0].preview).toBe("deploy finished succ…");
    expect(notifications[0].preview).not.toContain("#");
    expect(notifications[0].preview).not.toContain("_");
    expect(notifications[0].unread).toBe(true);
  });

  test("redacts sensitive values and never projects restricted channel bodies", () => {
    createChannel("ops", "creator");
    createChannel("security-incidents", "creator");
    subscribeToChannelNotifications("ops", "agent-a", { preview_chars: 500 });
    subscribeToChannelNotifications("security-incidents", "agent-a", { preview_chars: 500 });
    const token = ["Bearer", `fixture-${"x".repeat(30)}`].join(" ");

    sendMessage({ from: "alice", to: "ops", channel: "ops", content: `rotate ${token}` });
    sendMessage({ from: "alice", to: "security-incidents", channel: "security-incidents", content: "restricted root cause body" });

    const notifications = readChannelNotifications({ agent: "agent-a" }).notifications;
    expect(notifications.find((item) => item.channel === "ops")?.preview).toContain("[REDACTED:BEARER_TOKEN]");
    expect(JSON.stringify(notifications)).not.toContain(token);
    const restricted = notifications.find((item) => item.channel === "security-incidents");
    expect(restricted?.preview).toBe("[REDACTED:RESTRICTED_CHANNEL_BODY]");
    expect(JSON.stringify(restricted)).not.toContain("restricted root cause body");
  });

  test("marks notifications read by ids and all", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");

    const one = sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: "first notification" });
    const two = sendMessage({ from: "bob", to: "ops", channel: "ops", session_id: "channel:ops", content: "second notification" });

    expect(markChannelNotificationsRead("agent-a", [one.id])).toBe(1);

    let unread = readChannelNotifications({ agent: "agent-a" }).notifications;
    expect(unread).toHaveLength(1);
    expect(unread[0].message_id).toBe(two.id);

    expect(markAllChannelNotificationsRead("agent-a", "ops")).toBe(1);
    unread = readChannelNotifications({ agent: "agent-a" }).notifications;
    expect(unread).toHaveLength(0);
  });

  test("mark_read option clears unread state on read", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");

    sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: "preview me" });
    const page = readChannelNotifications({ agent: "agent-a", mark_read: true });
    const notifications = page.notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].unread).toBe(false);
    expect(page.marked_read).toBe(1);
    expect(readChannelNotifications({ agent: "agent-a" }).notifications).toHaveLength(0);
  });

  test("preview_bytes caps UTF-8 bytes rather than characters", () => {
    createChannel("unicode", "creator");
    subscribeToChannelNotifications("unicode", "agent-a", { preview_chars: 500 });
    sendMessage({
      from: "alice",
      to: "unicode",
      channel: "unicode",
      content: "🙂".repeat(100),
    });

    const [notification] = readChannelNotifications({ agent: "agent-a", preview_bytes: 12 }).notifications;
    expect(Buffer.byteLength(notification.preview, "utf8")).toBeLessThanOrEqual(12);
  });
});

describe("buildMessagePreview", () => {
  test("strips markdown-ish formatting and truncates", () => {
    expect(buildMessagePreview("## hello _world_", 12)).toBe("hello world");
    expect(buildMessagePreview("abcdef ghijkl mnop", 8)).toBe("abcdef g…");
  });
});
