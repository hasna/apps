import { describe, expect, test } from "bun:test";
import { conversationsCloudEnv, resolveConversationsCloud } from "./index.js";

const CLOUD_ENV = {
  HASNA_CONVERSATIONS_API_URL: "https://conversations.hasna.xyz",
  HASNA_CONVERSATIONS_API_KEY: "hasna_conversations_testkey_00000000",
};

describe("conversationsCloudEnv", () => {
  test("implies self_hosted when API url + key present and no mode", () => {
    expect(conversationsCloudEnv({ ...CLOUD_ENV }).HASNA_CONVERSATIONS_STORAGE_MODE).toBe("self_hosted");
  });

  test("respects an explicit local mode", () => {
    const env = conversationsCloudEnv({ ...CLOUD_ENV, HASNA_CONVERSATIONS_STORAGE_MODE: "local" });
    expect(env.HASNA_CONVERSATIONS_STORAGE_MODE).toBe("local");
  });

  test("local DB path overrides inherited cloud routing", () => {
    const env = conversationsCloudEnv({
      ...CLOUD_ENV,
      HASNA_CONVERSATIONS_STORAGE_MODE: "cloud",
      CONVERSATIONS_DB_PATH: "/tmp/conversations-test.db",
    });
    expect(env.HASNA_CONVERSATIONS_STORAGE_MODE).toBe("local");
    expect(resolveConversationsCloud(env)).toBeNull();
  });

  test("no-op without url/key", () => {
    expect(conversationsCloudEnv({}).HASNA_CONVERSATIONS_STORAGE_MODE).toBeUndefined();
  });
});
