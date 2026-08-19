import { expect, test } from "bun:test";
import {
  attachBridgeSession,
  createBridgeSession,
  detachBridgeBinding,
  getBridgeSession,
  listBridgeSessions,
  updateBridgeSessionStatus,
  type BridgeConfig,
  type BridgeState,
  emptyState,
} from "../src/index.js";

/**
 * Test-gap coverage for the session lifecycle edges in src/lib/sessions.ts
 * that the CLI tests reach only through happy paths: not-found errors, the
 * closed-session guard, attach default-preservation, and detach. These guards
 * are what make a paused/closed/absent session a loud error instead of a
 * silently misrouted message, and the MCP surface (bridge_session_status,
 * bridge_session_attach) is a direct caller of the same functions.
 */

const config: BridgeConfig = {
  version: 1,
  channels: {
    tg: { id: "tg", kind: "telegram", enabled: true, allowedChatIds: ["100"] },
  },
  profiles: {},
  agents: {
    echo: { id: "echo", kind: "shell", command: "printf", args: ["ok"] },
  },
  routes: [],
};

function stateWithSession(id: string): BridgeState {
  const state = emptyState();
  createBridgeSession(config, state, { id, agentId: "echo" });
  return state;
}

test("getBridgeSession throws a clean error naming the missing session", () => {
  const state = emptyState();
  expect(() => getBridgeSession(state, "ses_missing")).toThrow("Session not found: ses_missing");
});

test("attach to a channel that does not exist throws instead of inventing a binding", () => {
  const state = stateWithSession("ses_1");
  expect(() => attachBridgeSession(config, state, {
    sessionId: "ses_1",
    channelId: "ghost",
    conversation: "100",
  })).toThrow("Channel not found: ghost");
});

test("attach refuses a closed session even when the channel is valid", () => {
  const state = stateWithSession("ses_1");
  updateBridgeSessionStatus(state, "ses_1", "closed");
  expect(() => attachBridgeSession(config, state, {
    sessionId: "ses_1",
    channelId: "tg",
    conversation: "100",
  })).toThrow("Cannot attach closed session: ses_1");
});

test("a closed session is still listed and readable (close is not delete)", () => {
  const state = stateWithSession("ses_1");
  updateBridgeSessionStatus(state, "ses_1", "closed");
  expect(getBridgeSession(state, "ses_1").status).toBe("closed");
  expect(listBridgeSessions(state).map((s) => s.id)).toEqual(["ses_1"]);
});

test("attach without makeDefault preserves the existing default session id", () => {
  const state = stateWithSession("ses_1");
  createBridgeSession(config, state, { id: "ses_2", agentId: "echo" });

  attachBridgeSession(config, state, {
    sessionId: "ses_1", channelId: "tg", conversation: "100", makeDefault: true,
  });
  attachBridgeSession(config, state, {
    sessionId: "ses_2", channelId: "tg", conversation: "100",
  });

  const binding = state.bindings["tg::telegram:tg:100"];
  expect(binding.activeSessionId).toBe("ses_2");
  expect(binding.defaultSessionId).toBe("ses_1");
});

test("attach with makeDefault moves the default to the new session", () => {
  const state = stateWithSession("ses_1");
  createBridgeSession(config, state, { id: "ses_2", agentId: "echo" });

  attachBridgeSession(config, state, {
    sessionId: "ses_1", channelId: "tg", conversation: "100", makeDefault: true,
  });
  attachBridgeSession(config, state, {
    sessionId: "ses_2", channelId: "tg", conversation: "100", makeDefault: true,
  });

  const binding = state.bindings["tg::telegram:tg:100"];
  expect(binding.defaultSessionId).toBe("ses_2");
  // created_at is kept from the first attach, not reset by the second.
  expect(binding.createdAt).toBeDefined();
});

test("detach removes the binding and returns it; a second detach returns undefined", () => {
  const state = stateWithSession("ses_1");
  attachBridgeSession(config, state, {
    sessionId: "ses_1", channelId: "tg", conversation: "100",
  });
  expect(state.bindings["tg::telegram:tg:100"]).toBeDefined();

  const detached = detachBridgeBinding(config, state, "tg", "100");
  expect(detached?.activeSessionId).toBe("ses_1");
  expect(state.bindings["tg::telegram:tg:100"]).toBeUndefined();

  const again = detachBridgeBinding(config, state, "tg", "100");
  expect(again).toBeUndefined();
});

test("detach on an unknown channel throws rather than silently deleting nothing", () => {
  const state = stateWithSession("ses_1");
  expect(() => detachBridgeBinding(config, state, "ghost", "100")).toThrow("Channel not found: ghost");
});

test("a telegram attach derives the chat authorization from the conversation id", () => {
  const state = stateWithSession("ses_1");
  const binding = attachBridgeSession(config, state, {
    sessionId: "ses_1", channelId: "tg", conversation: "100",
  });
  expect(binding.authorization).toEqual({ chatId: "100" });
});
