import { afterEach, describe, expect, test } from "bun:test";
import {
  LEGACY_STORAGE_MODE_KEYS,
  assertNoLegacyStorageMode,
} from "./lib/retired-storage-mode.js";
import { getStorageBackend, getStorageConfig } from "./storage.js";
import { isApiMode } from "./db/api-mode.js";
import { API_URL_ENV_KEYS, API_KEY_ENV_KEYS, DATABASE_URL_ENV_KEYS, DB_PATH_ENV_KEYS } from "./db/api-mode.js";

// ============================================================================
// Deployment-mode removal regression tests.
//
// Deployment modes no longer exist (owner directive 2026-07-29; knowledge
// k_ms5wv466_u0jidq). The client transport is selected by the API env pair
// alone, the server backend by HASNA_MEMENTOS_DATABASE_URL presence, and any
// retired storage-mode variable — SET, even to a blank value — throws the
// fail-loud ratchet naming the variable.
//
// (a) pair -> api     (b) absent -> local     (c) one -> THROW naming the
// missing var         (d) STORAGE_MODE set -> THROW naming the var
// plus backend-by-DATABASE_URL.
// ============================================================================

const SAVED = { ...process.env };

function clearEnv(): void {
  for (const k of [
    ...API_URL_ENV_KEYS,
    ...API_KEY_ENV_KEYS,
    ...DATABASE_URL_ENV_KEYS,
    ...DB_PATH_ENV_KEYS,
    ...LEGACY_STORAGE_MODE_KEYS,
  ]) {
    delete process.env[k];
  }
}

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, SAVED);
});

describe("retired storage-mode ratchet (d)", () => {
  test("LEGACY_STORAGE_MODE_KEYS names the four retired key shapes", () => {
    expect(LEGACY_STORAGE_MODE_KEYS).toEqual([
      "HASNA_MEMENTOS_STORAGE_MODE",
      "HASNA_MEMENTOS_MODE",
      "MEMENTOS_STORAGE_MODE",
      "MEMENTOS_MODE",
    ]);
  });

  test("HASNA_MEMENTOS_STORAGE_MODE set throws naming the variable", () => {
    clearEnv();
    process.env["HASNA_MEMENTOS_STORAGE_MODE"] = "cloud";
    expect(() => assertNoLegacyStorageMode()).toThrow(/HASNA_MEMENTOS_STORAGE_MODE/);
  });

  test("every alias shape throws naming ITSELF, not the canonical key", () => {
    clearEnv();
    for (const key of LEGACY_STORAGE_MODE_KEYS) {
      process.env[key] = "local";
      let message = "";
      try {
        assertNoLegacyStorageMode();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain(key);
      delete process.env[key];
    }
  });

  test("a BLANK variable still throws — set is the trigger, not a non-empty value", () => {
    clearEnv();
    process.env["HASNA_MEMENTOS_STORAGE_MODE"] = "";
    expect(() => assertNoLegacyStorageMode()).toThrow(/HASNA_MEMENTOS_STORAGE_MODE/);
  });

  test("no legacy key set is a no-op", () => {
    clearEnv();
    expect(() => assertNoLegacyStorageMode()).not.toThrow();
  });

  test("the ratchet fires through the client resolver — a complete API pair does not rescue it", () => {
    clearEnv();
    process.env["HASNA_MEMENTOS_API_URL"] = "https://mementos.hasna.xyz";
    process.env["HASNA_MEMENTOS_API_KEY"] = "sk-test";
    process.env["HASNA_MEMENTOS_STORAGE_MODE"] = "cloud";
    expect(() => isApiMode()).toThrow(/HASNA_MEMENTOS_STORAGE_MODE/);
  });

  test("the ratchet fires through the server backend resolver — a DATABASE_URL does not rescue it", () => {
    clearEnv();
    process.env["HASNA_MEMENTOS_DATABASE_URL"] = "postgres://u:p@127.0.0.1:1/db";
    process.env["MEMENTOS_STORAGE_MODE"] = "remote";
    expect(() => getStorageBackend()).toThrow(/MEMENTOS_STORAGE_MODE/);
    expect(() => getStorageConfig()).toThrow(/MEMENTOS_STORAGE_MODE/);
  });
});

describe("client transport by API pair presence (a, b, c)", () => {
  test("(a) both URL and KEY set => api", () => {
    clearEnv();
    process.env["HASNA_MEMENTOS_API_URL"] = "https://mementos.hasna.xyz";
    process.env["HASNA_MEMENTOS_API_KEY"] = "sk-test";
    expect(isApiMode()).toBe(true);
  });

  test("(b) neither set => local", () => {
    clearEnv();
    expect(isApiMode()).toBe(false);
  });

  test("(c) exactly one set => throws naming the missing variable", () => {
    clearEnv();
    process.env["HASNA_MEMENTOS_API_URL"] = "https://mementos.hasna.xyz";
    expect(() => isApiMode()).toThrow(/HASNA_MEMENTOS_API_KEY/);
    clearEnv();
    process.env["HASNA_MEMENTOS_API_KEY"] = "sk-test";
    expect(() => isApiMode()).toThrow(/HASNA_MEMENTOS_API_URL/);
  });
});

describe("server backend by DATABASE_URL presence", () => {
  test("no DATABASE_URL => sqlite", () => {
    clearEnv();
    expect(getStorageBackend()).toBe("sqlite");
  });

  test("HASNA_MEMENTOS_DATABASE_URL set => postgresql", () => {
    clearEnv();
    process.env["HASNA_MEMENTOS_DATABASE_URL"] = "postgres://u:p@127.0.0.1:1/db";
    expect(getStorageBackend()).toBe("postgresql");
  });

  test("the fallback MEMENTOS_DATABASE_URL also selects postgresql", () => {
    clearEnv();
    process.env["MEMENTOS_DATABASE_URL"] = "postgres://u:p@127.0.0.1:1/db";
    expect(getStorageBackend()).toBe("postgresql");
  });

  test("canonical key wins over fallback", () => {
    clearEnv();
    process.env["MEMENTOS_DATABASE_URL"] = "postgres://fallback";
    process.env["HASNA_MEMENTOS_DATABASE_URL"] = "postgres://canonical";
    expect(getStorageBackend()).toBe("postgresql");
  });

  test("a blank DATABASE_URL is treated as unset (sqlite)", () => {
    clearEnv();
    process.env["HASNA_MEMENTOS_DATABASE_URL"] = "   ";
    expect(getStorageBackend()).toBe("sqlite");
  });
});
