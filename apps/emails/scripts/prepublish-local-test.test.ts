import { describe, expect, test } from "bun:test";
import { buildPrepublishTestEnv } from "./prepublish-local-test.mjs";

/**
 * Regression for O15-00516: on any machine carrying the hosted Emails API env
 * (EMAILS_SELF_HOSTED_URL / EMAILS_CLIENT_ENV_SECRET), `npm publish` in
 * apps/emails failed at the prepublish gate. prepublish-local-test.mjs forced
 * EMAILS_DB_PATH=:memory: but inherited the API env, so the suite ran with a
 * local database AND an API configured — the deliberate both-configured hard
 * boot error (src/store-resolution.ts) — and the gate exited 1.
 *
 * The scrub list must cover the whole API side the client reads
 * (src/lib/client-env.ts): the base URL, the vault pointer, and the three
 * credential keys, plus the legacy MAILERY keys.
 */
describe("prepublish-local-test environment scrub", () => {
  test("strips the hosted Emails API env so the local suite cannot resolve to an API store", () => {
    const env = buildPrepublishTestEnv({
      HOME: "/operator/home",
      EMAILS_DB_PATH: "/hosted/emails.db",
      HASNA_EMAILS_DB_PATH: "/operator/db",
      EMAILS_SELF_HOSTED_URL: "https://emails.example.test/v1",
      EMAILS_CLIENT_ENV_SECRET: "emails/live/client-env",
      EMAILS_SELF_HOSTED_API_KEY: "op-key",
      EMAILS_SESSION_TOKEN: "session-token",
      EMAILS_IDP_TOKEN: "idp-token",
      MAILERY_MODE: "cloud",
      HASNA_MAILERY_API_URL: "https://legacy.example.test/v1",
      HASNA_DATA_HOME: "/operator/data",
      HASNA_EMAILS_HOME: "/operator/emails",
      EMAILS_HOME: "/operator/emails-legacy",
      XDG_DATA_HOME: "/operator/xdg",
      EMAILS_JSON_OUTPUT: "1",
    });

    // The two keys that turn a local database AND an API into the hard boot error.
    expect(env.EMAILS_SELF_HOSTED_URL).toBeUndefined();
    expect(env.EMAILS_CLIENT_ENV_SECRET).toBeUndefined();
    // The rest of the API side the client can read — inert without the URL, but
    // a local-test environment must not carry a live operator credential at all.
    expect(env.EMAILS_SELF_HOSTED_API_KEY).toBeUndefined();
    expect(env.EMAILS_SESSION_TOKEN).toBeUndefined();
    expect(env.EMAILS_IDP_TOKEN).toBeUndefined();
    // Legacy keys keep being scrubbed.
    expect(env.MAILERY_MODE).toBeUndefined();
    expect(env.HASNA_MAILERY_API_URL).toBeUndefined();
    // The canonical DB-path key is scrubbed: getDbPath() (src/db/database.ts)
    // checks HASNA_EMAILS_DB_PATH BEFORE EMAILS_DB_PATH, so an inherited value
    // would silently select an operator database despite the :memory: below.
    expect(env.HASNA_EMAILS_DB_PATH).toBeUndefined();
    // The resolver (XDG) path variables authoritative since 1.4.10
    // (src/paths.ts) are scrubbed: an inherited value would move the suite's
    // effective data root to operator data despite the temp HOME
    // (release-review P1, publish-all lane 248f6ed8).
    expect(env.HASNA_DATA_HOME).toBeUndefined();
    expect(env.HASNA_EMAILS_HOME).toBeUndefined();
    expect(env.EMAILS_HOME).toBeUndefined();
    expect(env.XDG_DATA_HOME).toBeUndefined();
    // The local store stays forced.
    expect(env.EMAILS_MODE).toBe("local");
    expect(env.EMAILS_DB_PATH).toBe(":memory:");
    // The rest of the process env survives.
    expect(env.EMAILS_JSON_OUTPUT).toBe("1");
  });
});
