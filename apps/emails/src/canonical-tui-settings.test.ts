import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getSettings, setSetting, type TuiSettings } from "./cli/tui/data.js";
import { getSettings as getRemoteSettings, setSetting as setRemoteSetting } from "./cli/tui/data.remote.js";
import {
  CLIENT_DATABASE_SETTINGS, EMAILS_API_KEY_ENV, EMAILS_API_KEY_SETTINGS,
  EMAILS_API_URL_ENV, EMAILS_API_URL_SETTINGS, RETIRED_EMAILS_SELECTOR_SETTINGS,
  StoreConfigurationError,
} from "./lib/client-settings.js";
import { CLIENT_ENV_CREDENTIAL_SELECTION_KEYS, EMAILS_CLIENT_ENV_SECRET_ENV } from "./lib/client-env.js";

const FIXTURE_VALUE = "fixture-primary";
const API_URL = "https://emails.example.invalid";
const DEFAULTS: TuiSettings = {
  autoPull: false, dimRead: false, defaultMailbox: "inbox",
  defaultAddress: null, defaultFrom: null, theme: "light",
};
const SETTINGS = [...new Set([
  ...CLIENT_DATABASE_SETTINGS, ...EMAILS_API_URL_SETTINGS,
  ...CLIENT_ENV_CREDENTIAL_SELECTION_KEYS, ...RETIRED_EMAILS_SELECTOR_SETTINGS,
  EMAILS_CLIENT_ENV_SECRET_ENV, "HASNA_EMAILS_HOME", "EMAILS_HOME",
  "HASNA_HOME", "HASNA_DATA_HOME", "CODEWITH_HOME",
])];
let inherited: NodeJS.ProcessEnv;
let fixtureRoot: string;
let stateRoots: string[];
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

function configureApi(): void {
  process.env[EMAILS_API_URL_ENV] = API_URL;
  process.env[EMAILS_API_KEY_ENV] = FIXTURE_VALUE;
}

function requireConfigurationFailure(action: () => unknown, setting: string): void {
  let thrown: unknown;
  try { action(); } catch (error) { thrown = error; }
  expect(thrown instanceof StoreConfigurationError).toBe(true);
  const error = thrown as StoreConfigurationError;
  expect(error.settings).toContain(setting);
  expect(error.message.includes(FIXTURE_VALUE)).toBe(false);
}

beforeEach(() => {
  inherited = { ...process.env };
  fixtureRoot = mkdtempSync(join(tmpdir(), "emails-tui-settings-"));
  stateRoots = ["home", "config", "data", "state", "cache"].map(name => join(fixtureRoot, name));
  for (const root of stateRoots) mkdirSync(root, { mode: 0o700 });
  for (const key of SETTINGS) delete process.env[key];
  [process.env.HOME, process.env.XDG_CONFIG_HOME, process.env.XDG_DATA_HOME,
    process.env.XDG_STATE_HOME, process.env.XDG_CACHE_HOME] = stateRoots;
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("settings must not dispatch HTTP"); });
  configureApi();
});

