/**
 * Fail-closed transport resolution tests for the ./sdk client surface.
 *
 * Contract (fleet storage doctrine): a missing HASNA_MESSAGES_API_URL is
 * NEVER a silent selection of the on-box SQLite store. The resolver returns
 * "http" when the API URL is present, "local" only under the explicit
 * HASNA_MESSAGES_LOCAL=1 opt-in, and otherwise THROWS an actionable error
 * naming the required env. All cases inject env records — nothing here reads
 * or mutates the real process environment.
 */
import { describe, expect, test } from "bun:test";
import {
  MESSAGES_API_KEY_ENV,
  MESSAGES_API_URL_ENV,
  MESSAGES_LOCAL_MODE_ENV,
  createMessagesClient,
  isLocalModeOptIn,
  resolveMessagesClientTransport,
} from "./index.js";

function envWith(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  return { [MESSAGES_API_URL_ENV]: undefined, [MESSAGES_API_KEY_ENV]: undefined, [MESSAGES_LOCAL_MODE_ENV]: undefined, ...overrides };
}

describe("resolveMessagesClientTransport fails closed", () => {
  test("API URL present selects http (no local opt-in needed)", () => {
    const report = resolveMessagesClientTransport(envWith({ [MESSAGES_API_URL_ENV]: "https://messages.example.com" }));
    expect(report.transport).toBe("http");
    expect(report.apiUrlPresent).toBe(true);
  });

  test("no API URL and no local opt-in THROWS an error naming the required env and the opt-in", () => {
    expect(() => resolveMessagesClientTransport(envWith({}))).toThrow(/HASNA_MESSAGES_API_URL/);
    expect(() => resolveMessagesClientTransport(envWith({}))).toThrow(/HASNA_MESSAGES_LOCAL=1/);
  });

  test("HASNA_MESSAGES_LOCAL=1 selects local without any API URL", () => {
    const report = resolveMessagesClientTransport(envWith({ [MESSAGES_LOCAL_MODE_ENV]: "1" }));
    expect(report.transport).toBe("local");
    expect(report.apiUrlPresent).toBe(false);
  });

  test("falsy opt-in values (0, false, no, off, blank) do not open local mode", () => {
    for (const value of ["0", "false", "no", "off", ""]) {
      expect(isLocalModeOptIn(envWith({ [MESSAGES_LOCAL_MODE_ENV]: value }))).toBe(false);
      expect(() => resolveMessagesClientTransport(envWith({ [MESSAGES_LOCAL_MODE_ENV]: value }))).toThrow(/HASNA_MESSAGES_API_URL/);
    }
  });

  test("truthy opt-in spellings all open local mode", () => {
    for (const value of ["1", "true", "yes", " 1 "]) {
      expect(isLocalModeOptIn(envWith({ [MESSAGES_LOCAL_MODE_ENV]: value }))).toBe(true);
    }
  });

  test("createMessagesClient follows the same gate: URL -> client, opt-in local -> null, neither -> throw", () => {
    const client = createMessagesClient(envWith({ [MESSAGES_API_URL_ENV]: "https://messages.example.com/" }));
    expect(client).not.toBeNull();
    expect(createMessagesClient(envWith({ [MESSAGES_LOCAL_MODE_ENV]: "1" }))).toBeNull();
    expect(() => createMessagesClient(envWith({}))).toThrow(/HASNA_MESSAGES_API_URL/);
  });

  test("an API key alone never selects a transport", () => {
    expect(() => resolveMessagesClientTransport(envWith({ [MESSAGES_API_KEY_ENV]: "k" }))).toThrow(/HASNA_MESSAGES_API_URL/);
  });
});
