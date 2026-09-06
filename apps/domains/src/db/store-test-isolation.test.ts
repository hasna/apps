/**
 * Regression: a test run must never resolve the PRODUCTION (hosted HTTP) store.
 *
 * The isolation model is inherited from the shared resolver (hasna/apps#1720,
 * class B): the local SQLite store is reached ONLY by the explicit local
 * opt-in — one of the local path variables (`HASNA_DOMAINS_DB_PATH`,
 * `DOMAINS_DIR`, …) — and ONLY when the environment itself configures no
 * authority and no credential. The suite's `test-setup.ts` scrubs every
 * authority/credential variable this package knows about and sets `DOMAINS_DIR`
 * to a mkdtemp directory, so every suite process resolves LocalStore; and a
 * local path set NEXT TO a configured authority/credential is a hard conflict
 * error rather than a silent preference, in a test run or out of one.
 *
 * The old in-package guards (`HASNA_DOMAINS_ALLOW_CLOUD_IN_TESTS`,
 * `HASNA_DOMAINS_TEST_GUARD`, `HASNA_DOMAINS_ALLOW_CLOUD_WITH_LOCAL_PATH`,
 * the NODE_ENV=test downgrade) are GONE: they were the app's own chain, and
 * the resolver does not know them.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { getStore, getStoreResolution, isCloudStore } from "./store.js";
import { __resetLocalNotice } from "../lib/local-opt-in.js";

const HOSTED_ENV = {
  HASNA_DOMAINS_API_URL: "https://domains.example.invalid",
  HASNA_DOMAINS_API_KEY: "not-a-real-key-fixture-only",
};

describe("store isolation under test", () => {
  afterEach(() => {
    __resetLocalNotice();
  });

  test("the suite's local path opt-in with scrubbed env resolves the LOCAL store", () => {
    expect(getStoreResolution({ DOMAINS_DIR: "/tmp/test-isolation-db" }).transport).toBe("local");
    expect((getStore({ DOMAINS_DIR: "/tmp/test-isolation-db" }) as unknown as { transport: string }).transport).toBe("local");
    expect(isCloudStore({ DOMAINS_DIR: "/tmp/test-isolation-db" })).toBe(false);
  });

  test("BUG PINNED: hosted env + a local path must NOT resolve local silently — it is a hard conflict", () => {
    // The old code downgraded hosted+path to local inside a test run. That was
    // the app's own guard; the ruling's answer is a loud refusal in ANY
    // runner, because neither dataset is the one the operator clearly meant.
    const env = { ...HOSTED_ENV, NODE_ENV: "test", DOMAINS_DIR: "/tmp/whatever" };
    expect(() => isCloudStore(env)).toThrow(/Refusing to resolve the hosted domains store/);
    expect(() => getStore(env)).toThrow(/Refusing to resolve the hosted domains store/);
    expect(() => getStoreResolution(env)).toThrow(/Refusing/);
  });

  test("NO REGRESSION: hosted env outside a test run still resolves the http transport", () => {
    const env = { ...HOSTED_ENV, NODE_ENV: "production" };
    expect(isCloudStore(env)).toBe(true);
    expect((getStore(env) as unknown as { transport: string }).transport).toBe("http");
  });

  test("NEGATIVE CONTROL: no hosted env is never a local licence — resolution fails closed", () => {
    // Fail-closed ruling: without a resolvable credential the store must not
    // silently default to local sqlite, in a test run or not.
    expect(() => isCloudStore({ NODE_ENV: "test" })).toThrow(/HASNA_DOMAINS_API_URL/);
    expect(() => isCloudStore({ NODE_ENV: "production" })).toThrow(/fails closed/);
    expect(() => getStore({ NODE_ENV: "production" })).toThrow(/HASNA_DOMAINS_API_KEY/);
  });

  test("local mode says 'local' on stderr, once per process", () => {
    __resetLocalNotice();
    const lines: string[] = [];
    const env = { DOMAINS_DIR: "/tmp/test-isolation-db" };
    getStore(env, { notice: (line: string) => lines.push(line) });
    expect(lines.join("\n")).toContain("domains: LOCAL mode");
  });
});