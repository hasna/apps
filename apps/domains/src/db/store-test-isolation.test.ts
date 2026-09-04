/**
 * Regression: a test run must never resolve the PRODUCTION (hosted HTTP) store.
 *
 * The defect this pins: `src/db/domains.test.ts` (and eight sibling suites) set
 * `DOMAINS_DIR` to a mkdtemp directory believing that isolates them. It does
 * not. `DOMAINS_DIR` is read only by `getDbPath()` in `database.ts`, which is
 * reached only from `LocalStore` — i.e. only AFTER the transport has already
 * been chosen. The transport is chosen by `getStore()` from
 * `HASNA_DOMAINS_API_URL` + `HASNA_DOMAINS_API_KEY`.
 * Those two sets of variables are disjoint, so on a box where the API vars are
 * exported every `createDomain()` in the suite wrote to the production API.
 * Measured evidence: 122 rows created in the hour 2026-07-11T18, and twelve more
 * on 2026-07-24/30/31, each carrying its own run's mkdtemp path inside the
 * persisted domain name.
 *
 * These assertions are about the OUTCOME (which transport is resolved), never
 * about whether an isolation variable was set. Setting a variable is a request;
 * only the resolved transport says whether it was honoured.
 */
import { describe, expect, test } from "bun:test";
import { getStore, isCloudStore } from "./store.js";

const HOSTED_ENV = {
  HASNA_DOMAINS_API_URL: "https://domains.example.invalid",
  HASNA_DOMAINS_API_KEY: "not-a-real-key-fixture-only",
};

describe("store isolation under test", () => {
  test("BUG PINNED: hosted env + NODE_ENV=test must NOT resolve the production store", () => {
    const env = { ...HOSTED_ENV, NODE_ENV: "test", DOMAINS_DIR: "/tmp/whatever" };
    expect(isCloudStore(env)).toBe(false);
    expect((getStore(env) as unknown as { transport: string }).transport).toBe("local");
  });

  test("NO REGRESSION: outside a test run, hosted env still resolves the http transport", () => {
    const env = { ...HOSTED_ENV, NODE_ENV: "production" };
    expect(isCloudStore(env)).toBe(true);
    expect((getStore(env) as unknown as { transport: string }).transport).toBe("http");
  });

  test("NEGATIVE CONTROL: no hosted env is never a local licence — resolution fails closed", () => {
    // Fail-closed ruling: without the API env the store must not silently
    // default to local sqlite, in a test run or not.
    expect(() => isCloudStore({ NODE_ENV: "test" })).toThrow(/HASNA_DOMAINS_API_URL/);
    expect(() => isCloudStore({ NODE_ENV: "production" })).toThrow(/fails closed/);
    expect(() => getStore({ NODE_ENV: "production" })).toThrow(/HASNA_DOMAINS_API_KEY/);
    // An explicit local path opt-in still resolves local under test.
    expect(isCloudStore({ NODE_ENV: "test", DOMAINS_DIR: "/tmp/whatever" })).toBe(false);
    expect((getStore({ NODE_ENV: "test", DOMAINS_DIR: "/tmp/whatever" }) as unknown as { transport: string }).transport).toBe("local");
  });

  test("ESCAPE HATCH: an explicit opt-out re-enables the hosted store under test", () => {
    const env = { ...HOSTED_ENV, NODE_ENV: "test", HASNA_DOMAINS_ALLOW_CLOUD_IN_TESTS: "1" };
    expect(isCloudStore(env)).toBe(true);
  });

  test("the guard names the variable an operator must act on", () => {
    const env = { ...HOSTED_ENV, NODE_ENV: "test", HASNA_DOMAINS_TEST_GUARD: "throw" };
    expect(() => getStore(env)).toThrow(/HASNA_DOMAINS_ALLOW_CLOUD_IN_TESTS/);
  });
});
