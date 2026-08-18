import { describe, expect, test } from "bun:test";
import { conversationsCloudEnv, resolveConversationsCloud } from "./index.js";

// -- Transport resolution by the API env pair --------------------------------
//
// Client transport is selected by the API env pair alone (owner directive
// 2026-07-29; knowledge k_ms5wv466_u0jidq):
//
//   both HASNA_CONVERSATIONS_API_URL + HASNA_CONVERSATIONS_API_KEY set  -> HTTP API
//   neither set                                                          -> local SQLite
//   exactly one set                                                      -> THROW naming the missing var
//
// The server backend switch (`sqlite | postgresql`) is a server-side concern
// selected by HASNA_CONVERSATIONS_DATABASE_URL.

const CLOUD_ENV = {
  HASNA_CONVERSATIONS_API_URL: "https://conversations.hasna.xyz",
  HASNA_CONVERSATIONS_API_KEY: "hasna_conversations_testkey_00000000",
};

describe("transport resolution — API pair presence", () => {
  test("(a) API url + key present => HTTP client", () => {
    const env = conversationsCloudEnv({ ...CLOUD_ENV });

    expect(resolveConversationsCloud(env)).not.toBeNull();
  });

  test("(b) neither API url nor key => local, no client", () => {
    const env = conversationsCloudEnv({});

    expect(resolveConversationsCloud(env)).toBeNull();
  });

  test("(c) exactly one of the pair => throws naming the missing variable", () => {
    expect(() => conversationsCloudEnv({ HASNA_CONVERSATIONS_API_URL: CLOUD_ENV.HASNA_CONVERSATIONS_API_URL }))
      .toThrow(/HASNA_CONVERSATIONS_API_KEY/);
    expect(() => conversationsCloudEnv({ HASNA_CONVERSATIONS_API_KEY: CLOUD_ENV.HASNA_CONVERSATIONS_API_KEY }))
      .toThrow(/HASNA_CONVERSATIONS_API_URL/);
  });

  test("a local DB path forces local without emitting anything else", () => {
    const env = conversationsCloudEnv({
      ...CLOUD_ENV,
      HASNA_CONVERSATIONS_DB_PATH: "/tmp/conversations-env-selection.db",
    });

    expect(resolveConversationsCloud(env)).toBeNull();
    expect(env.HASNA_CONVERSATIONS_API_URL).toBeUndefined();
    expect(env.HASNA_CONVERSATIONS_API_KEY).toBeUndefined();
    expect(env.HASNA_CONVERSATIONS_DB_PATH).toBe("/tmp/conversations-env-selection.db");
  });
});
