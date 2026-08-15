import { beforeEach, describe, expect, test } from "bun:test";
import { resetLegacyModeWarnings, scrubLegacyStorageMode } from "./retired-storage-mode.js";

const LEGACY_WARNING_CODE = "HASNA_ACCOUNTS_LEGACY_STORAGE_MODE_IGNORED";

describe("scrubLegacyStorageMode", () => {
  beforeEach(() => {
    resetLegacyModeWarnings();
  });

  test.each([
    ["HASNA_ACCOUNTS_STORAGE_MODE", "cloud"],
    ["HASNA_ACCOUNTS_STORAGE_MODE", "local"],
    ["HASNA_ACCOUNTS_STORAGE_MODE", "remote"],
    ["HASNA_ACCOUNTS_STORAGE_MODE", "hybrid"],
    ["HASNA_ACCOUNTS_STORAGE_MODE", "self_hosted"],
    ["HASNA_ACCOUNTS_MODE", "cloud"],
    ["ACCOUNTS_STORAGE_MODE", "cloud"],
    ["ACCOUNTS_MODE", "local"],
  ] as const)("retired variable %s=%s is scrubbed without throwing", (key, value) => {
    const env = { [key]: value } as NodeJS.ProcessEnv;
    expect(() => scrubLegacyStorageMode(env)).not.toThrow();
    expect(env[key]).toBeUndefined();
  });

  test("scrub returns the removed key names", () => {
    const env = { HASNA_ACCOUNTS_STORAGE_MODE: "cloud", ACCOUNTS_MODE: "local" } as NodeJS.ProcessEnv;
    const removed = scrubLegacyStorageMode(env);
    expect(removed.sort()).toEqual(["ACCOUNTS_MODE", "HASNA_ACCOUNTS_STORAGE_MODE"]);
  });

  test("scrub emits an advisory warning naming the retired variable", async () => {
    const warnings: Array<{ code?: string; message: string }> = [];
    const listener = (warning: { code?: string; message: string }) => warnings.push(warning);
    process.on("warning", listener);
    try {
      scrubLegacyStorageMode({ HASNA_ACCOUNTS_STORAGE_MODE: "cloud" } as NodeJS.ProcessEnv);
      // Bun delivers the "warning" event asynchronously (next tick).
      await new Promise((resolve) => setTimeout(resolve, 25));
    } finally {
      process.off("warning", listener);
    }
    expect(
      warnings.some(
        (warning) =>
          warning.code === LEGACY_WARNING_CODE &&
          warning.message.includes("HASNA_ACCOUNTS_STORAGE_MODE") &&
          warning.message.includes("retired and was ignored"),
      ),
    ).toBe(true);
  });

  test("scrub never touches non-legacy environment", () => {
    const env = {
      HASNA_ACCOUNTS_API_URL: "https://accounts.example.test",
      HASNA_ACCOUNTS_API_KEY: "fixture",
      HASNA_ACCOUNTS_DATABASE_URL: "postgresql://x",
      ACCOUNTS_HOME: "/tmp/accounts",
    } as NodeJS.ProcessEnv;
    const before = { ...env };
    expect(() => scrubLegacyStorageMode(env)).not.toThrow();
    expect(env).toEqual(before);
  });

  test("an empty-string retired variable is scrubbed too (set means set)", () => {
    const env = { HASNA_ACCOUNTS_STORAGE_MODE: "" } as NodeJS.ProcessEnv;
    scrubLegacyStorageMode(env);
    expect(env.HASNA_ACCOUNTS_STORAGE_MODE).toBeUndefined();
  });
});
