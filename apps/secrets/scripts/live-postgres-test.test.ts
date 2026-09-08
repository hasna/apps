import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REQUIRED_SUITES, assertSuiteInventory, buildTestEnv, discoverSuites, inspectSuiteResult, validateTestDatabaseUrl } from "./live-postgres-test.js";

const url = "postgresql://secrets_test@127.0.0.1:5432/secrets_test";
const suite = "tests/lossless-migration.pg.test.ts";
const success = { status: 0, signal: null, stdout: "", stderr: Array.from({length:1},(_,i)=>`(pass) durable case ${i}`).join("\n")+"\n\n 1 pass\n 0 fail\nRan 1 test across 1 file. [1.00s]\n" };

test("only the explicitly disposable loopback test target is accepted without echoing rejected values", () => {
  expect(validateTestDatabaseUrl(url)).toBe(url);
  for (const invalid of [undefined, "", url.replace("127.0.0.1", "localhost"), url.replace("127.0.0.1", "db.example.invalid"), url.replace("secrets_test@", "other@"), url + "?options=-csearch_path=public", url.replace(":5432", ""), url.replace("@", ":synthetic-private-value@")]) {
    let message = "";
    try { validateTestDatabaseUrl(invalid); } catch (error) { message = String(error); }
    expect(message).toContain("SECRETS_TEST_DATABASE_URL");
    expect(message).not.toContain("synthetic-private-value");
  }
});

test("the gate drops ambient credentials, local database paths and client profile selectors", () => {
  const env = buildTestEnv({ PATH: "/usr/bin", SECRETS_TEST_DATABASE_URL: url, DATABASE_URL: "synthetic-private-value", PGHOST: "foreign", HASNA_SECRETS_API_KEY: "synthetic-private-value", SECRETS_DB_PATH: "/tmp/legacy.db", HASNA_PROFILE: "foreign", HASNA_STATION: "real-station" }, "/tmp/synthetic-gate-home");
  expect(Object.keys(env).sort()).toEqual(["PATH", "HOME", "USERPROFILE", "TMPDIR", "NO_COLOR", "FORCE_COLOR", "HASNA_STATION", "SECRETS_TEST_DATABASE_URL"].sort());
  expect(env.HOME).toBe("/tmp/synthetic-gate-home");
  expect(env.HASNA_STATION).toStartWith("postgres-fixture-");
  expect(JSON.stringify(env)).not.toContain("synthetic-private-value");
});

test("required suite inventory includes every real PG file and rejects removals/additions/duplicates", () => {
  const inventory = discoverSuites(resolve(import.meta.dir, ".."));
  expect(() => assertSuiteInventory(inventory)).not.toThrow();
  expect(Object.values(REQUIRED_SUITES).reduce((total, count) => total + count, 0)).toBe(3);
  for (const wrong of [inventory.slice(1), [...inventory, "src/new.pg.test.ts"], [...inventory, inventory[0]!]]) {
    expect(() => assertSuiteInventory(wrong)).toThrow("inventory changed");
  }
});

test("a crash, skip, partial output or stale passing census never certifies PostgreSQL", () => {
  expect(inspectSuiteResult(suite, success)).toBe(true);
  for (const result of [
    { ...success, status: 1 }, { ...success, signal: "SIGABRT" as const },
    { ...success, error: new Error("fixture timeout") }, { ...success, stderr: "(pass) partial output" },
    { ...success, stderr: success.stderr + success.stderr },
    { ...success, stderr: success.stderr.replace("1 pass", "0 pass") },
    { ...success, stderr: success.stderr.replace("(pass) durable case 0", "(skip) durable case 0").replace("1 pass", "0 pass\n 1 skip") },
    { ...success, stderr: success.stderr.replace("0 fail", "1 fail") },
    { ...success, stderr: success.stderr.replace("1 file", "2 files") },
    { ...success, stderr: success.stderr.replace("(pass) durable case 0\n", "") },
  ]) expect(inspectSuiteResult(suite, result)).toBe(false);
  expect(inspectSuiteResult("unknown", success)).toBe(false);
});

test("the required workflow uses read-only credentials and executes the no-skip runner", () => {
  const workflow = readFileSync(resolve(import.meta.dir, "../../../.github/workflows/secrets-live-postgres.yml"), "utf8");
  expect(workflow).toContain("contents: read");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).not.toContain("continue-on-error");
  expect(workflow).not.toContain("secrets.");
  expect(workflow).toContain("bun run test:postgres");
  expect(workflow).toContain("SECRETS_TEST_DATABASE_URL: postgres://secrets_test@127.0.0.1:5432/secrets_test");
  for (const action of workflow.matchAll(/uses: ([^\s]+)/g)) expect(action[1]).toMatch(/@[0-9a-f]{40}$/);
});
