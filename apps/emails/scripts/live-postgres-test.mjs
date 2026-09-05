#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildPrepublishTestEnv } from "./prepublish-local-test.mjs";

// Every server integration file is required. Discovery below rejects omissions,
// including a newly added file, rather than silently certifying an old subset.
export const LIVE_POSTGRES_SUITES = Object.freeze([
  "attachment-inventory.integration.test.ts",
  "idp.integration.test.ts",
  "inbox-perf.integration.test.ts",
  "message-id-resolution.integration.test.ts",
  "multi-tenancy.integration.test.ts",
  "postgres.integration.test.ts",
  "rls.integration.test.ts",
  "send-failure-semantics.integration.test.ts",
  "send-honesty-and-reconciliation.integration.test.ts",
  "store-conformance.integration.test.ts",
  "webhooks.integration.test.ts",
]);

// These optional checks have private/external prerequisites: a production-schema
// artifact and an independently running identity service. Neither input is
// admitted here. The private-dump SQL check remains outside this gate's claim;
// every self-contained SQL case must actually run.
export const OPTIONAL_SKIPS = Object.freeze({
  "postgres.integration.test.ts": "self-hosted Postgres integration > migrates the REAL prod schema dump and every server write succeeds",
  "idp.integration.test.ts": "live @hasna/tenants JWKS endpoint > serves a JWKS the authenticator accepts, and refuses our locally-signed token (typed unknown_kid)",
});

// Executed-case floors from the registration census (166 cases, including the
// two named optional checks and one non-SQL key-fixture control). The 34 original
// tenancy cases plus a new live key lifecycle case remain required; the local
// control does not replace their SQL evidence. A one-test replacement cannot pass.
export const MINIMUM_PASS_COUNTS = Object.freeze({
  "attachment-inventory.integration.test.ts": 28,
  "idp.integration.test.ts": 8,
  "inbox-perf.integration.test.ts": 7,
  "message-id-resolution.integration.test.ts": 5,
  "multi-tenancy.integration.test.ts": 36,
  "postgres.integration.test.ts": 22,
  "rls.integration.test.ts": 12,
  "send-failure-semantics.integration.test.ts": 7,
  "send-honesty-and-reconciliation.integration.test.ts": 17,
  "store-conformance.integration.test.ts": 7,
  "webhooks.integration.test.ts": 15,
});