afterEach(() => {
  try {
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    for (const root of stateRoots) expect(readdirSync(root)).toEqual([]);
  } finally {
    fetchSpy.mockRestore();
    for (const key of Object.keys(process.env)) if (!(key in inherited)) delete process.env[key];
    Object.assign(process.env, inherited);
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

describe("canonical TUI settings", () => {
  test("direct API credentials return the API defaults without opening local config", () => {
    expect(getSettings()).toEqual(DEFAULTS);
    expect(getRemoteSettings()).toEqual(DEFAULTS);
  });

  test("returns a fresh defaults object for each read", () => {
    const first = getSettings();
    first.theme = "dark";
    first.defaultFrom = "fixture@example.test";
    expect(getSettings()).toEqual(DEFAULTS);
  });

  test("every settings write keeps the existing API-only refusal", () => {
    const changes: TuiSettings = {
      autoPull: true, dimRead: true, defaultMailbox: "sent",
      defaultAddress: "inbox@example.test", defaultFrom: "sender@example.test", theme: "dark",
    };
    for (const key of Object.keys(changes) as Array<keyof TuiSettings>) {
      expect(() => setSetting(key, changes[key])).toThrow(/API-only/);
      expect(() => setRemoteSetting(key, changes[key])).toThrow(/API-only/);
    }
  });

  test("retained URL and key aliases do not revive local settings", () => {
    delete process.env[EMAILS_API_URL_ENV];
    delete process.env[EMAILS_API_KEY_ENV];
    for (const urlSetting of EMAILS_API_URL_SETTINGS) for (const keySetting of EMAILS_API_KEY_SETTINGS) {
      process.env[urlSetting] = API_URL;
      process.env[keySetting] = FIXTURE_VALUE;
      expect(getSettings()).toEqual(DEFAULTS);
      expect(() => setSetting("theme", "dark")).toThrow(/API-only/);
      delete process.env[urlSetting];
      delete process.env[keySetting];
    }
  });

  test("all retired selectors including blanks reject before defaults or writes", () => {
    for (const setting of RETIRED_EMAILS_SELECTOR_SETTINGS) for (const value of ["local", "self_hosted", ""]) {
      process.env[setting] = value;
      requireConfigurationFailure(getSettings, setting);
      requireConfigurationFailure(() => setSetting("theme", "dark"), setting);
      requireConfigurationFailure(getRemoteSettings, setting);
      requireConfigurationFailure(() => setRemoteSetting("theme", "dark"), setting);
      delete process.env[setting];
    }
  });

  test("removing credentials after a successful read fails closed", () => {
    expect(getSettings()).toEqual(DEFAULTS);
    delete process.env[EMAILS_API_KEY_ENV];
    requireConfigurationFailure(getSettings, EMAILS_API_KEY_ENV);
    requireConfigurationFailure(() => setSetting("theme", "dark"), EMAILS_API_KEY_ENV);
  });

  test("missing or blank endpoints cannot select a local configuration file", () => {
    delete process.env[EMAILS_API_URL_ENV];
    requireConfigurationFailure(getSettings, EMAILS_API_URL_ENV);
    process.env[EMAILS_API_URL_ENV] = "";
    requireConfigurationFailure(getSettings, EMAILS_API_URL_ENV);
    requireConfigurationFailure(() => setSetting("theme", "dark"), EMAILS_API_URL_ENV);
  });

  test("conflicting aliases reject instead of reading or writing settings", () => {
    process.env.EMAILS_API_URL = "https://other.example.invalid";
    requireConfigurationFailure(getSettings, "EMAILS_API_URL");
    delete process.env.EMAILS_API_URL;
    process.env.EMAILS_API_KEY = "fixture-other";
    requireConfigurationFailure(() => setSetting("theme", "dark"), "EMAILS_API_KEY");
  });

  test("explicit client database settings never enable local preference storage", () => {
    for (const setting of CLIENT_DATABASE_SETTINGS) {
      process.env[setting] = ":memory:";
      requireConfigurationFailure(getSettings, setting);
      requireConfigurationFailure(() => setSetting("theme", "dark"), setting);
      delete process.env[setting];
    }
  });

  test("leaves an existing preference file and its permissions unchanged", () => {
    const legacy = join(fixtureRoot, "legacy");
    mkdirSync(legacy, { mode: 0o700 });
    process.env.HASNA_EMAILS_HOME = legacy;
    const path = join(legacy, "config.json");
    const bytes = JSON.stringify({ tui_theme: "dark", default_provider: "fixture-provider" });
    writeFileSync(path, bytes, { mode: 0o640 });
    const mode = statSync(path).mode;
    expect(getSettings()).toEqual(DEFAULTS);
    expect(() => setSetting("theme", "auto")).toThrow(/API-only/);
    expect(readFileSync(path, "utf8")).toBe(bytes);
    expect(statSync(path).mode).toBe(mode);
  });
});
