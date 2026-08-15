import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addCustomTool,
  addProfile,
  appliedProfile,
  appliedProfileName,
  ensureProfileForLogin,
  listProfiles,
  listTools,
  loadStore,
  saveStore,
} from "./index.js";
import type { Store } from "./types.js";

const AUTHORITY_KEYS = [
  "HASNA_ACCOUNTS_STORAGE_MODE",
  "ACCOUNTS_STORAGE_MODE",
  "HASNA_ACCOUNTS_MODE",
  "HASNA_ACCOUNTS_API_URL",
  "ACCOUNTS_API_URL",
  "HASNA_ACCOUNTS_API_KEY",
  "ACCOUNTS_API_KEY",
  "HASNA_ACCOUNTS_STRICT_ROOT_COMPAT",
] as const;

describe("root synchronous compatibility exports", () => {
  let home: string;
  let saved: Partial<Record<(typeof AUTHORITY_KEYS)[number], string>>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "accounts-root-compat-"));
    process.env.ACCOUNTS_HOME = home;
    saved = {};
    for (const key of AUTHORITY_KEYS) {
      if (process.env[key] !== undefined) saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    delete process.env.ACCOUNTS_HOME;
    for (const key of AUTHORITY_KEYS) {
      delete process.env[key];
      if (saved[key] !== undefined) process.env[key] = saved[key];
    }
  });

  test("an incomplete retained API configuration throws (no silent local drift)", () => {
    process.env.HASNA_ACCOUNTS_API_URL = "https://accounts.example.test";
    expect(() => loadStore()).toThrow(
      /API mode requires BOTH HASNA_ACCOUNTS_API_URL and HASNA_ACCOUNTS_API_KEY; only HASNA_ACCOUNTS_API_URL is set/,
    );
  });

  test("writes fail closed while reads stay answerable under API authority", () => {
    process.env.HASNA_ACCOUNTS_API_URL = "https://accounts.example.test";
    process.env.HASNA_ACCOUNTS_API_KEY = "fixture-authority";
    expect(() => addProfile({ name: "must-not-write" })).toThrow(/local-only compatibility/);
    expect(() => saveStore(emptyStore())).toThrow(/local-only compatibility/);
    expect(() =>
      addCustomTool({
        id: "fixture-tool",
        label: "Fixture",
        envVar: "FIXTURE_HOME",
        defaultDir: "/fixture",
        bin: "fixture",
      }),
    ).toThrow(/local-only compatibility/);
    // Reads answer from the machine-local registry and announce themselves via
    // process.emitWarning instead of throwing, because the measured consumers
    // swallow throws and would silently lose their answer. See
    // root-compat-consumer.test.ts for the full contract.
    expect(listProfiles()).toEqual([]);
    expect(loadStore().version).toBe(1);
    expect(listTools().some((tool) => tool.id === "claude")).toBe(true);
    // No read created the local store on its way to answering.
    expect(existsSync(join(home, "accounts.json"))).toBe(false);
    expect(existsSync(join(home, "profiles"))).toBe(false);
  });

  // Deployment modes no longer exist (owner directive 2026-07-29; knowledge
  // k_ms5wv466_u0jidq): a retired storage-mode variable, whatever its value,
  // is scrubbed with an advisory warning (the fleet accounts-cloud
  // environment.d drop-in still exports one) and can neither route nor block
  // any root export.
  test.each([
    ["explicit cloud mode", { HASNA_ACCOUNTS_STORAGE_MODE: "cloud" }],
    ["explicit self-hosted mode", { HASNA_ACCOUNTS_STORAGE_MODE: "self_hosted" }],
    ["unknown mode", { HASNA_ACCOUNTS_STORAGE_MODE: "typo" }],
    ["retired alias", { HASNA_ACCOUNTS_STORAGE_MODE: "remote" }],
    [
      "retired alias before lower-priority mode",
      { HASNA_ACCOUNTS_STORAGE_MODE: "remote", ACCOUNTS_STORAGE_MODE: "typo" },
    ],
    [
      "mode alias key",
      {
        HASNA_ACCOUNTS_MODE: "cloud",
        HASNA_ACCOUNTS_API_URL: "https://accounts.example.test",
        HASNA_ACCOUNTS_API_KEY: "fixture-authority",
      },
    ],
  ])("scrubs the retired storage-mode variables for %s and reads proceed locally", (_label, env) => {
    Object.assign(process.env, env);
    expect(() => listProfiles()).not.toThrow();
    for (const key of ["HASNA_ACCOUNTS_STORAGE_MODE", "ACCOUNTS_STORAGE_MODE", "HASNA_ACCOUNTS_MODE", "ACCOUNTS_MODE"]) {
      expect(process.env[key]).toBeUndefined();
    }
  });

  test.each([
    [
      "API authority",
      {
        HASNA_ACCOUNTS_API_URL: "https://accounts.example.test",
        HASNA_ACCOUNTS_API_KEY: "fixture-authority",
      },
    ],
  ])(
    "appliedProfile stays readable for %s and so does the machine-local pointer",
    (_label, env) => {
      seedAppliedProfile("ghost-local");
      expect(appliedProfile("claude")).toMatchObject({ name: "ghost-local", tool: "claude" });

      Object.assign(process.env, env);
      // The registry record behind the pointer belongs to the server registry,
      // so this answer is machine-local and is announced as such (see
      // root-compat-consumer.test.ts). It is not withheld: the consumers that
      // read it wrap every call in try/catch, so withholding it produced a
      // silent null rather than the intended loud failure.
      expect(appliedProfile("claude")).toMatchObject({ name: "ghost-local", tool: "claude" });
      // The pointer itself is machine-local state and stays readable.
      expect(appliedProfileName("claude")).toBe("ghost-local");
      // Opting into the end-state behaviour makes the record read fail closed.
      process.env.HASNA_ACCOUNTS_STRICT_ROOT_COMPAT = "1";
      try {
        expect(() => appliedProfile("claude")).toThrow(/local-only compatibility/);
        expect(appliedProfileName("claude")).toBe("ghost-local");
      } finally {
        delete process.env.HASNA_ACCOUNTS_STRICT_ROOT_COMPAT;
      }
    },
  );

  test("ensureProfileForLogin preserves the documented v1 local boundary for default local env", () => {
    const profile = ensureProfileForLogin("login-local");
    expect(profile).toMatchObject({ name: "login-local", tool: "claude" });
    expect(existsSync(join(home, "accounts.json"))).toBe(true);
    expect(existsSync(join(home, "profiles"))).toBe(true);
  });

  test.each([
    [
      "implicit local with only a hosted URL",
      { HASNA_ACCOUNTS_API_URL: "https://accounts.example.test" },
      /only HASNA_ACCOUNTS_API_URL is set/,
    ],
    [
      "implicit local with only a hosted key",
      { HASNA_ACCOUNTS_API_KEY: "fixture-authority" },
      /only HASNA_ACCOUNTS_API_KEY is set/,
    ],
  ])("ensureProfileForLogin throws for a partial API pair (%s) — no silent local drift", (_label, env, re) => {
    Object.assign(process.env, env);
    expect(() => ensureProfileForLogin("login-local")).toThrow(re);
  });

  test.each([
    [
      // ACCOUNTS_HOME is set by beforeEach for this suite: the API pair selects
      // the transport regardless, so the write still fails closed.
      "API authority with URL and key (ACCOUNTS_HOME set)",
      {
        HASNA_ACCOUNTS_API_URL: "https://accounts.example.test",
        HASNA_ACCOUNTS_API_KEY: "fixture-authority",
      },
      /local-only compatibility/,
    ],
    [
      "retired mode with URL and key",
      {
        HASNA_ACCOUNTS_MODE: "cloud",
        HASNA_ACCOUNTS_API_URL: "https://accounts.example.test",
        HASNA_ACCOUNTS_API_KEY: "fixture-authority",
      },
      /local-only compatibility/,
    ],
  ])("ensureProfileForLogin fails closed without local writes for %s", (_label, env, error) => {
    Object.assign(process.env, env);
    expect(() => ensureProfileForLogin("must-not-write")).toThrow(error);
    expect(existsSync(join(home, "accounts.json"))).toBe(false);
    expect(existsSync(join(home, "profiles"))).toBe(false);
  });

  test.each([
    ["retired mode alone", { HASNA_ACCOUNTS_MODE: "cloud" }],
    ["invalid explicit mode", { HASNA_ACCOUNTS_MODE: "typo" }],
  ])("ensureProfileForLogin scrubs %s and writes locally", (_label, env) => {
    Object.assign(process.env, env);
    const profile = ensureProfileForLogin("login-legacy-mode");
    expect(profile).toMatchObject({ name: "login-legacy-mode", tool: "claude" });
    expect(process.env.HASNA_ACCOUNTS_MODE).toBeUndefined();
    expect(existsSync(join(home, "accounts.json"))).toBe(true);
    expect(existsSync(join(home, "profiles"))).toBe(true);
  });
});

/** Seed a local profile plus the machine-local applied pointer for it. */
function seedAppliedProfile(name: string, toolId = "claude"): void {
  addProfile({ name, tool: toolId });
  const store = loadStore();
  store.applied[toolId] = name;
  saveStore(store);
}

function emptyStore(): Store {
  return {
    version: 1,
    current: {},
    applied: {},
    toolLocks: {},
    profiles: [],
    tools: [],
  };
}
