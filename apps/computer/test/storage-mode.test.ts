// Test-gap lane: agent-authored analysis (SOL consult refused — gpt-5.6-sol consult timed out twice within the 2x600s protocol bound; no answer delivered). Authored by Paulinus.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getStorageDatabaseEnvName,
  getStorageMode,
  getStorageDatabaseUrl,
} from "../src/db/storage-sync.js";

const envKeys = [
  "HASNA_COMPUTER_DATABASE_URL",
  "COMPUTER_DATABASE_URL",
  "HASNA_COMPUTER_STORAGE_MODE",
  "COMPUTER_STORAGE_MODE",
] as const;

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  savedEnv.clear();
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("storage mode — precedence and validation", () => {
  test("explicit local mode wins even when a database URL is set", () => {
    process.env.HASNA_COMPUTER_STORAGE_MODE = "local";
    process.env.HASNA_COMPUTER_DATABASE_URL = "postgres://x.example/computer";
    expect(getStorageMode()).toBe("local");
  });

  test("explicit remote mode without a URL still reports remote", () => {
    process.env.HASNA_COMPUTER_STORAGE_MODE = "remote";
    expect(getStorageMode()).toBe("remote");
  });

  test("an invalid mode value falls back to hybrid when a URL is present", () => {
    process.env.HASNA_COMPUTER_STORAGE_MODE = "bogus";
    process.env.HASNA_COMPUTER_DATABASE_URL = "postgres://x.example/computer";
    expect(getStorageMode()).toBe("hybrid");
  });

  test("an invalid mode value falls back to local when no URL is present", () => {
    process.env.HASNA_COMPUTER_STORAGE_MODE = "BOGUS";
    expect(getStorageMode()).toBe("local");
  });

  test("mode matching is case-insensitive and trims whitespace", () => {
    process.env.HASNA_COMPUTER_STORAGE_MODE = "  Remote  ";
    expect(getStorageMode()).toBe("remote");
  });

  test("empty-string URL env is treated as unset", () => {
    process.env.HASNA_COMPUTER_DATABASE_URL = "   ";
    expect(getStorageDatabaseUrl()).toBeNull();
    expect(getStorageDatabaseEnvName()).toBeNull();
    expect(getStorageMode()).toBe("local");
  });

  test("canonical env name is reported when only the fallback is set", () => {
    process.env.COMPUTER_DATABASE_URL = "postgres://fallback.example/computer";
    expect(getStorageDatabaseEnvName()).toBe("COMPUTER_DATABASE_URL");
  });
});