export function validateTestDatabaseUrl(value) {
  const refuse = () => { throw new Error("EMAILS_TEST_DATABASE_URL must name the disposable emails_test database and user on literal 127.0.0.1, without URL options"); };
  if (typeof value !== "string" || !value || /[\s\x00-\x1f\x7f?#]/.test(value)) refuse();
  let url;
  try { url = new URL(value); } catch { refuse(); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || url.hostname !== "127.0.0.1" || url.username !== "emails_test"
    || !["", "emails_test"].includes(url.password) || url.pathname !== "/emails_test"
    || !url.port || !/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535) refuse();
  return value;
}

export function buildLivePostgresEnv(processEnv, home) {
  const databaseUrl = validateTestDatabaseUrl(processEnv.EMAILS_TEST_DATABASE_URL);
  return {
    ...buildPrepublishTestEnv(processEnv, home),
    NO_COLOR: "1", FORCE_COLOR: "0",
    EMAILS_TEST_DATABASE_URL: databaseUrl,
    // The existing integrations read this older test-only name. Keep the
    // Contracts-standard input authoritative, never inherit a second target.
    EMAILS_TEST_POSTGRES_URL: databaseUrl,
    EMAILS_REQUIRE_POSTGRES_TESTS: "1",
  };
}

export function assertSuiteInventory(actual) {
  if (actual.length !== LIVE_POSTGRES_SUITES.length
    || JSON.stringify([...actual].sort()) !== JSON.stringify(LIVE_POSTGRES_SUITES)) {
    throw new Error("PostgreSQL gate inventory differs from the required server integration suites");
  }
}

export function inspectSuiteResult(suite, result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
  const reject = (reason) => ({ ok: false, reason });
  if (!LIVE_POSTGRES_SUITES.includes(suite)) return reject("unknown integration suite");
  if (result.status !== 0 || result.signal || result.error) return reject("test process failed or did not finish");
  const summaries = [...output.matchAll(/^Ran (\d+) tests? across (\d+) files?\./gm)];
  const counts = (label) => [...output.matchAll(new RegExp(`^\\s*(\\d+) ${label}\\s*$`, "gm"))];
  const passed = counts("pass");
  const failed = counts("fail");
  const skipped = counts("skip");
  if (summaries.length !== 1 || passed.length !== 1 || failed.length !== 1 || skipped.length > 1)
    return reject("missing or ambiguous final Bun summary");
  const passCount = Number(passed[0][1]);
  const skipCount = Number(skipped[0]?.[1] ?? 0);
  if (passCount < MINIMUM_PASS_COUNTS[suite] || Number(failed[0][1]) !== 0 || Number(summaries[0][2]) !== 1
    || Number(summaries[0][1]) !== passCount + skipCount)
    return reject("empty, failing, or inconsistent test totals");
  const withoutTiming = (label) => label.replace(/ \[[\d.]+(?:ms|s)\]$/, "");
  const labelsIn = (text) => [...text.matchAll(/^\(skip\) (.+)$/gm)].map((match) => withoutTiming(match[1]));
  // Bun repeats skipped events in a terminal recap for longer runs. Validate
  // that block against both the original events and final count; merely
  // deduplicating labels would hide a genuinely repeated/skipped test.
  const recaps = [...output.matchAll(/^(\d+) tests? skipped:[ \t]*\r?$/gm)];
  if (recaps.length > 1) return reject("ambiguous skipped-test recap");
  let eventOutput = output;
  let recapLabels;
  if (recaps.length === 1) {
    const recap = recaps[0];
    if (Number(recap[1]) !== skipCount || skipCount === 0 || recap.index >= passed[0].index)
      return reject("skipped-test recap does not match the summary");
    const lines = output.slice(recap.index + recap[0].length, passed[0].index)
      .split(/\r?\n/).filter((line) => line.trim());
    if (lines.length !== skipCount || lines.some((line) => !/^\(skip\) .+$/.test(line)))
      return reject("incomplete or unexpected skipped-test recap");
    recapLabels = lines.map((line) => withoutTiming(line.slice(7)));
    eventOutput = output.slice(0, recap.index) + output.slice(passed[0].index);
  }
  const skipLabels = labelsIn(eventOutput);
  if (skipLabels.length !== skipCount || skipCount !== (OPTIONAL_SKIPS[suite] ? 1 : 0)
    || skipLabels.some((label) => label !== OPTIONAL_SKIPS[suite])
    || (recapLabels && JSON.stringify(recapLabels) !== JSON.stringify(skipLabels)))
    return reject("unexpected or unaccounted skipped test");
  if (/^\(fail\)/m.test(output) || [...output.matchAll(/^\(pass\) /gm)].length !== passCount)
    return reject("test events do not match the final summary");
  return { ok: true, passed: passCount, skipped: skipCount };
}

export function executeSuiteProcesses(packageRoot, env, execute = spawnSync, emit = (stdout, stderr, message) => {
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  console.log(message);
}) {
  const results = [];
  for (const suite of LIVE_POSTGRES_SUITES) {
    // Several files reset public and cluster-global probe roles. Only a
    // disposable cluster is suitable; separate sequential processes eliminate
    // cross-file races and retain later results after an earlier failure.
    // Existing hook/case deadlines are unchanged; allow natural pool shutdown.
    const result = execute(process.execPath, ["--no-env-file", "--no-install", "test", join(packageRoot, "src/server/self-hosted", suite)], {
      cwd: packageRoot, env, encoding: "utf8", timeout: 600_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const evidence = inspectSuiteResult(suite, result);
    results.push({ suite, ...evidence });
    emit(result.stdout ?? "", result.stderr ?? "",
      `${evidence.ok ? "PASS" : "FAIL"} PostgreSQL ${suite}: ${evidence.ok ? `${evidence.passed} passed, ${evidence.skipped} named optional checks skipped` : evidence.reason}`);
  }
  return results;
}

export function runLivePostgresTests(processEnv = process.env) {
  // Validation precedes all process/database work, and never echoes the input.
  validateTestDatabaseUrl(processEnv.EMAILS_TEST_DATABASE_URL);
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const suiteRoot = join(packageRoot, "src/server/self-hosted");
  assertSuiteInventory(readdirSync(suiteRoot).filter((name) => name.endsWith(".integration.test.ts")));
  if (existsSync(join(packageRoot, ".prod-full-schema.sql")))
    throw new Error("Refusing a private schema artifact in the disposable PostgreSQL gate");
  const home = mkdtempSync(join(tmpdir(), "emails-live-postgres-"));
  let failed = 0;
  try {
    for (const name of ["config", "data", "cache", "state", "tmp"]) mkdirSync(join(home, name));
    const env = buildLivePostgresEnv(processEnv, home);
    failed = executeSuiteProcesses(packageRoot, env).filter((result) => !result.ok).length;
  } finally {
    // Only the fresh directory created by this invocation is removed.
    rmSync(home, { recursive: true, force: true });
  }
  console.log(`PostgreSQL gate: ${LIVE_POSTGRES_SUITES.length} required files attempted; ${failed} failed acceptance.`);
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) {
  try { process.exitCode = runLivePostgresTests(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
