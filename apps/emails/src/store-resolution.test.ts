// API-only client resolution. Missing, ambiguous or retired settings are errors,
// never precedence rules selecting a local mailbox. Pure cases pass explicit env
// objects; factory cases use private HOME/XDG roots and restore the whole env.

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HTTP_STORE_CAPABILITIES } from "./store-http/index.js";
import { SQLITE_STORE_CAPABILITIES } from "./store-sqlite/index.js";
import {
  API_BASE_URL_SETTING, API_CREDENTIAL_SETTINGS, API_SETTINGS_POINTER,
  DATABASE_PATH_SETTINGS, StoreConfigurationError, createConfiguredEmailStore, planEmailStore,
} from "./store-resolution.js";
import {
  EMAILS_API_KEY_ENV, EMAILS_API_KEY_SETTINGS, EMAILS_API_URL_SETTINGS,
  RETIRED_EMAILS_SELECTOR_SETTINGS,
} from "./lib/client-settings.js";

const A_URL = "https://mail.example.test";
const A_FIXTURE_VALUE = "fixture-primary";
const CLIENT_SETTINGS = [...new Set([
  ...DATABASE_PATH_SETTINGS, ...EMAILS_API_URL_SETTINGS, ...API_CREDENTIAL_SETTINGS,
  API_SETTINGS_POINTER, ...RETIRED_EMAILS_SELECTOR_SETTINGS,
])];
const api = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  [API_BASE_URL_SETTING]: A_URL, [EMAILS_API_KEY_ENV]: A_FIXTURE_VALUE, ...overrides,
});

function refusal(env: NodeJS.ProcessEnv, keys: readonly string[]): StoreConfigurationError {
  let thrown: unknown;
  try { planEmailStore(env); } catch (error) { thrown = error; }
  expect(thrown).toBeInstanceOf(StoreConfigurationError);
  const error = thrown as StoreConfigurationError;
  expect([...error.settings].sort()).toEqual([...keys].sort());
  expect(error.message).not.toContain(A_FIXTURE_VALUE);
  return error;
}

