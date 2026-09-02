// Exercise a normal consumer under the actual canonical test environment builder.
// The harness must not select a database or inherit an operator API identity. Each
// fixture configures its own service, and explicit client DB settings must reject
// before a request. A real domain-row round trip prevents a construction-only pass.
// Exact environment restoration matters because Bun shares one process across files.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPrepublishTestEnv } from "../scripts/prepublish-local-test.mjs";
import { HTTP_STORE_CAPABILITIES } from "./store-http/index.js";
import { SQLITE_STORE_CAPABILITIES } from "./store-sqlite/index.js";
import {
  API_BASE_URL_SETTING, API_CREDENTIAL_SETTINGS, API_SETTINGS_POINTER,
  DATABASE_PATH_SETTINGS, StoreConfigurationError,
  createConfiguredEmailStore, planEmailStore,
} from "./store-resolution.js";
import {
  EMAILS_API_KEY_ENV, EMAILS_API_URL_SETTINGS, RETIRED_EMAILS_SELECTOR_SETTINGS,
} from "./lib/client-settings.js";
import { startV1Stub, type V1Stub } from "./test-support/v1-stub.js";

const CLIENT_SETTINGS = [...new Set([
  ...DATABASE_PATH_SETTINGS, ...RETIRED_EMAILS_SELECTOR_SETTINGS,
  ...EMAILS_API_URL_SETTINGS, ...API_CREDENTIAL_SETTINGS, API_SETTINGS_POINTER,
])];
const POISONED_DATABASE_SETTINGS = ["EMAILS_DB_PATH", "HASNA_EMAILS_DB_PATH"] as const;

/** Compare every key/value without printing credentials, DSNs or their digests. */
function expectExactEnvironment(before: NodeJS.ProcessEnv): void {
  expect(Object.keys(process.env).sort()).toEqual(Object.keys(before).sort());
  for (const key of Object.keys(before)) {
    expect(process.env[key] === before[key], `${key} was not restored exactly`).toBe(true);
  }
}

function noDatabasePathIsConfigured(): void {
  for (const setting of DATABASE_PATH_SETTINGS) {
    expect(Object.hasOwn(process.env, setting), `${setting} remains configured`).toBe(false);
  }
}

function expectDatabaseRefusal(action: () => unknown, settings: readonly string[]): void {
  let thrown: unknown;
  try { action(); } catch (error) { thrown = error; }
  expect(thrown).toBeInstanceOf(StoreConfigurationError);
  expect((thrown as StoreConfigurationError).settings).toEqual(settings);
  expect(String((thrown as Error).message)).not.toContain(stub.apiKey);
}

let stub: V1Stub;
let inherited: NodeJS.ProcessEnv;

beforeAll(async () => { stub = await startV1Stub(); });
afterAll(async () => { await stub.stop(); });
beforeEach(async () => {
  inherited = { ...process.env };
  await stub.reset();
  // Make this file independent of an explicit storage fixture run before it.
  for (const setting of CLIENT_SETTINGS) delete process.env[setting];
});
afterEach(() => {
  stub.clearEnv();
  for (const key of Object.keys(process.env)) {
    if (!Object.hasOwn(inherited, key)) delete process.env[key];
  }
  Object.assign(process.env, inherited);
});

describe("the canonical test harness has no implicit client store", () => {
  it("sanitizes the actual execution environment and requires explicit API configuration", () => {
    const poisoned: NodeJS.ProcessEnv = { PATH: process.env.PATH };
    for (const setting of CLIENT_SETTINGS) poisoned[setting] = "fixture-value";
    const env = buildPrepublishTestEnv(poisoned, join(tmpdir(), "emails-harness-env-fixture"));
    expect(env.PATH).toBe(process.env.PATH);
    for (const setting of CLIENT_SETTINGS) expect(Object.hasOwn(env, setting), setting).toBe(false);
    expect(() => planEmailStore(env)).toThrow(StoreConfigurationError);
    expect(() => planEmailStore(env)).toThrow(API_BASE_URL_SETTING);
    expect(() => createConfiguredEmailStore()).toThrow(API_BASE_URL_SETTING);
    noDatabasePathIsConfigured();
  });

  it("rejects each explicit database setting before any domain request even with valid API configuration", async () => {
    stub.applyEnv();
    for (const setting of DATABASE_PATH_SETTINGS) {
      process.env[setting] = ":memory:";
      expectDatabaseRefusal(() => planEmailStore(), [setting]);
      expectDatabaseRefusal(() => createConfiguredEmailStore(), [setting]);
      delete process.env[setting];
    }
    expect(await stub.listQueries("domains")).toEqual([]);
  });
});

