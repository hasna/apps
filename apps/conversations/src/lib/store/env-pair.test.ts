import { describe, expect, test } from "bun:test";
import { conversationsCloudEnv, resolveConversationsCloud } from "./index.js";

const CLOUD_ENV = {
  HASNA_CONVERSATIONS_API_URL: "https://conversations.hasna.xyz",
  HASNA_CONVERSATIONS_API_KEY: "hasna_conversations_testkey_00000000",
};

describe("conversationsCloudEnv", () => {
  test("API url + key present => env unchanged, no extra variable invented", () => {
    const env = conversationsCloudEnv({ ...CLOUD_ENV });
    expect(env.HASNA_CONVERSATIONS_API_URL).toBe(CLOUD_ENV.HASNA_CONVERSATIONS_API_URL);
    expect(env.HASNA_CONVERSATIONS_API_KEY).toBe(CLOUD_ENV.HASNA_CONVERSATIONS_API_KEY);
    expect(resolveConversationsCloud(env)).not.toBeNull();
  });

  test("half the API pair throws, naming the missing variable", () => {
    expect(() =>
      conversationsCloudEnv({ HASNA_CONVERSATIONS_API_URL: CLOUD_ENV.HASNA_CONVERSATIONS_API_URL }),
    ).toThrow(/HASNA_CONVERSATIONS_API_KEY/);
    expect(() =>
      conversationsCloudEnv({ HASNA_CONVERSATIONS_API_KEY: CLOUD_ENV.HASNA_CONVERSATIONS_API_KEY }),
    ).toThrow(/HASNA_CONVERSATIONS_API_URL/);
  });

  test("local DB path overrides inherited API routing and strips the credentials", () => {
    const env = conversationsCloudEnv({
      ...CLOUD_ENV,
      CONVERSATIONS_DB_PATH: "/tmp/conversations-test.db",
    });
    expect(env.HASNA_CONVERSATIONS_API_URL).toBeUndefined();
    expect(env.HASNA_CONVERSATIONS_API_KEY).toBeUndefined();
    expect(resolveConversationsCloud(env)).toBeNull();
  });

  test("no url/key and no store path refuses instead of selecting local (fail closed, 2026-09-04)", () => {
    expect(() => conversationsCloudEnv({})).toThrow(/HASNA_CONVERSATIONS_API_URL/);
    expect(() => conversationsCloudEnv({})).toThrow(/HASNA_CONVERSATIONS_API_KEY/);
  });

  test("an explicit store path is the ONLY no-API route to local", () => {
    const env = conversationsCloudEnv({ CONVERSATIONS_DB_PATH: "/tmp/conversations-test.db" });
    expect(resolveConversationsCloud(env)).toBeNull();
  });
});
