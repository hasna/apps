import { describe, expect, test } from "bun:test";
import type { KeychainCommandRunner } from "@hasna/contracts/client";
import { contactsAuthorityEnvKeys, contactsResolverCredentials, isAmbientContactsEnv } from "./resolver-inputs.js";

const AMBIENT = Symbol.for("hasna:contracts:ambientClientEnvironment");

function markedEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { HOME: "/nonexistent/contacts-home" };
  Object.defineProperty(env, AMBIENT, { value: true, enumerable: false });
  return env;
}

// The #1788 gate: the Keychain tier is decided on the ORIGINAL env, before any
// copy exists, and carried across as the documented `keychain.enabled` control.
describe("contacts resolver credential inputs (#1788 Keychain gate)", () => {
  test("recognises the live process environment and a resolver-marked snapshot as ambient", () => {
    expect(isAmbientContactsEnv(process.env)).toBe(true);
    expect(isAmbientContactsEnv(markedEnv())).toBe(true);
  });

  test("a copy of an ambient env is not ambient — the mark does not survive a spread", () => {
    expect(isAmbientContactsEnv({ ...process.env })).toBe(false);
    expect(isAmbientContactsEnv({ ...markedEnv() })).toBe(false);
    expect(isAmbientContactsEnv({ HOME: "/nonexistent" })).toBe(false);
  });

  test("pins the Keychain tier on for an ambient env and off for a caller-built env", () => {
    expect(contactsResolverCredentials(process.env).keychain).toEqual({ enabled: true });
    expect(contactsResolverCredentials(markedEnv()).keychain).toEqual({ enabled: true });
    expect(contactsResolverCredentials({ ...markedEnv() }).keychain).toEqual({ enabled: false });
    expect(contactsResolverCredentials({ HOME: "/nonexistent" }).keychain).toEqual({ enabled: false });
  });

  test("a caller's explicit Keychain controls always win", () => {
    expect(contactsResolverCredentials(process.env, { keychain: { enabled: false } }).keychain).toEqual({ enabled: false });
    expect(contactsResolverCredentials({ HOME: "/nonexistent" }, { keychain: { enabled: true, platform: "darwin" } }).keychain)
      .toEqual({ enabled: true, platform: "darwin" });
    const run: KeychainCommandRunner = () => ({ status: 44, stdout: "", stderr: "" });
    const withRunner = contactsResolverCredentials({ HOME: "/nonexistent" }, { keychain: { run } });
    expect(withRunner.keychain?.run).toBe(run);
    expect(withRunner.keychain?.enabled).toBeUndefined();
  });

  test("passes tier-1 arguments through untouched and never mutates the caller's options", () => {
    const options = { apiKey: "explicit-key", profile: "ops", keychain: { platform: "linux" } };
    const result = contactsResolverCredentials({ HOME: "/nonexistent" }, options);
    expect(result).toEqual({ apiKey: "explicit-key", profile: "ops", keychain: { platform: "linux", enabled: false } });
    expect(options.keychain).toEqual({ platform: "linux" });
  });

  test("names every env key the resolver may consult for the authority or credential", () => {
    const keys = contactsAuthorityEnvKeys();
    for (const expected of [
      "HASNA_CONTACTS_API_URL",
      "CONTACTS_API_URL",
      "HASNA_CONTACTS_API_KEY",
      "CONTACTS_API_KEY",
      "HASNA_CONTACTS_API_KEY_OVERRIDE",
      "HASNA_CONTACTS_API_KEY_REF",
      "HASNA_PROFILE",
    ]) {
      expect(keys).toContain(expected);
    }
  });
});
