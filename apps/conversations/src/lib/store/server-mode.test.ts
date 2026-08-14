import { describe, expect, test } from "bun:test";
import {
  assertNoLegacyStorageMode,
  conversationsCloudEnv,
  resolveConversationsCloud,
  ConversationsStoreConfigError,
} from "./index.js";

// -- Transport resolution after the deployment-mode removal -------------------
//
// Deployment modes no longer exist (owner directive 2026-07-29; knowledge
// k_ms5wv466_u0jidq). Client transport is selected by the API env pair alone:
//
//   both HASNA_CONVERSATIONS_API_URL + HASNA_CONVERSATIONS_API_KEY set  -> HTTP API
//   neither set                                                          -> local SQLite
//   exactly one set                                                      -> THROW naming the missing var
//   any retired *STORAGE_MODE / *MODE variable SET (even blank)          -> THROW naming the var
//
// The former SERVER_MODE_CANDIDATES probe (`["postgres", "self_hosted", "cloud"]`)
// is gone: there is no server-mode token for a client to infer, and `self_hosted`
// is dead vocabulary. The server backend switch (`sqlite | postgresql`) is a
// server-side concern selected by HASNA_CONVERSATIONS_DATABASE_URL.

const CLOUD_ENV = {
  HASNA_CONVERSATIONS_API_URL: "https://conversations.hasna.xyz",
  HASNA_CONVERSATIONS_API_KEY: "hasna_conversations_testkey_00000000",
};

describe("transport resolution — API pair presence", () => {
  test("(a) API url + key present => HTTP client", () => {
    const env = conversationsCloudEnv({ ...CLOUD_ENV });

    expect(resolveConversationsCloud(env)).not.toBeNull();
    expect(env.HASNA_CONVERSATIONS_STORAGE_MODE).toBeUndefined();
    expect(env.CONVERSATIONS_STORAGE_MODE).toBeUndefined();
  });

  test("(b) neither API url nor key => local, no client", () => {
    const env = conversationsCloudEnv({});

    expect(resolveConversationsCloud(env)).toBeNull();
    expect(env.HASNA_CONVERSATIONS_STORAGE_MODE).toBeUndefined();
  });

  test("(c) exactly one of the pair => throws naming the missing variable", () => {
    expect(() => conversationsCloudEnv({ HASNA_CONVERSATIONS_API_URL: CLOUD_ENV.HASNA_CONVERSATIONS_API_URL }))
      .toThrow(/HASNA_CONVERSATIONS_API_KEY/);
    expect(() => conversationsCloudEnv({ HASNA_CONVERSATIONS_API_KEY: CLOUD_ENV.HASNA_CONVERSATIONS_API_KEY }))
      .toThrow(/HASNA_CONVERSATIONS_API_URL/);
  });

  test("(d) HASNA_CONVERSATIONS_STORAGE_MODE set => throws naming the variable", () => {
    const err = () => assertNoLegacyStorageMode({ HASNA_CONVERSATIONS_STORAGE_MODE: "cloud" });
    expect(err).toThrow(ConversationsStoreConfigError);
    expect(err).toThrow(/HASNA_CONVERSATIONS_STORAGE_MODE/);
    // ...and the ratchet fires even for a blank leftover value.
    expect(() => assertNoLegacyStorageMode({ HASNA_CONVERSATIONS_STORAGE_MODE: "" })).toThrow(
      /HASNA_CONVERSATIONS_STORAGE_MODE/,
    );
  });

  test("every retired selector key is rejected by name, even beside a valid pair", () => {
    for (const key of [
      "HASNA_CONVERSATIONS_STORAGE_MODE",
      "HASNA_CONVERSATIONS_MODE",
      "CONVERSATIONS_STORAGE_MODE",
      "CONVERSATIONS_MODE",
    ]) {
      expect(() => conversationsCloudEnv({ ...CLOUD_ENV, [key]: "local" })).toThrow(new RegExp(key));
    }
  });

  test("a local DB path forces local without emitting any mode variable", () => {
    const env = conversationsCloudEnv({
      ...CLOUD_ENV,
      HASNA_CONVERSATIONS_DB_PATH: "/tmp/conversations-mode-removal.db",
    });

    expect(resolveConversationsCloud(env)).toBeNull();
    expect(env.HASNA_CONVERSATIONS_STORAGE_MODE).toBeUndefined();
    expect(env.HASNA_CONVERSATIONS_API_URL).toBeUndefined();
    expect(env.HASNA_CONVERSATIONS_API_KEY).toBeUndefined();
    expect(env.HASNA_CONVERSATIONS_DB_PATH).toBe("/tmp/conversations-mode-removal.db");
  });
});