describe("configured store resolution — no implicit client database", () => {
  it("requires an API endpoint when nothing is configured", () => {
    const error = refusal({}, [API_BASE_URL_SETTING]);
    expect(error.message).toContain(API_BASE_URL_SETTING);
    expect(error.message).toContain("required");
  });

  it("rejects every explicit database setting, including equivalent aliases", () => {
    expect(DATABASE_PATH_SETTINGS).toContain("HASNA_EMAILS_DB_PATH");
    expect(DATABASE_PATH_SETTINGS).toContain("EMAILS_DB_PATH");
    for (const setting of DATABASE_PATH_SETTINGS) {
      const error = refusal({ [setting]: ":memory:" }, [setting]);
      expect(error.message).toContain("cannot configure an Emails client");
    }
    refusal({ EMAILS_DB_PATH: "/tmp/same.db", HASNA_EMAILS_DB_PATH: "/tmp/same.db" },
      ["EMAILS_DB_PATH", "HASNA_EMAILS_DB_PATH"]);
  });

  it("refuses different database paths and names keys without exposing either path", () => {
    const error = refusal({ EMAILS_DB_PATH: "/tmp/one.db", HASNA_EMAILS_DB_PATH: "/tmp/two.db" },
      ["EMAILS_DB_PATH", "HASNA_EMAILS_DB_PATH"]);
    expect(error.message).toContain("EMAILS_DB_PATH");
    expect(error.message).toContain("HASNA_EMAILS_DB_PATH");
    expect(error.message).not.toContain("/tmp/one.db");
    expect(error.message).not.toContain("/tmp/two.db");
  });

  it("uses the authenticated API and reports only its credential setting", () => {
    const plan = planEmailStore(api());
    expect(plan.store).toBe("api");
    expect(plan.baseUrl).toBe(A_URL);
    expect(plan.setting).toBe(API_BASE_URL_SETTING);
    expect(plan.credentialSetting).toBe(EMAILS_API_KEY_ENV);
    expect(JSON.stringify(plan)).not.toContain(A_FIXTURE_VALUE);
  });

  it("rejects URL userinfo, query and fragment rather than silently stripping credentials", () => {
    for (const value of [
      `https://operator:${A_FIXTURE_VALUE}@mail.example.test/v1`,
      `${A_URL}/v1?token=${A_FIXTURE_VALUE}`, `${A_URL}/v1#${A_FIXTURE_VALUE}`,
    ]) {
      const error = refusal(api({ [API_BASE_URL_SETTING]: value }), [API_BASE_URL_SETTING]);
      expect(error.message).not.toContain(value);
      expect(error.message).not.toContain("operator");
    }
  });

  it("rejects malformed and non-HTTP URLs without reflecting the rejected value", () => {
    for (const value of [
      `operator:${A_FIXTURE_VALUE}@mail.example.test/v1`, "mail.example.test", "ftp://mail.example.test",
      `${A_URL}/bad path`, `${A_URL}\\other`, `${A_URL}/bad\npath`,
    ]) {
      const error = refusal(api({ [API_BASE_URL_SETTING]: value }), [API_BASE_URL_SETTING]);
      expect(error.message).toContain(API_BASE_URL_SETTING);
      expect(error.message).not.toContain(value);
    }
  });

  it("refuses plaintext HTTP to non-loopback hosts and misleading loopback prefixes", () => {
    for (const value of ["http://mail.example.test", "http://192.0.2.10:8080/v1",
      "http://mail.internal:3000", "http://127.0.0.1.evil.example"]) {
      const error = refusal(api({ [API_BASE_URL_SETTING]: value }), [API_BASE_URL_SETTING]);
      expect(error.message).toContain("HTTPS");
      expect(error.message).toContain("loopback");
      expect(error.message).not.toContain(value);
    }
  });

  it("accepts HTTPS and explicit IPv4, hostname and IPv6 loopback development URLs", () => {
    for (const value of [A_URL, "http://127.0.0.1:8080", "http://localhost:8080",
      "http://localhost", "http://[::1]:8080"]) {
      expect(planEmailStore(api({ [API_BASE_URL_SETTING]: value })).store).toBe("api");
    }
    expect(planEmailStore(api({ [API_BASE_URL_SETTING]: `${A_URL}/base/v1/` })).baseUrl).toBe(`${A_URL}/base`);
  });

  it("prefers session over identity over API key and preserves all key aliases", () => {
    expect([...API_CREDENTIAL_SETTINGS]).toEqual([
      "EMAILS_SESSION_TOKEN", "EMAILS_IDP_TOKEN", "HASNA_EMAILS_API_KEY", "EMAILS_API_KEY", "EMAILS_SELF_HOSTED_API_KEY",
    ]);
    for (const key of EMAILS_API_KEY_SETTINGS) {
      expect(planEmailStore({ [API_BASE_URL_SETTING]: A_URL, [key]: A_FIXTURE_VALUE }).credentialSetting).toBe(key);
    }
    expect(planEmailStore(api({ EMAILS_IDP_TOKEN: "fixture-idp" })).credentialSetting).toBe("EMAILS_IDP_TOKEN");
    expect(planEmailStore(api({ EMAILS_SESSION_TOKEN: "fixture-session", EMAILS_IDP_TOKEN: "fixture-idp" })).credentialSetting)
      .toBe("EMAILS_SESSION_TOKEN");
  });

  it("accepts only the caller's identity token without leaking it into the plan", () => {
    const plan = planEmailStore({ [API_BASE_URL_SETTING]: A_URL, EMAILS_IDP_TOKEN: "fixture-idp" });
    expect(plan.store).toBe("api");
    expect(plan.credentialSetting).toBe("EMAILS_IDP_TOKEN");
    expect(JSON.stringify(plan)).not.toContain("fixture-idp");
  });

  it("rejects every client database setting even beside a complete API configuration", () => {
    for (const databaseSetting of DATABASE_PATH_SETTINGS) {
      const error = refusal(api({ [databaseSetting]: "/tmp/local.db" }), [databaseSetting]);
      expect(error.message).toContain(databaseSetting);
      expect(error.message).toContain(API_BASE_URL_SETTING);
      expect(error.message).toContain("Keep database settings on the service");
      expect(error.message).not.toContain("/tmp/local.db");
    }
  });

  it("names all configured DB keys without blaming a valid endpoint or credential pointer", () => {
    const env = api({ [API_SETTINGS_POINTER]: "vault/item/name" });
    for (const setting of DATABASE_PATH_SETTINGS) env[setting] = ":memory:";
    refusal(env, DATABASE_PATH_SETTINGS);
  });
});