describe("a normal consumer under the canonical API fixture", () => {
  it("reaches the API store and serves rows from the configured service", async () => {
    await stub.seed({
      domains: [{ id: "domain-harness-1", domain: "harness.example.test", status: "ready", verified: true }],
    });
    stub.applyEnv();
    const store = createConfiguredEmailStore();
    expect(store.capabilities).toEqual(HTTP_STORE_CAPABILITIES);
    expect(HTTP_STORE_CAPABILITIES).not.toEqual(SQLITE_STORE_CAPABILITIES);
    expect(store.descriptor.detail).toBe(`Emails API at ${stub.baseUrl}`);
    expect(store.descriptor.detail).not.toContain(stub.apiKey);
    const answer = await store.domains.listDomains();
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.map((row) => row.domain)).toEqual(["harness.example.test"]);
    expect(answer.value[0]?.id).toBe("domain-harness-1");
    expect((await stub.listQueries("domains")).length).toBeGreaterThan(0);
  });

  it("clears both database aliases before configuring the API", async () => {
    for (const setting of POISONED_DATABASE_SETTINGS) process.env[setting] = ":memory:";
    process.env[API_BASE_URL_SETTING] = stub.baseUrl;
    process.env[EMAILS_API_KEY_ENV] = stub.apiKey;
    expectDatabaseRefusal(() => createConfiguredEmailStore(), POISONED_DATABASE_SETTINGS);
    expect(await stub.listQueries("domains")).toEqual([]);
    stub.applyEnv();
    noDatabasePathIsConfigured();
    const plan = planEmailStore();
    expect(plan.store).toBe("api");
    expect(plan.baseUrl).toBe(stub.baseUrl);
    expect(() => createConfiguredEmailStore()).not.toThrow();
  });
});

describe("fixture configuration is restored exactly", () => {
  it("restores every managed setting to its prior value", () => {
    for (const setting of CLIENT_SETTINGS) process.env[setting] = "prior-fixture";
    const before = { ...process.env };
    stub.applyEnv();
    noDatabasePathIsConfigured();
    stub.clearEnv();
    expectExactEnvironment(before);
    expect(() => planEmailStore()).toThrow(StoreConfigurationError);
  });

  it("restores absent and blank database settings distinctly", () => {
    delete process.env.EMAILS_DB_PATH;
    process.env.HASNA_EMAILS_DB_PATH = "";
    const before = { ...process.env };
    stub.applyEnv();
    noDatabasePathIsConfigured();
    stub.clearEnv();
    expectExactEnvironment(before);
    expect(Object.hasOwn(process.env, "EMAILS_DB_PATH")).toBe(false);
    expect(Object.hasOwn(process.env, "HASNA_EMAILS_DB_PATH")).toBe(true);
    expect(process.env.HASNA_EMAILS_DB_PATH).toBe("");
    expectDatabaseRefusal(() => planEmailStore(), ["HASNA_EMAILS_DB_PATH"]);
  });

  it("does not re-snapshot on a second applyEnv", () => {
    process.env.EMAILS_DB_PATH = ":memory:";
    const before = { ...process.env };
    stub.applyEnv();
    stub.applyEnv();
    noDatabasePathIsConfigured();
    stub.clearEnv();
    expectExactEnvironment(before);
    expectDatabaseRefusal(() => planEmailStore(), ["EMAILS_DB_PATH"]);
  });

  it("does not change the environment when clearEnv runs without applyEnv", () => {
    process.env.HASNA_EMAILS_DB_PATH = ":memory:";
    const before = { ...process.env };
    stub.clearEnv();
    expectExactEnvironment(before);
    expectDatabaseRefusal(() => planEmailStore(), ["HASNA_EMAILS_DB_PATH"]);
  });
});
