// A CONSUMER RESOLVING ITS STORE FROM CONFIGURATION, UNDER THE REAL TEST HARNESS.
//
// src/store-resolution.test.ts covers the resolver by building its own environment
// objects, and that is right for a unit test of `planEmailStore`. It also means that
// suite could be entirely green while NO CALLER COULD ADOPT THE RESOLVER, which is
// exactly what happened before the harness was corrected: the harness pinned a
// database path for the whole suite, `V1Stub.applyEnv()` then added an API base URL
// and left the database path in place, and every API-client test therefore ran with
// TWO configured places to keep its mail. `planEmailStore` refuses that configuration
// — correctly, and that refusal must never be softened into a precedence rule — so
// any product code that called `createConfiguredEmailStore()` threw a boot error
// instead of running, in dozens of test files.
//
// The resolver was right; the HARNESS was the thing configuring two stores. The
// ambient environment of a hermetic run is now NEUTRAL: `buildPrepublishTestEnv`
// (scripts/prepublish-local-test.mjs) passes through ONLY an execution-key allowlist
// plus isolated HOME/XDG/temp settings, so neither database-path setting, no API
// origin, no credential and no client-env pointer are ever present, and
// scripts/run-hermetic-tests.sh delegates the whole suite to that builder instead of
// pinning a local store inline. This file is the test that fix has to satisfy, and it
// is deliberately written so it cannot pass vacuously:
//
//   * the neutrality is not assumed — it is asserted IN TWO INDEPENDENT DIRECTIONS:
//     `buildPrepublishTestEnv` is fed a hostile environment carrying every store
//     setting and must return an environment that carries none, and
//     `run-hermetic-tests.sh` must not itself assign or scrub a database path
//     (delegation only) — a harness that stopped being neutral fails the guard below
//     rather than quietly making these tests trivial;
//   * the FIRST test asserts the ambient neutrality on its own FAILS CLOSED — a boot
//     error naming the required API environment, never a store plan (the fail-closed
//     ruling removed the "resolve to SQLite at the documented default" row) — and
//     that adding an explicit database path to that same environment resolves to
//     SQLite at the configured path. Without those controls, "the API store came
//     back after applyEnv()" would also be satisfied by a harness that never
//     configured a local store, and the fix would be unproven;
//   * the consumer test does a real round trip through the returned store to the stub
//     and asserts the ROWS came from there, because a constructed HTTP store that never
//     reached the service would satisfy a capabilities check alone.
//
// The save/restore symmetry gets its own tests because bun runs every file in ONE
// process: a database path removed and not put back is a cross-file contamination bug
// that surfaces as a baffling failure in some later file, and "restored" to an empty
// string is not the same environment as absent.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPrepublishTestEnv } from "../scripts/prepublish-local-test.mjs";
import { HTTP_STORE_CAPABILITIES } from "./store-http/index.js";
import { SQLITE_STORE_CAPABILITIES } from "./store-sqlite/index.js";
import {
  API_BASE_URL_SETTING,
  API_CREDENTIAL_SETTINGS,
  API_SETTINGS_POINTER,
  DATABASE_PATH_SETTINGS,
  StoreConfigurationError,
  createConfiguredEmailStore,
  planEmailStore,
} from "./store-resolution.js";
import { startV1Stub, type V1Stub } from "./test-support/v1-stub.js";

/**
 * The hermetic test environment must be store-neutral, and that neutrality must be
 * proven in two independent directions, both read out of the harness itself.
 *
 * NOT restated here on purpose. Each setting's name is the first half of the two-store
 * contradiction, so a copy of it in this file could drift from the harness and leave
 * these tests exercising a condition production runs no longer have.
 */