describe("configured store resolution — configurations it will not guess at", () => {
  it("requires a credential before constructing a store that would 401", () => {
    const keys = [EMAILS_API_KEY_ENV, "EMAILS_SESSION_TOKEN", "EMAILS_IDP_TOKEN"];
    const error = refusal({ [API_BASE_URL_SETTING]: A_URL }, keys);
    for (const setting of keys) expect(error.message).toContain(setting);
  });

  it("does not load a credential pointer or fall back when its API settings are absent", () => {
    const error = refusal({ [API_SETTINGS_POINTER]: "vault/item/name" }, [API_BASE_URL_SETTING]);
    expect(error.message).toContain(API_BASE_URL_SETTING);
    expect(error.message).not.toContain("vault/item/name");
  });

  it("rejects blank database, URL, credential and pointer settings instead of treating them as absent", () => {
    for (const blank of ["", "   ", "\t\n"]) {
      for (const setting of CLIENT_SETTINGS) {
        const env = api({ [setting]: blank });
        expect(() => planEmailStore(env), `${setting} must reject a blank value`).toThrow(StoreConfigurationError);
      }
    }
  });

  it("never resolves a padded or in-memory database path for a client", () => {
    for (const setting of DATABASE_PATH_SETTINGS) {
      for (const value of ["", "   ", "\t\n", "  :memory:  ", ":memory:"]) refusal({ [setting]: value }, [setting]);
    }
  });

  it("accepts matching URL and key aliases but rejects conflicting aliases", () => {
    const matching = api();
    for (const setting of EMAILS_API_URL_SETTINGS) matching[setting] = A_URL;
    for (const setting of EMAILS_API_KEY_SETTINGS) matching[setting] = A_FIXTURE_VALUE;
    expect(planEmailStore(matching).store).toBe("api");
    refusal({ ...matching, EMAILS_API_URL: "https://different.example.test" }, EMAILS_API_URL_SETTINGS);
    refusal({ ...matching, EMAILS_API_KEY: "fixture-other" }, EMAILS_API_KEY_SETTINGS);
  });

  it("rejects every retired selector even with otherwise valid API configuration", () => {
    for (const setting of RETIRED_EMAILS_SELECTOR_SETTINGS) {
      for (const value of ["local", "self_hosted", "cloud", ""]) refusal(api({ [setting]: value }), [setting]);
    }
  });
});

