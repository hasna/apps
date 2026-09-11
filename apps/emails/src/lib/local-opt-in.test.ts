// The local opt-in is answered from the environment dictionary and from nothing
// else: these tests hand in plain objects and never touch process.env, the
// Keychain or the filesystem — which is the property the module exists to give.

import { describe, expect, it } from "bun:test";
import {
  EMAILS_LOCAL_OPT_IN_ENV,
  EMAILS_LOCAL_OPT_IN_ENV_KEYS,
  configuredEmailsAuthorityEnvKeys,
  emailsAuthorityEnvKeys,
  emailsLocalOptInSetting,
  hasEmailsEnvAuthorityIntent,
  isEmailsLocalOptIn,
  selectsEmailsLocalMode,
} from "./local-opt-in.js";

describe("the standard local opt-in for emails", () => {
  it("spells the standard names, canonical first", () => {
    expect([...EMAILS_LOCAL_OPT_IN_ENV_KEYS]).toEqual(["HASNA_EMAILS_LOCAL", "EMAILS_LOCAL"]);
    expect(EMAILS_LOCAL_OPT_IN_ENV).toBe("HASNA_EMAILS_LOCAL");
  });

  it("is set by either spelling and never by a blank", () => {
    expect(isEmailsLocalOptIn({})).toBe(false);
    expect(isEmailsLocalOptIn({ HASNA_EMAILS_LOCAL: "1" })).toBe(true);
    expect(isEmailsLocalOptIn({ EMAILS_LOCAL: "yes" })).toBe(true);
    expect(isEmailsLocalOptIn({ HASNA_EMAILS_LOCAL: "   " })).toBe(false);
    expect(emailsLocalOptInSetting({ EMAILS_LOCAL: "1" })).toBe("EMAILS_LOCAL");
    expect(emailsLocalOptInSetting({ EMAILS_LOCAL: "1", HASNA_EMAILS_LOCAL: "1" })).toBe("HASNA_EMAILS_LOCAL");
    expect(emailsLocalOptInSetting({})).toBeNull();
  });

  it("derives the authority names from the shared resolver plus the app's own principals", () => {
    const keys = emailsAuthorityEnvKeys();
    for (const expected of [
      "HASNA_EMAILS_API_URL",
      "HASNA_EMAILS_API_KEY",
      "HASNA_EMAILS_API_KEY_OVERRIDE",
      "HASNA_EMAILS_API_KEY_REF",
      "HASNA_PROFILE",
      "EMAILS_SESSION_TOKEN",
      "EMAILS_IDP_TOKEN",
    ]) {
      expect(keys, expected).toContain(expected);
    }
    // The retired aliases are not authority names here or anywhere else.
    expect(keys).not.toContain("EMAILS_SELF_HOSTED_URL");
    expect(keys).not.toContain("EMAILS_SELF_HOSTED_API_KEY");
    // A database path is a location, not an authority.
    expect(keys).not.toContain("HASNA_EMAILS_DB_PATH");
  });

  it("a configured environment outranks the flag; a clean environment honours it", () => {
    expect(selectsEmailsLocalMode({ HASNA_EMAILS_LOCAL: "1" })).toBe(true);
    expect(selectsEmailsLocalMode({ HASNA_EMAILS_LOCAL: "1", HASNA_EMAILS_DB_PATH: "/tmp/x.db" })).toBe(true);
    expect(selectsEmailsLocalMode({ HASNA_EMAILS_LOCAL: "1", HASNA_EMAILS_API_KEY: "k" })).toBe(false);
    expect(selectsEmailsLocalMode({ HASNA_EMAILS_LOCAL: "1", EMAILS_API_URL: "https://x.example" })).toBe(false);
    expect(selectsEmailsLocalMode({ HASNA_EMAILS_LOCAL: "1", EMAILS_SESSION_TOKEN: "emss" })).toBe(false);
    expect(selectsEmailsLocalMode({ HASNA_EMAILS_LOCAL: "1", HASNA_PROFILE: "work" })).toBe(false);
    // Blank authority values are "not configured".
    expect(selectsEmailsLocalMode({ HASNA_EMAILS_LOCAL: "1", HASNA_EMAILS_API_KEY: "  " })).toBe(true);
    // No flag → never local, whatever else is set.
    expect(selectsEmailsLocalMode({})).toBe(false);
    expect(selectsEmailsLocalMode({ HASNA_EMAILS_DB_PATH: "/tmp/x.db" })).toBe(false);
  });

  it("names exactly the configured authority keys, in resolver order, never values", () => {
    const configured = configuredEmailsAuthorityEnvKeys({
      EMAILS_IDP_TOKEN: "emid",
      HASNA_EMAILS_API_KEY: "k",
      HASNA_EMAILS_API_URL: "",
    });
    expect(configured).toEqual(["HASNA_EMAILS_API_KEY", "EMAILS_IDP_TOKEN"]);
    expect(hasEmailsEnvAuthorityIntent({})).toBe(false);
    expect(hasEmailsEnvAuthorityIntent({ HASNA_EMAILS_API_URL: "https://x.example" })).toBe(true);
  });
});
