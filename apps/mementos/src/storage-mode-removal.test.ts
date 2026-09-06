import { afterEach, describe, expect, test } from "bun:test";
import { getStorageBackend, getStorageConfig } from "./storage.js";
import { isApiMode } from "./db/api-mode.js";
import { API_URL_ENV_KEYS, API_KEY_ENV_KEYS, DATABASE_URL_ENV_KEYS, DB_PATH_ENV_KEYS } from "./db/api-mode.js";
import { MEMENTOS_LOCAL_OPT_IN_ENV_KEYS, REMOVED_MEMENTOS_MODE_ENV_KEYS } from "./lib/local-opt-in.js";

// ============================================================================
// Deployment-mode removal regression tests.
//
// Deployment modes no longer exist (owner directive 2026-07-29; knowledge
// k_ms5wv466_u0jidq). The client transport is decided by what the
// @hasna/contracts chain RESOLVES (env key, Keychain, credentials file) against
// the deliberate local opt-ins; the server backend by
// HASNA_MEMENTOS_DATABASE_URL presence. The retired storage-mode variables are
// INERT — nothing reads them, and a stale variable can neither select a
// transport nor throw (they were stripped with the resolver adoption,
// hasna/apps#1720).
//
// (a) pair -> api     (b) absent -> local/unconfigured     (c) URL only ->
// THROW naming the missing key      (d) STORAGE_MODE set -> inert
// plus backend-by-DATABASE_URL.
// ============================================================================

const SAVED = { ...process.env };

function clearEnv(): void {
  for (const k of [
    ...API_URL_ENV_KEYS,
    ...API_KEY_ENV_KEYS,
    ...DATABASE_URL_ENV_KEYS,
    ...DB_PATH_ENV_KEYS,
    ...MEMENTOS_LOCAL_OPT_IN_ENV_KEYS,
    ...REMOVED_MEMENTOS_MODE_ENV_KEYS,
  ]) {
    delete process.env[k];
  }
}

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, SAVED);
});

describe("retired storage-mode variables are inert (d)", () => {
  test("REMOVED_MEMENTOS_MODE_ENV_KEYS names the four retired key shapes", () => {
    expect(REMOVED_MEMENTOS_MODE_ENV_KEYS).toEqual([
      "HASNA_MEMENTOS_STORAGE_MODE",
      "HASNA_MEMENTOS_MODE",
      "MEMENTOS_STORAGE_MODE",
      "MEMENTOS_MODE",
    ]);
  });

  test("HASNA_MEMENTOS_STORAGE_MODE set does NOT throw and does NOT select anything", () => {
    clearEnv();
    process.env["HASNA_MEMENTOS_STORAGE_MODE"] = "cloud";
    expect(isApiMode()).toBe(false);
  });

  test("every alias shape is inert, blank included", () => {
    clearEnv();
    for (const key of REMOVED_MEMENTOS_MODE_ENV_KEYS) {
      process.env[key] = "";
      expect(() => isApiMode()).not.toThrow();
      delete process.env[key];
    }
  });

  test("a stale storage-mode variable does not rescue or hijack a complete API pair", () => {
    clearEnv();
    process.env["HASNA_MEMENTOS_API_URL"] = "https://mementos.hasna.xyz";
    process.env["HASNA_MEMENTOS_API_KEY"] = "sk-test";
    process.env["HASNA_MEMENTOS_STORAGE_MODE"] = "cloud";
    expect(isApiMode()).toBe(true);
  });

  test("a stale storage-mode variable does not break the server backend resolver", () => {
    clearEnv();
    process.env["MEMENTOS_STORAGE_MODE"] = "remote";
    expect(getStorageBackend()).toBe("sqlite");
    expect(() => getStorageConfig()).not.toThrow();
  });
});

describe("client transport by credential resolution (a, b, c)", () => {
  test("(a) both URL and KEY set => api", () => {
    clearEnv();
    process.env["HASNA_MEMENTOS_API_URL"] = "https://mementos.hasna.xyz";
    process.env["HASNA_MEMENTOS_API_KEY"] = "sk-test";
    expect(isApiMode()).toBe(true);
  });

  test("(b) neither set => not api (unconfigured; the fail-closed gate refuses)", () => {
    clearEnv();
    expect(isApiMode()).toBe(false);
  });

  test("(c) URL only => throws naming the missing key variable", () => {
    clearEnv();
    process.env["HASNA_MEMENTOS_API_URL"] = "https://mementos.hasna.xyz";
    expect(() => isApiMode()).toThrow(/HASNA_MEMENTOS_API_KEY/);
  });

  test("(c2) KEY only is COMPLETE — the fleet gateway authority applies", () => {
    clearEnv();
    process.env["HASNA_MEMENTOS_API_KEY"] = "sk-test";
    expect(isApiMode()).toBe(true);
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