#!/usr/bin/env bun
/** Required disposable PostgreSQL acceptance gate; missing/partial evidence fails. */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

export const REQUIRED_SUITES = Object.freeze({
  "src/server/intake.pg.test.ts": 15,
});

export function validateTestDatabaseUrl(value: string | undefined): string {
  const refuse = () => { throw new Error("EVENTS_TEST_DATABASE_URL must name the disposable events_test user/database on literal 127.0.0.1 with an explicit port and no URL options"); };
  if (!value || /[\s\x00-\x1f\x7f?#]/.test(value)) return refuse();
  let url: URL;
  try { url = new URL(value); } catch { return refuse(); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || url.hostname !== "127.0.0.1" || url.username !== "events_test"
    || !["", "events_test"].includes(url.password) || url.pathname !== "/events_test"
    || !url.port || !/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535) return refuse();
  return value;
}

export function buildTestEnv(source: NodeJS.ProcessEnv, home: string): Record<string, string> {
  return {
    PATH: source.PATH ?? "", HOME: home, USERPROFILE: home,
    TMPDIR: source.TMPDIR ?? tmpdir(), NO_COLOR: "1", FORCE_COLOR: "0",
    HASNA_STATION: `postgres-fixture-${randomUUID()}`,
    EVENTS_TEST_DATABASE_URL: validateTestDatabaseUrl(source.EVENTS_TEST_DATABASE_URL),
  };
}

export function discoverSuites(root: string): string[] {
  const paths: string[] = [];
  const walk = (directory: string) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.name.endsWith(".test.ts") && readFileSync(path, "utf8").includes("process.env.EVENTS_TEST_DATABASE_URL")) paths.push(relative(root, path));
    }
  };
  walk(join(root, "src"));
  return paths.sort();
}

export function assertSuiteInventory(actual: string[]): void {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify(Object.keys(REQUIRED_SUITES).sort())) {
    throw new Error("Required Events PostgreSQL suite inventory changed; update and review the executed-case census");
  }
}

export function inspectSuiteResult(suite: string, result: Pick<SpawnSyncReturns<string>, "status" | "signal" | "error" | "stdout" | "stderr">): boolean {
  const floor = REQUIRED_SUITES[suite as keyof typeof REQUIRED_SUITES];
  if (!floor || result.status !== 0 || result.signal || result.error) return false;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
  const summary = [...output.matchAll(/^Ran (\d+) tests? across (\d+) files?\./gm)];
  const passed = [...output.matchAll(/^\s*(\d+) pass\s*$/gm)];
  const failed = [...output.matchAll(/^\s*(\d+) fail\s*$/gm)];
  const skipped = [...output.matchAll(/^\s*(\d+) skip\s*$/gm)];
  if (summary.length !== 1 || passed.length !== 1 || failed.length !== 1 || skipped.length > 1) return false;
  const count = Number(passed[0]![1]);
  return count >= floor && Number(failed[0]![1]) === 0
    && Number(skipped[0]?.[1] ?? 0) === 0
    && Number(summary[0]![1]) === count && Number(summary[0]![2]) === 1
    && [...output.matchAll(/^\(pass\) /gm)].length === count
    && !/^\((?:skip|fail|todo)\)/m.test(output);
}

export function runLivePostgresTests(source = process.env): void {
  // Never substitute a production DSN, saved credential, profile, or ambient PG*.
  validateTestDatabaseUrl(source.EVENTS_TEST_DATABASE_URL);
  const root = resolve(import.meta.dir, "..");
  assertSuiteInventory(discoverSuites(root));
  const home = mkdtempSync(join(tmpdir(), "events-postgres-gate-"));
  let failed = false;
  try {
    const env = buildTestEnv(source, home);
    for (const suite of Object.keys(REQUIRED_SUITES)) {
      const result = spawnSync(process.execPath, ["--no-env-file", "--no-install", "test", suite, "--timeout", "60000"], {
        cwd: root, env, encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
      });
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
      const ok = inspectSuiteResult(suite, result);
      console.log(`[postgres-gate] ${ok ? "PASS" : "FAIL"}: ${suite}`);
      if (!ok) failed = true;
    }
    if (failed) throw new Error("Events PostgreSQL gate failed: every required case must execute without skips");
    console.log(`[postgres-gate] PASS: ${Object.keys(REQUIRED_SUITES).length} required suites, zero skips`);
  } finally { rmSync(home, { recursive: true, force: true }); }
}

if (import.meta.main) {
  try { runLivePostgresTests(); } catch (error) {
    console.error(error instanceof Error ? error.message : "Events PostgreSQL gate failed");
    process.exitCode = 1;
  }
}
