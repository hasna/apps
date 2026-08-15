import { describe, expect, test } from "bun:test";
import { conversationsCloudEnv, resolveConversationsCloud } from "./index.js";

const CLOUD_ENV = {
  HASNA_CONVERSATIONS_API_URL: "https://conversations.hasna.xyz",
  HASNA_CONVERSATIONS_API_KEY: "hasna_conversations_testkey_00000000",
};

describe("conversationsCloudEnv", () => {
  test("API url + key present => env unchanged, no mode variable invented", () => {
    const env = conversationsCloudEnv({ ...CLOUD_ENV });
    expect(env.HASNA_CONVERSATIONS_API_URL).toBe(CLOUD_ENV.HASNA_CONVERSATIONS_API_URL);
    expect(env.HASNA_CONVERSATIONS_API_KEY).toBe(CLOUD_ENV.HASNA_CONVERSATIONS_API_KEY);
    expect(env.HASNA_CONVERSATIONS_STORAGE_MODE).toBeUndefined();
    expect(env.HASNA_CONVERSATIONS_MODE).toBeUndefined();
    expect(resolveConversationsCloud(env)).not.toBeNull();
  });

  test("a retired storage-mode variable throws, even beside a valid pair", () => {
    expect(() =>
      conversationsCloudEnv({ ...CLOUD_ENV, HASNA_CONVERSATIONS_STORAGE_MODE: "local" }),
    ).toThrow(/HASNA_CONVERSATIONS_STORAGE_MODE/);
    expect(() =>
      conversationsCloudEnv({ ...CLOUD_ENV, CONVERSATIONS_MODE: "cloud" }),
    ).toThrow(/CONVERSATIONS_MODE/);
  });

  test("local DB path overrides inherited API routing and strips the credentials", () => {
    const env = conversationsCloudEnv({
      ...CLOUD_ENV,
      CONVERSATIONS_DB_PATH: "/tmp/conversations-test.db",
    });
    expect(env.HASNA_CONVERSATIONS_STORAGE_MODE).toBeUndefined();
    expect(env.HASNA_CONVERSATIONS_API_URL).toBeUndefined();
    expect(env.HASNA_CONVERSATIONS_API_KEY).toBeUndefined();
    expect(resolveConversationsCloud(env)).toBeNull();
  });

  test("no-op without url/key", () => {
    const env = conversationsCloudEnv({});
    expect(env.HASNA_CONVERSATIONS_STORAGE_MODE).toBeUndefined();
    expect(resolveConversationsCloud(env)).toBeNull();
  });
});