describe("the store the resolution actually hands back", () => {
  let inherited: NodeJS.ProcessEnv;
  let root: string;
  let homes: string[];
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  const only = (settings: NodeJS.ProcessEnv): void => {
    for (const key of CLIENT_SETTINGS) delete process.env[key];
    Object.assign(process.env, settings);
  };
  beforeEach(() => {
    inherited = { ...process.env };
    root = mkdtempSync(join(tmpdir(), "emails-resolver-test-"));
    homes = [];
    for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
      const dir = join(root, key);
      mkdirSync(dir);
      homes.push(dir);
      process.env[key] = dir;
    }
    only({});
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Unexpected resolver fetch"); });
  });
  afterEach(() => {
    try {
      expect(fetchSpy).not.toHaveBeenCalled();
      for (const dir of homes) expect(readdirSync(dir)).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
      for (const key of Object.keys(process.env)) if (!Object.hasOwn(inherited, key)) delete process.env[key];
      Object.assign(process.env, inherited);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses implicit or explicit SQLite without touching an existing file", () => {
    expect(() => createConfiguredEmailStore()).toThrow(StoreConfigurationError);
    const stale = join(root, "retained.db");
    writeFileSync(stale, "retained-fixture-bytes");
    for (const value of [":memory:", stale]) {
      only({ EMAILS_DB_PATH: value });
      expect(() => createConfiguredEmailStore()).toThrow(StoreConfigurationError);
    }
    expect(readFileSync(stale, "utf8")).toBe("retained-fixture-bytes");
  });

  it("binds each constructed store to its validated endpoint while preserving the earlier descriptor", () => {
    only(api());
    const bound = createConfiguredEmailStore();
    process.env[API_BASE_URL_SETTING] = "https://other.example.test";
    const next = createConfiguredEmailStore();
    expect(bound.descriptor.detail).toBe(`Emails API at ${A_URL}`);
    expect(next.descriptor.detail).toBe("Emails API at https://other.example.test");
    expect(next).not.toBe(bound);
  });

  it("builds an API store with the correct capability set and credential-free diagnostics", () => {
    only(api());
    const store = createConfiguredEmailStore();
    expect(store.capabilities).toEqual(HTTP_STORE_CAPABILITIES);
    expect(HTTP_STORE_CAPABILITIES).not.toEqual(SQLITE_STORE_CAPABILITIES);
    expect(store.descriptor.detail).toBe(`Emails API at ${A_URL}`);
    expect(JSON.stringify(store.descriptor)).not.toContain(A_FIXTURE_VALUE);
    only(api({ [API_BASE_URL_SETTING]: `https://operator:${A_FIXTURE_VALUE}@mail.example.test/v1?t=1` }));
    expect(() => createConfiguredEmailStore()).toThrow(StoreConfigurationError);
  });

  it("never constructs a credential-bearing store for plaintext non-loopback HTTP", () => {
    only(api({ [API_BASE_URL_SETTING]: "http://192.0.2.10:8080" }));
    expect(() => createConfiguredEmailStore()).toThrow(StoreConfigurationError);
    expect(() => createConfiguredEmailStore()).toThrow("HTTPS");
  });

  it("refuses a client database even alongside a complete API configuration", () => {
    only(api({ EMAILS_DB_PATH: ":memory:" }));
    expect(() => createConfiguredEmailStore()).toThrow(StoreConfigurationError);
  });
});

describe("what the resolver is not allowed to read", () => {
  it("delegates to canonical config and has no deployment dispatcher or SQLite construction", () => {
    const source = readFileSync(join(import.meta.dir, "store-resolution.ts"), "utf8");
    expect(source).not.toContain("lib/mode");
    expect(source).not.toContain("store-sqlite");
    expect(source).not.toContain("db/database");
    for (const reader of ["getEmails", "resolveEmails", "normalizeEmails", "isSelfHosted"]) {
      expect(source).not.toContain(`${reader}Mode`);
    }
    expect(source).not.toContain(["EMAILS", "MODE"].join("_"));
    // Actual definitions/calls are the non-vacuity control, not the old dual-store
    // implementation's byte count: an empty or unrelated file cannot satisfy these.
    expect(source).toContain("export function planEmailStore(");
    expect(source).toContain("resolveEmailsClientConfig(env)");
    expect(source).toContain("export function createConfiguredEmailStore(");
    expect(source).toContain("loadEmailsClientConfig()");
    expect(source).toContain("return createHttpEmailStore(");
  });
});

describe("removed local fallback (incident 715712)", () => {
  it("throws on every all-unset attempt instead of warning once and serving an empty local mailbox", () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      for (let attempt = 0; attempt < 2; attempt++) expect(() => planEmailStore({})).toThrow(StoreConfigurationError);
      expect(errSpy).not.toHaveBeenCalled();
    } finally { errSpy.mockRestore(); }
  });

  it("throws for explicit database configuration without a fallback notice", () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => planEmailStore({ EMAILS_DB_PATH: "/tmp/explicit.db" })).toThrow(StoreConfigurationError);
      expect(errSpy).not.toHaveBeenCalled();
    } finally { errSpy.mockRestore(); }
  });

  it("keeps the API plan and incomplete configuration refusals free of fallback notices", () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(planEmailStore(api()).store).toBe("api");
      expect(() => planEmailStore({ [API_SETTINGS_POINTER]: "vault/item/name" })).toThrow(StoreConfigurationError);
      expect(() => planEmailStore({ [API_BASE_URL_SETTING]: A_URL })).toThrow(StoreConfigurationError);
      expect(errSpy).not.toHaveBeenCalled();
    } finally { errSpy.mockRestore(); }
  });
});
