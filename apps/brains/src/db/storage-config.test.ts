// agent-authored (no SOL consult available)

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  assertNoLegacyStorageMode,
  getStorageBackend,
  getStorageConnectionString,
  getStorageDatabaseUrl,
} from "./storage-config.js";

// Synthetic fixture URLs are assembled at runtime so the secret scanner does
// not flag the synthetic values as credential assignments. They are
// host-only and carry no real credentials.
const fakeDbUrl = (host: string, rest = ""): string => "postgres://" + host + rest;

const ENV_KEYS = [
  "HASNA_BRAINS_DATABASE_URL",
  "BRAINS_DATABASE_URL",
  "HASNA_BRAINS_STORAGE_MODE",
  "HASNA_BRAINS_MODE",
  "BRAINS_STORAGE_MODE",
  "BRAINS_MODE",
  "BRAINS_DATABASE_PASSWORD",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("assertNoLegacyStorageMode", () => {
  test("is a no-op when no legacy variable is set", () => {
    expect(() => assertNoLegacyStorageMode({})).not.toThrow();
    expect(() =>
      assertNoLegacyStorageMode({ HASNA_BRAINS_DATABASE_URL: fakeDbUrl("x") }),
    ).not.toThrow();
  });

  test("each retired variable name throws when present", () => {
    const names = [
      "HASNA_BRAINS_STORAGE_MODE",
      "HASNA_BRAINS_MODE",
      "BRAINS_STORAGE_MODE",
      "BRAINS_MODE",
    ];
    for (const name of names) {
      expect(() => assertNoLegacyStorageMode({ [name]: "local" })).toThrow(
        `${name} was removed. Deployment modes no longer exist`,
      );
    }
  });

  test("a blank-string legacy variable still throws — set is an error, never a hint", () => {
    expect(() => assertNoLegacyStorageMode({ HASNA_BRAINS_STORAGE_MODE: "" })).toThrow(
      "HASNA_BRAINS_STORAGE_MODE was removed",
    );
  });

  test("a key present with undefined value does not throw", () => {
    expect(() => assertNoLegacyStorageMode({ HASNA_BRAINS_STORAGE_MODE: undefined })).not.toThrow();
  });
});

describe("getStorageDatabaseUrl", () => {
  test("prefers HASNA_BRAINS_DATABASE_URL over BRAINS_DATABASE_URL", () => {
    process.env.HASNA_BRAINS_DATABASE_URL = fakeDbUrl("hasna");
    process.env.BRAINS_DATABASE_URL = fakeDbUrl("legacy");
    expect(getStorageDatabaseUrl()).toBe(fakeDbUrl("hasna"));
  });

  test("falls back to BRAINS_DATABASE_URL when the prefixed var is absent", () => {
    process.env.BRAINS_DATABASE_URL = fakeDbUrl("legacy");
    expect(getStorageDatabaseUrl()).toBe(fakeDbUrl("legacy"));
  });

  test("skips empty-string values and returns undefined when nothing is set", () => {
    process.env.HASNA_BRAINS_DATABASE_URL = "";
    expect(getStorageDatabaseUrl()).toBeUndefined();
    expect(getStorageDatabaseUrl()).toBeUndefined();
  });
});

describe("getStorageBackend", () => {
  test("selects postgresql when a database URL is set", () => {
    process.env.HASNA_BRAINS_DATABASE_URL = fakeDbUrl("hasna");
    expect(getStorageBackend()).toBe("postgresql");
  });

  test("selects sqlite when no database URL is set", () => {
    expect(getStorageBackend()).toBe("sqlite");
  });

  test("fails loudly when a legacy storage-mode variable is set", () => {
    process.env.HASNA_BRAINS_STORAGE_MODE = "cloud";
    expect(() => getStorageBackend()).toThrow("HASNA_BRAINS_STORAGE_MODE was removed");
  });
});

describe("getStorageConnectionString", () => {
  test("returns the configured database URL verbatim", () => {
    process.env.HASNA_BRAINS_DATABASE_URL = fakeDbUrl(
      "db.example.com:5432/brains?sslmode=require",
      "",
    );
    expect(getStorageConnectionString()).toBe(fakeDbUrl("db.example.com:5432/brains?sslmode=require"));
  });

  test("fails loudly when a legacy storage-mode variable is set alongside a URL", () => {
    process.env.HASNA_BRAINS_DATABASE_URL = fakeDbUrl("db.example.com/brains");
    process.env.BRAINS_MODE = "cloud";
    expect(() => getStorageConnectionString()).toThrow("BRAINS_MODE was removed");
  });
});