function harnessIsStoreNeutral(): void {
  // Direction 1: the env builder must drop every store setting even when handed a
  // hostile process environment that carries all of them (allowlist, not scrubbing:
  // the builder must never pass a store setting through in the first place).
  const hostile: Record<string, string> = {
    HOME: "/operator/home",
    USERPROFILE: "/operator/home",
    PATH: "/test/bin",
    ...Object.fromEntries([...DATABASE_PATH_SETTINGS, API_BASE_URL_SETTING, ...API_CREDENTIAL_SETTINGS, API_SETTINGS_POINTER]
      .map((key, index) => [key, `hostile-${index}`])),
  };
  const built = buildPrepublishTestEnv(hostile, "/isolated/home");
  for (const setting of [...DATABASE_PATH_SETTINGS, API_BASE_URL_SETTING, ...API_CREDENTIAL_SETTINGS, API_SETTINGS_POINTER]) {
    if (Object.prototype.hasOwnProperty.call(built, setting)) {
      throw new Error(`expected the hermetic env builder to never carry ${setting}; the allowlist leaked it`);
    }
  }

  // Direction 2: the runner script must not assign, export or scrub any store setting
  // itself — it delegates to the env builder and nothing else. (It used to pin
  // EMAILS_DB_PATH=:memory: inline — before deployment modes were removed it also
  // pinned the mode variable there; that shape must not return.)
  const runner = readFileSync(join(import.meta.dir, "..", "scripts", "run-hermetic-tests.sh"), "utf8");
  for (const setting of [...DATABASE_PATH_SETTINGS, API_BASE_URL_SETTING, ...API_CREDENTIAL_SETTINGS, API_SETTINGS_POINTER]) {
    if (new RegExp(`\\b${setting}=`).test(runner) || new RegExp(`-u ${setting}\\b`).test(runner)) {
      throw new Error(`expected run-hermetic-tests.sh to never mention ${setting}; the harness is not neutral`);
    }
  }
  if (!/prepublish-local-test\.mjs/.test(runner)) {
    throw new Error("expected run-hermetic-tests.sh to delegate to prepublish-local-test.mjs");
  }
}

harnessIsStoreNeutral();

/** The higher-precedence setting, which a fix that handled only one of them would leave set. */
const HIGHER_PRECEDENCE_SETTING = DATABASE_PATH_SETTINGS[0];
const HIGHER_PRECEDENCE_VALUE = ":memory:";

/**
 * The settings whose VALUES may appear in a failure message: the two database paths and
 * the API origin. None of them can carry a credential, and they are the ones a reviewer
 * has to be able to read when this file goes red.
 */
const PRINTABLE_SETTINGS: ReadonlySet<string> = new Set<string>([
  ...DATABASE_PATH_SETTINGS,
  API_BASE_URL_SETTING,
]);

/**
 * The whole environment as a comparable value, with every value that is NOT in
 * `PRINTABLE_SETTINGS` replaced by a digest of itself.
 *
 * WHY NOT `{ ...process.env }`. A failed `toEqual` prints both operands, the hermetic
 * harness carries only an execution allowlist, and the ambient environment of a real
 * test run can still carry unrelated live credentials — so a raw whole-environment
 * comparison turns any regression here into a secret disclosure in a CI log. Digesting
 * is not a weakening: the KEY SET is still compared exactly, which is what catches a
 * leaked or stripped variable, and a digest changes whenever a value changes, which is
 * what catches a wrong restore. It only refuses to say what the value was.
 */
