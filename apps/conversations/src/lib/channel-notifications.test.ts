import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "./db";
import { sendMessage } from "./messages";
import { createChannel } from "./channels";
import { registerAgent } from "./presence";
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

  test("suppresses the registered sender id without hiding same-name peers", () => {
    createChannel("ops", "creator");
    const registration = registerAgent("Herminia", "session-herminia");
    if (!("agent" in registration)) {
      throw new Error("Expected agent registration to succeed");
    }
    subscribeToChannelNotifications("ops", "Herminia");

    sendMessage({
      from: registration.agent.id,
      to: "ops",
      channel: "ops",
      session_id: "channel:ops",
      content: "my registered sender traffic",
    });
    const sameNamePeer = sendMessage({
      from: "Herminia",
      to: "ops",
      channel: "ops",
      session_id: "channel:ops",
      content: "a different session using the same display name",
    });

    const notifications = readChannelNotifications({ agent: "Herminia" });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message_id).toBe(sameNamePeer.id);
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

/**
 * A channel notification carries a `preview` built by stripping `[*#`~_>-]` and
 * capping at DEFAULT_PREVIEW_CHARS. That is fine for a glance and useless for a
 * monitor: every identifier an operator would act on is made of exactly those
 * characters. `agent-chief-staff` arrives as `agent chief staff`, a PR
 * reference loses its `#`, and a branch name loses both its hyphens and its
 * underscores — so the only tokens that survive intact are bare hex ids.
 *
 * These assert the OPT-IN full-content path, and equally that the preview is
 * unchanged for every existing consumer of it.
 */
describe("readChannelNotifications include_content", () => {
  const IDENTIFIERS = "agent-chief-staff hasnaxyz/iapp-infra#92 fix/88605573-identities-oidc-trust test_with_underscores";

  test("preview still mangles identifiers — the existing default is untouched", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");
    sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: IDENTIFIERS });

    const [notification] = readChannelNotifications({ agent: "agent-a" });
    expect(notification.preview).toContain("agent chief staff");
    expect(notification.preview).not.toContain("agent-chief-staff");
    expect(notification.preview).not.toContain("#92");
    expect(notification.preview).not.toContain("test_with_underscores");
  });

  test("omits content entirely unless the caller opts in", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");
    sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: IDENTIFIERS });

    const [notification] = readChannelNotifications({ agent: "agent-a" });
    expect(notification.content).toBeUndefined();
  });

  test("include_content returns every identifier intact", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");
    sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: IDENTIFIERS });

    const [notification] = readChannelNotifications({ agent: "agent-a", include_content: true });
    expect(notification.content).toBe(IDENTIFIERS);
    expect(notification.content).toContain("agent-chief-staff");
    expect(notification.content).toContain("hasnaxyz/iapp-infra#92");
    expect(notification.content).toContain("fix/88605573-identities-oidc-trust");
    expect(notification.content).toContain("test_with_underscores");
    // The preview is additive, not replaced: other consumers still get theirs.
    expect(notification.preview).toContain("agent chief staff");
  });

  test("content is not subject to the preview character cap", () => {
    createChannel("ops", "creator");
    // The stored cap that truncates the preview; content must ignore it.
    subscribeToChannelNotifications("ops", "agent-a", { preview_chars: 20 });
    const long = `start-of-body ${"x".repeat(300)} end-of-body`;
    sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: long });

    const [notification] = readChannelNotifications({ agent: "agent-a", include_content: true });
    expect(notification.content).toBe(long);
    expect(notification.content!.length).toBeGreaterThan(300);
    expect(notification.preview).toContain("…");
    expect(notification.preview.length).toBeLessThan(40);
  });

  test("content is redacted on the same terms as the preview", () => {
    const blocked = syntheticDatabaseUrl();
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");

    insertLegacyChannelMessage("ops", `legacy DSN ${blocked}`);
    const [notification] = readChannelNotifications({ agent: "agent-a", include_content: true });

    // The marker keeps its underscore here and loses it in the preview
    // (`[REDACTED:DATABASE URL]`), which is the strip this option exists to
    // avoid, demonstrated on the redactor's own output.
    expect(notification.content).toContain("[REDACTED:DATABASE_URL]");
    expect(notification.content).not.toContain(blocked);
    expect(notification.preview).toContain("[REDACTED:DATABASE URL]");
  });
});
