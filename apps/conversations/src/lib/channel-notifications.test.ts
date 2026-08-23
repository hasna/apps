import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "./db";
import { getMessageById, sendMessage } from "./messages";
import { createChannel } from "./channels";
import { registerAgent } from "./presence";
import { baselineChannelNotifications, buildMessagePreview, listChannelNotificationSubscriptions, markAllChannelNotificationsRead, markChannelNotificationsRead, readChannelNotifications as readChannelNotificationPage, subscribeToChannelNotifications, unsubscribeFromChannelNotifications } from "./channel-notifications";
import type { ReadChannelNotificationsOptions } from "./channel-notifications";

const readChannelNotifications = (opts: ReadChannelNotificationsOptions) =>
  readChannelNotificationPage(opts).notifications;
import { pinStoreToDb, restoreStoreEnv } from "./store/isolated-test-env.js";

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
  pinStoreToDb(TEST_DB);
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
  restoreStoreEnv();
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
    expect(notifications[0].preview).toContain("[REDACTED:DATABASE_URL]");
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

  test("marks ALL unread notifications read across multiple pages", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");

    // 300 unread notifications exceed the 100-notification page cap, so the
    // legacy paging loop had to cross page boundaries while mutating the
    // unread filter — each round silently skipped one page (ids 101..200
    // stayed unread forever). The set-based replacement must mark all 300.
    for (let index = 0; index < 300; index++) {
      sendMessage({
        from: index % 2 === 0 ? "alice" : "bob",
        to: "ops",
        channel: "ops",
        session_id: "channel:ops",
        content: `notification ${index}`,
      });
    }
    expect(readChannelNotifications({ agent: "agent-a", limit: 100, max_bytes: 65_536 })).toHaveLength(100);

    expect(markAllChannelNotificationsRead("agent-a", "ops")).toBe(300);
    expect(readChannelNotifications({ agent: "agent-a" })).toHaveLength(0);
    expect(readChannelNotifications({ agent: "agent-a", channel: "ops" })).toHaveLength(0);
  });

  test("an explicit empty channel is rejected, never widened to all channels", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");

    const one = sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: "first notification" });
    const two = sendMessage({ from: "bob", to: "ops", channel: "ops", session_id: "channel:ops", content: "second notification" });

    // The legacy paging loop refused "" through readChannelNotifications
    // ("channel must be a non-empty string"). The set-based replacement must
    // keep that contract: "" must throw and must not mark anything.
    expect(() => markAllChannelNotificationsRead("agent-a", "")).toThrow("channel must be a non-empty string");
    expect(() => markAllChannelNotificationsRead("agent-a", "   ")).toThrow("channel must be a non-empty string");
    expect(readChannelNotifications({ agent: "agent-a" })).toHaveLength(2);

    // undefined still means "all channels" — the intended mark-all path.
    expect(markAllChannelNotificationsRead("agent-a", undefined)).toBe(2);
    expect(readChannelNotifications({ agent: "agent-a" })).toHaveLength(0);
    void one;
    void two;
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

  test("atomic arm-time baseline leaves later notifications unread", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");

    const prearm = sendMessage({
      from: "alice",
      to: "ops",
      channel: "ops",
      session_id: "channel:ops",
      content: "pre-arm",
    });
    expect(baselineChannelNotifications("agent-a")).toBe(1);

    const live = sendMessage({
      from: "bob",
      to: "ops",
      channel: "ops",
      session_id: "channel:ops",
      content: "post-arm",
    });
    const unread = readChannelNotifications({ agent: "agent-a" });

    expect(unread.map((row) => row.message_id)).toEqual([live.id]);
    expect(unread.map((row) => row.message_id)).not.toContain(prearm.id);
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
 * The identifier loss is REAL and is the accepted cost of the boundary. A
 * collection read is not the place to recover it: the exact-message-ID detail
 * route (`getMessageById` / `conversations show <id>`) is, and these assert that
 * no collection option re-opens the body.
 */
describe("readChannelNotifications is preview-only", () => {
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

  test("no notification in a page carries a body field", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");
    sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: IDENTIFIERS });

    const page = readChannelNotificationPage({ agent: "agent-a" });
    for (const notification of page.notifications) {
      expect(Object.keys(notification)).not.toContain("content");
    }
  });

  /**
   * The load-bearing one. `include_content` used to make this route return the
   * stored body for every row in the page. Passing it must now be rejected
   * rather than silently honoured, so a stale caller fails loudly instead of
   * quietly receiving bodies it is no longer entitled to.
   */
  test("a legacy include_content request is refused, not honoured", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");
    sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: IDENTIFIERS });

    expect(() => readChannelNotificationPage({ agent: "agent-a", include_content: true } as never))
      .toThrow(/include_content is not supported/);
  });

  test("the preview cap still bounds a long body and never leaks past it", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a", { preview_chars: 20 });
    const long = `start-of-body ${"x".repeat(300)} end-of-body`;
    sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: long });

    const [notification] = readChannelNotifications({ agent: "agent-a" });
    expect(notification.preview).toContain("…");
    expect(notification.preview.length).toBeLessThan(40);
    expect(notification.preview).not.toContain("end-of-body");
    expect(JSON.stringify(notification)).not.toContain("end-of-body");
  });

  test("previews for incident and security scopes carry the real bounded preview with content-safety redaction", () => {
    createChannel("incident-response", "creator");
    subscribeToChannelNotifications("incident-response", "agent-a");
    const term = "containment-plan-alpha";
    const syntheticPat = `${"ghp" + "_" + "z".repeat(24)}`;
    insertLegacyChannelMessage("incident-response", `restricted ${term} ${syntheticPat}`);

    const [notification] = readChannelNotifications({ agent: "agent-a" });
    expect(notification.preview).toContain("restricted");
    // Notification previews normalize hyphens out of the text by design.
    expect(notification.preview).toContain(term.replaceAll("-", " "));
    expect(notification.preview).toContain("[REDACTED:PAT]");
    expect(JSON.stringify(notification)).toContain(term.replaceAll("-", " "));
    expect(JSON.stringify(notification)).not.toContain(syntheticPat);
  });

  test("the preview redacts on the same terms the detail route does", () => {
    const blocked = syntheticDatabaseUrl();
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");

    insertLegacyChannelMessage("ops", `legacy DSN ${blocked}`);
    const [notification] = readChannelNotifications({ agent: "agent-a" });

    expect(notification.preview).toContain("[REDACTED:DATABASE_URL]");
    expect(JSON.stringify(notification)).not.toContain(blocked);
  });

  /**
   * The replacement route. Losing `include_content` must not lose the operator's
   * ability to recover an identifier — it moves that recovery behind an exact id.
   */
  test("the exact-message-ID detail route still returns the intact body", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "agent-a");
    sendMessage({ from: "alice", to: "ops", channel: "ops", session_id: "channel:ops", content: IDENTIFIERS });

    const [notification] = readChannelNotifications({ agent: "agent-a" });
    const detail = getMessageById(notification.message_id);
    expect(detail?.content).toBe(IDENTIFIERS);
    expect(detail?.content).toContain("agent-chief-staff");
    expect(detail?.content).toContain("hasnaxyz/iapp-infra#92");
  });
});