function comparableEnv(): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const key of Object.keys(process.env).sort()) {
    const value = process.env[key] ?? "";
    facts[key] = PRINTABLE_SETTINGS.has(key)
      ? value
      : `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
  }
  return facts;
}

/** Every database-path setting is gone from the environment. */
function noDatabasePathIsConfigured(): void {
  for (const setting of DATABASE_PATH_SETTINGS) {
    expect(
      Object.prototype.hasOwnProperty.call(process.env, setting),
      `${setting} is still configured while the API is`,
    ).toBe(false);
  }
}

let stub: V1Stub;
let inherited: NodeJS.ProcessEnv;

beforeAll(async () => {
  stub = await startV1Stub();
});

afterAll(async () => {
  await stub.stop();
});

beforeEach(async () => {
  inherited = { ...process.env };
  await stub.reset();
  // Reproduce the harness's ambient neutrality exactly, so the two-store
  // contradiction these tests build is the one being tested however this file
  // was launched: no database-path setting, no API origin, no credential, no
  // client-env pointer.
  for (const setting of [
    ...DATABASE_PATH_SETTINGS,
    API_BASE_URL_SETTING,
    ...API_CREDENTIAL_SETTINGS,
    API_SETTINGS_POINTER,
  ]) {
    delete process.env[setting];
  }
});

afterEach(() => {
  stub.clearEnv();
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(inherited, key)) delete process.env[key];
  }
  Object.assign(process.env, inherited);
});

describe("the ambient test environment configures exactly one store", () => {
  it("fails closed on the neutral ambient environment, and resolves only an explicit path", () => {
    // POSITIVE CONTROL for every test below. The ambient environment is NEUTRAL —
    // no database path and no API settings — and under the fail-closed ruling that
    // neutrality REFUSES instead of defaulting: planEmailStore throws, so "the API
    // store came back after applyEnv()" is a fact about applyEnv() installing it,
    // and not about it already being there.
    noDatabasePathIsConfigured();
    expect(process.env[API_BASE_URL_SETTING]).toBeUndefined();
    let thrown: unknown;
    try {
      planEmailStore(process.env);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StoreConfigurationError);
    expect((thrown as StoreConfigurationError).message).toContain(API_BASE_URL_SETTING);
    // The refusal is not a dead end: the same neutral environment plus an explicit
    // database path is a local store, which is the harness's own fixture shape.
    const explicit = { ...process.env, [HIGHER_PRECEDENCE_SETTING]: HIGHER_PRECEDENCE_VALUE };
    const plan = planEmailStore(explicit);
    expect(plan.store).toBe("sqlite");
    if (plan.store !== "sqlite") return;
    expect(plan.setting).toBe(HIGHER_PRECEDENCE_SETTING);
    expect(plan.databasePath).toBe(HIGHER_PRECEDENCE_VALUE);
  });

  it("would refuse to boot if a stub added an API while a database path stayed configured", () => {
    // The blocker itself, stated as a test rather than as prose: this is what API
    // tests looked like before the harness became neutral, and it is what the
    // contract must keep refusing. The refusal names the KEYS at fault and never
    // a value.
    const contradiction = {
      ...process.env,
      [HIGHER_PRECEDENCE_SETTING]: HIGHER_PRECEDENCE_VALUE,
      [API_BASE_URL_SETTING]: stub.baseUrl,
      [API_CREDENTIAL_SETTINGS[2]]: stub.apiKey,
    };
    let thrown: unknown;
    try {
      planEmailStore(contradiction);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StoreConfigurationError);
    expect((thrown as StoreConfigurationError).settings).toContain(HIGHER_PRECEDENCE_SETTING);
    expect((thrown as StoreConfigurationError).settings).toContain(API_BASE_URL_SETTING);
    expect(String((thrown as Error).message)).not.toContain(stub.apiKey);
  });
});

describe("a consumer calling createConfiguredEmailStore() under a self-hosted test", () => {
  it("reaches the API store and serves rows from the configured service", async () => {
    await stub.seed({
      domains: [
        { id: "domain-harness-1", domain: "harness.example.test", status: "ready", verified: true },
      ],
    });
    stub.applyEnv();

    // PRODUCT CODE. No injected environment, no injected base URL: the same call a CLI
    // or MCP boot path makes. On unmodified main this line throws StoreConfigurationError.
    const store = createConfiguredEmailStore();

    // Identified by the capability set it DECLARES rather than by a label a caller
    // branches on (see src/store/descriptor.ts).
    expect(store.capabilities).toEqual(HTTP_STORE_CAPABILITIES);
    // ...and the two sets differ, so that assertion actually discriminates.
    expect(HTTP_STORE_CAPABILITIES).not.toEqual(SQLITE_STORE_CAPABILITIES);
    expect(store.descriptor.detail).toBe(`Emails API at ${stub.baseUrl}`);
    expect(store.descriptor.detail).not.toContain(stub.apiKey);

    // THE ROUND TRIP. A constructed HTTP store that never reached the service would
    // satisfy everything above, so the proof is that the rows came out of the stub.
    const answer = await store.domains.listDomains();
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.map((row) => row.domain)).toEqual(["harness.example.test"]);
    expect(answer.value[0]?.id).toBe("domain-harness-1");
    // The request was made SERVER-side against the stub, not synthesized locally.
    expect((await stub.listQueries("domains")).length).toBeGreaterThan(0);
  });

  it("removes both database-path settings, not only the lower-precedence one", () => {
    // A fix that unset `EMAILS_DB_PATH` and left `HASNA_EMAILS_DB_PATH` set would leave
    // the HIGHER-precedence setting configured and the boot error exactly where it was.
    process.env[HIGHER_PRECEDENCE_SETTING] = HIGHER_PRECEDENCE_VALUE;
    expect(planEmailStore(process.env).store).toBe("sqlite");

    stub.applyEnv();

    noDatabasePathIsConfigured();
    const plan = planEmailStore(process.env);
    expect(plan.store).toBe("api");
    if (plan.store !== "api") return;
    expect(plan.baseUrl).toBe(stub.baseUrl);
    expect(() => createConfiguredEmailStore()).not.toThrow();
  });
});

describe("the local-store configuration comes back exactly as it was", () => {
  it("restores every managed setting to its prior value", () => {
    process.env[HIGHER_PRECEDENCE_SETTING] = HIGHER_PRECEDENCE_VALUE;
    const before = comparableEnv();

    stub.applyEnv();
    // The restore is only worth asserting if something was actually removed. Without
    // this line the test would pass over a helper that never touched the database path.
    noDatabasePathIsConfigured();
    stub.clearEnv();

    // Whole-environment equality, not a key-by-key spot check: a leaked variable is a
    // cross-file contamination bug and the leak is not always the one being tested.
    expect(comparableEnv()).toEqual(before);
    const plan = planEmailStore(process.env);
    expect(plan.store).toBe("sqlite");
    if (plan.store !== "sqlite") return;
    // The higher-precedence setting wins again, which it cannot do if it came back
    // missing or blank.
    expect(plan.setting).toBe(HIGHER_PRECEDENCE_SETTING);
    expect(plan.databasePath).toBe(HIGHER_PRECEDENCE_VALUE);
  });

  it("restores an absent setting as absent rather than as an empty string", () => {
    delete process.env[HIGHER_PRECEDENCE_SETTING];
    const before = comparableEnv();

    stub.applyEnv();
    noDatabasePathIsConfigured();
    stub.clearEnv();

    expect(comparableEnv()).toEqual(before);
    // `""` and absent are different environments, and `comparableEnv` digests both to
    // the digest of the empty string — so the difference is asserted on the KEY, which
    // is the form that catches it. Absent, the neutral environment is the all-unset
    // row, which now FAILS CLOSED (the fail-closed ruling) rather than resolving to
    // any path — and an empty-string restore is also "blank", also all-unset, so it
    // would refuse identically: the KEY assertion above, not the plan, is what
    // discriminates the two. The resolution is still checked, as the refusal that
    // proves no hidden path leaked back in.
    expect(Object.prototype.hasOwnProperty.call(process.env, HIGHER_PRECEDENCE_SETTING)).toBe(false);
    expect(() => planEmailStore(process.env)).toThrow(StoreConfigurationError);
  });

  it("does not re-snapshot on a second applyEnv, so clearEnv still restores the original", () => {
    const before = comparableEnv();

    stub.applyEnv();
    // A re-snapshot here would record this helper's OWN writes — the database path
    // already deleted — and clearEnv() would then "restore" it as deleted, leaking a
    // missing database path into every file that runs after this one.
    stub.applyEnv();
    noDatabasePathIsConfigured();
    stub.clearEnv();

    expect(comparableEnv()).toEqual(before);
    noDatabasePathIsConfigured();
  });

  it("leaves the environment untouched when clearEnv runs without an applyEnv", () => {
    const before = comparableEnv();

    // Nothing was installed, so there is nothing to undo. Deleting the managed keys
    // here would strip configuration this helper never set — the same leak from the
    // other direction.
    stub.clearEnv();

    expect(comparableEnv()).toEqual(before);
    noDatabasePathIsConfigured();
    // Nothing was configured and nothing leaked back: the neutral environment is the
    // all-unset row, which fails closed instead of producing a store.
    expect(() => planEmailStore(process.env)).toThrow(StoreConfigurationError);
  });
});