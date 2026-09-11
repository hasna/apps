import { describe, expect, test } from "bun:test";
import { conversationsCloudEnv, resolveConversationsCloud } from "./index.js";

// Ordinary clients resolve shared credentials and reject retired database selectors.

const CLOUD_ENV = {
  HASNA_CONVERSATIONS_API_URL: "https://conversations.hasna.xyz",
  HASNA_CONVERSATIONS_API_KEY: "hasna_conversations_testkey_00000000",
};

describe("transport resolution — API pair presence", () => {
  test("(a) API url + key present => HTTP client", () => {
    const env = conversationsCloudEnv({ ...CLOUD_ENV });

    expect(resolveConversationsCloud(env)).not.toBeNull();
  });

  test("(b) neither API url nor key, and no explicit store path => refuses naming both vars", () => {
    expect(() => conversationsCloudEnv({})).toThrow(/HASNA_CONVERSATIONS_API_URL/);
    expect(() => conversationsCloudEnv({})).toThrow(/HASNA_CONVERSATIONS_API_KEY/);
  });

  test("(c) a URL without a key => throws naming the key tiers; a key alone => hosted via the gateway default", () => {
    expect(() => conversationsCloudEnv({ HASNA_CONVERSATIONS_API_URL: CLOUD_ENV.HASNA_CONVERSATIONS_API_URL }))
      .toThrow(/HASNA_CONVERSATIONS_API_KEY/);
    // (Owner directive 2026-09-04, hasna/apps#1720): a resolved credential is
    // enough — the authority defaults to the fleet gateway https://api.hasna.com.
    const keyOnly = conversationsCloudEnv({ HASNA_CONVERSATIONS_API_KEY: CLOUD_ENV.HASNA_CONVERSATIONS_API_KEY });
    expect(resolveConversationsCloud(keyOnly)!.baseUrl).toBe("https://api.hasna.com/conversations/v1");
  });

  test("a retired DB path is rejected even with valid API routing", () => {
    expect(() => conversationsCloudEnv({
      ...CLOUD_ENV,
      HASNA_CONVERSATIONS_DB_PATH: "/tmp/conversations-env-selection.db",
    })).toThrow(/HASNA_CONVERSATIONS_DB_PATH/);
  });
});
