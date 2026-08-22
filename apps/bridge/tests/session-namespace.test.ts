import { expect, test } from "bun:test";
import {
  bindingId,
  messageConversationId,
  normalizeConversationId,
  type BridgeConfig,
  type ChannelConfig,
} from "../src/index.js";

/**
 * Test-gap coverage for the conversation-namespace helpers in
 * src/lib/sessions.ts (normalizeConversationId :133, messageConversationId
 * :140, bindingId :154). These produce the exact keys the session binding map
 * and the message ledger are keyed by: a shape change here silently orphans
 * every existing binding on a config upgrade, and a collision silently merges
 * two conversations into one thread. The pre-existing suite exercised the
 * shapes indirectly through the CLI, but never locked the pure functions
 * themselves — the contract below is what the indirect tests depend on.
 */

const tg: ChannelConfig = { id: "tg", kind: "telegram", enabled: true };
const im: ChannelConfig = { id: "im", kind: "imessage", enabled: true };
const local: ChannelConfig = { id: "local", kind: "console", enabled: true };
const web: ChannelConfig = { id: "web", kind: "webhook", enabled: true };

test("telegram chat id normalizes to telegram:<channel>:<chat>", () => {
  expect(normalizeConversationId(tg, "123")).toBe("telegram:tg:123");
});

test("telegram chat + forum topic composes to telegram:<channel>:<chat>:<thread>", () => {
  // The docs (docs/architecture.md) promise this exact shape.
  expect(normalizeConversationId(tg, "123:456")).toBe("telegram:tg:123:456");
});

test("a chat id that itself contains a colon is indistinguishable from chat+thread (locked shape)", () => {
  // chatId "123:456" without a separate thread produces the same id as chat
  // "123" with thread "456". That is the current contract: a colon-bearing
  // chat id cannot be told apart, and both resolve to the same binding. Locking
  // the shape so a future change to it is a visible decision, not a silent one.
  expect(normalizeConversationId(tg, "123:456")).toBe("telegram:tg:123:456");
});

test("an already-namespaced conversation passes through unchanged (idempotent)", () => {
  expect(normalizeConversationId(tg, "telegram:tg:123")).toBe("telegram:tg:123");
});

test("a foreign-channel id of the same kind passes through unchanged (locked quirk)", () => {
  // The guard checks only the kind prefix, not the channel id: an id
  // "telegram:other:1" handed to channel tg is returned as-is, so it keys a
  // binding that no inbound telegram message from tg can ever produce. The CLI
  // attach path accepts arbitrary --conversation text, so this is reachable by
  // operator input. The behavior is locked, not fixed: silently rewriting it
  // would orphan a binding an operator may have created deliberately.
  expect(normalizeConversationId(tg, "telegram:other:1")).toBe("telegram:other:1");
});

test("a foreign-kind id is wrapped, not passed through", () => {
  // A console channel has no reason to see a telegram id; the console branch
  // wraps it into its own namespace.
  expect(normalizeConversationId(local, "telegram:tg:1")).toBe("console:local:telegram:tg:1");
});

test("imessage conversations normalize to imessage:<channel>:<handle>", () => {
  expect(normalizeConversationId(im, "+15555550100")).toBe("imessage:im:+15555550100");
});

test("console and webhook conversations with no text default to ':default'", () => {
  expect(normalizeConversationId(local, "")).toBe("console:local:default");
  expect(normalizeConversationId(web, "")).toBe("webhook:web:default");
});

test("telegram with an empty conversation keeps the bare namespace (locked shape)", () => {
  // Telegram never receives an empty conversation from inbound messages
  // (messageConversationId requires chatId), but the direct call produces
  // "telegram:tg:" — trailing colon, no default. Locked so a later "fix" to
  // append "default" here cannot silently change binding keys.
  expect(normalizeConversationId(tg, "")).toBe("telegram:tg:");
});

test("messageConversationId returns undefined for an unknown channel", () => {
  const config: BridgeConfig = { version: 1, channels: {}, profiles: {}, agents: {}, routes: [] };
  expect(messageConversationId(config, {
    id: "m", channelId: "ghost", text: "x", receivedAt: new Date(0).toISOString(),
  })).toBeUndefined();
});

test("messageConversationId requires a chat id on telegram", () => {
  const config: BridgeConfig = {
    version: 1, channels: { tg }, profiles: {}, agents: {}, routes: [],
  };
  expect(messageConversationId(config, {
    id: "m", channelId: "tg", text: "x", receivedAt: new Date(0).toISOString(),
  })).toBeUndefined();
});

test("messageConversationId composes telegram chat and thread ids", () => {
  const config: BridgeConfig = {
    version: 1, channels: { tg }, profiles: {}, agents: {}, routes: [],
  };
  expect(messageConversationId(config, {
    id: "m", channelId: "tg", chatId: "123", threadId: "456", text: "x",
    receivedAt: new Date(0).toISOString(),
  })).toBe("telegram:tg:123:456");
});

test("messageConversationId falls back chat -> from -> default on console", () => {
  const config: BridgeConfig = {
    version: 1, channels: { local }, profiles: {}, agents: {}, routes: [],
  };
  const base = { id: "m", channelId: "local", text: "x", receivedAt: new Date(0).toISOString() };
  expect(messageConversationId(config, { ...base, chatId: "chat-1" })).toBe("console:local:chat-1");
  expect(messageConversationId(config, { ...base, from: "sender" })).toBe("console:local:sender");
  expect(messageConversationId(config, base)).toBe("console:local:default");
});

test("messageConversationId on imessage uses chat or from, and undefined without either", () => {
  const config: BridgeConfig = {
    version: 1, channels: { im }, profiles: {}, agents: {}, routes: [],
  };
  const base = { id: "m", channelId: "im", text: "x", receivedAt: new Date(0).toISOString() };
  expect(messageConversationId(config, { ...base, chatId: "chat:123" })).toBe("imessage:im:chat:123");
  expect(messageConversationId(config, { ...base, from: "+15555550100" })).toBe("imessage:im:+15555550100");
  expect(messageConversationId(config, base)).toBeUndefined();
});

test("bindingId joins channel and conversation with :: and is order-sensitive", () => {
  expect(bindingId("tg", "telegram:tg:123")).toBe("tg::telegram:tg:123");
  // A swapped argument pair must NOT produce the same key: bindings key on
  // channel first, conversation second, and the join is not symmetric.
  expect(bindingId("telegram:tg:123", "tg")).not.toBe(bindingId("tg", "telegram:tg:123"));
});
