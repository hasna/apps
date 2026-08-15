import { describe, expect, test } from "bun:test";
import { assertNoLegacyStorageMode } from "./retired-storage-mode.js";

describe("assertNoLegacyStorageMode", () => {
  test.each([
    ["HASNA_ACCOUNTS_STORAGE_MODE", "cloud"],
    ["HASNA_ACCOUNTS_STORAGE_MODE", "local"],
    ["HASNA_ACCOUNTS_STORAGE_MODE", "remote"],
    ["HASNA_ACCOUNTS_STORAGE_MODE", "hybrid"],
    ["HASNA_ACCOUNTS_STORAGE_MODE", "self_hosted"],
    ["HASNA_ACCOUNTS_MODE", "cloud"],
    ["ACCOUNTS_STORAGE_MODE", "cloud"],
    ["ACCOUNTS_MODE", "local"],
  ] as const)("retired variable %s=%s throws naming the variable", (key, value) => {
    expect(() => assertNoLegacyStorageMode({ [key]: value } as NodeJS.ProcessEnv)).toThrow(
      new RegExp(`${key} was removed`),
    );
  });

  test("the throw names the supported switches", () => {
    expect(() =>
      assertNoLegacyStorageMode({ HASNA_ACCOUNTS_STORAGE_MODE: "cloud" } as NodeJS.ProcessEnv),
    ).toThrow(/HASNA_ACCOUNTS_API_URL \+ HASNA_ACCOUNTS_API_KEY/);
    expect(() =>
      assertNoLegacyStorageMode({ HASNA_ACCOUNTS_STORAGE_MODE: "cloud" } as NodeJS.ProcessEnv),
    ).toThrow(/HASNA_ACCOUNTS_DATABASE_URL/);
  });

  test("no-op when no retired variable is set", () => {
    expect(() =>
      assertNoLegacyStorageMode({
        HASNA_ACCOUNTS_API_URL: "https://accounts.example.test",
        HASNA_ACCOUNTS_API_KEY: "fixture",
        HASNA_ACCOUNTS_DATABASE_URL: "postgresql://x",
        ACCOUNTS_HOME: "/tmp/accounts",
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  test("no-op when a retired variable is set to an empty string is still a throw (set means set)", () => {
    expect(() => assertNoLegacyStorageMode({ HASNA_ACCOUNTS_STORAGE_MODE: "" } as NodeJS.ProcessEnv)).toThrow(
      /HASNA_ACCOUNTS_STORAGE_MODE was removed/,
    );
  });
});
