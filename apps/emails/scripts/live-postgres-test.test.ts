import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  LIVE_POSTGRES_SUITES,
  MINIMUM_PASS_COUNTS,
  OPTIONAL_SKIPS,
  assertSuiteInventory,
  buildLivePostgresEnv,
  executeSuiteProcesses,
  inspectSuiteResult,
  validateTestDatabaseUrl,
} from "./live-postgres-test.mjs";

const packageRoot = resolve(import.meta.dir, "..");
const databaseUrl = "postgresql://emails_test:emails_test@127.0.0.1:5432/emails_test";
const suite = "store-conformance.integration.test.ts";
const passLines = (count: number) => Array.from({ length: count }, (_, i) => `(pass) actual database case ${i}`).join("\n");
const summary = (body = passLines(7), passed = 7, skipped = 0) =>
  `${body}\n ${passed} pass\n ${skipped} skip\n 0 fail\n 4 expect() calls\nRan ${passed + skipped} tests across 1 file. [1.00s]\n`;

describe("isolated PostgreSQL gate input", () => {
  test("accepts only the explicitly named disposable loopback database", () => {
    expect(validateTestDatabaseUrl(databaseUrl)).toBe(databaseUrl);
    expect(validateTestDatabaseUrl("postgres://emails_test@127.0.0.1:15432/emails_test"))
      .toBe("postgres://emails_test@127.0.0.1:15432/emails_test");
  });

  test.each([
    undefined, "", " ", `${databaseUrl}\n`, databaseUrl.replace("127.0.0.1", "production.example"),
    databaseUrl.replace("emails_test@", "operator@"), databaseUrl.replace(":emails_test@", ":private-value@"),
    databaseUrl.replace("/emails_test", "/mailbox"), `${databaseUrl}?options=-csearch_path%3Dprivate`,
    `${databaseUrl}?sslmode=disable`, `${databaseUrl}#`, `${databaseUrl}?`,
    databaseUrl.replace("postgresql:", "https:"), databaseUrl.replace("127.0.0.1", "localhost"),
  ])("refuses a missing, ambiguous, or non-disposable target without echoing it", (value) => {
    let message = "";
    try { validateTestDatabaseUrl(value); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("EMAILS_TEST_DATABASE_URL");
    expect(message).not.toContain("private-value");
    expect(message).not.toContain("production.example");
  });

  test("bridges only the validated test setting and scrubs operator/provider/preload state", () => {
    const env = buildLivePostgresEnv({
      PATH: "/test/bin", EMAILS_TEST_DATABASE_URL: databaseUrl,
      EMAILS_TEST_POSTGRES_URL: "postgresql://private.example/mail",
      EMAILS_TEST_TENANTS_JWKS_URL: "https://private.example/jwks",
      DATABASE_URL: "private-database", AWS_SECRET_ACCESS_KEY: "private-provider",
      EMAILS_API_KEY: "private-client", NODE_OPTIONS: "--require private-preload",
      BUN_OPTIONS: "private-preload", ["EMAILS_" + "MODE"]: "local", EMAILS_REQUIRE_POSTGRES_TESTS: "0",
    }, "/isolated/home");
    expect(env.EMAILS_TEST_DATABASE_URL).toBe(databaseUrl);
    expect(env.EMAILS_TEST_POSTGRES_URL).toBe(databaseUrl);
    expect(env.EMAILS_REQUIRE_POSTGRES_TESTS).toBe("1");
    expect(env.HOME).toBe("/isolated/home");
    expect(env.PATH).toBe("/test/bin");
    expect(env.AWS_EC2_METADATA_DISABLED).toBe("true");
    // The retired deployment-mode variable is spelled indirectly here: this file
    // sits inside the mode-axis ratchet corpus and must contribute zero to it,
    // while still proving the gate scrubs the carried-forward key it builds.
    for (const key of ["EMAILS_TEST_TENANTS_JWKS_URL", "DATABASE_URL", "AWS_SECRET_ACCESS_KEY", "EMAILS_API_KEY", "NODE_OPTIONS", "BUN_OPTIONS", "EMAILS_" + "MODE"])
      expect(env[key]).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain("private-");
  });

  test("the executable refuses absent or unsafe configuration before spawning integration tests", () => {
    const root = mkdtempSync(resolve(tmpdir(), "emails-pg-gate-negative-"));
    const home = resolve(root, "home");
    mkdirSync(home);
    try {
      for (const input of [undefined, "", "postgres://private-value@production.example/mail"]) {
        const env: Record<string, string> = {
          HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin",
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: resolve(root, "bun-cache"),
        };
        if (input !== undefined) env.EMAILS_TEST_DATABASE_URL = input;
        const result = spawnSync(process.execPath, ["--no-env-file", resolve(import.meta.dir, "live-postgres-test.mjs")], {
          cwd: packageRoot, env, encoding: "utf8", timeout: 3000,
        });
        expect(result.status).toBe(1);
        expect(result.error).toBeUndefined();
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("EMAILS_TEST_DATABASE_URL");
        expect(result.stderr).not.toContain("private-value");
        expect(result.stderr).not.toContain("production.example");
        expect(readdirSync(home)).toEqual([]);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("PostgreSQL evidence must be complete", () => {
  test("requires the exact nonempty server integration inventory", () => {
    const actual = readdirSync(resolve(packageRoot, "src/server/self-hosted"))
      .filter((name) => name.endsWith(".integration.test.ts"));
    expect(actual.length).toBe(11);
    expect(() => assertSuiteInventory(actual)).not.toThrow();
    expect(() => assertSuiteInventory([])).toThrow();
    expect(() => assertSuiteInventory(actual.slice(1))).toThrow();
    expect(() => assertSuiteInventory([...actual, "new.integration.test.ts"])).toThrow();
    expect(() => assertSuiteInventory([...actual, actual[0]!])).toThrow();
    expect(LIVE_POSTGRES_SUITES).toContain(suite);
    expect(Object.keys(MINIMUM_PASS_COUNTS)).toEqual(LIVE_POSTGRES_SUITES);
    expect(MINIMUM_PASS_COUNTS["multi-tenancy.integration.test.ts"]).toBe(34);
    expect(Object.values(MINIMUM_PASS_COUNTS).reduce((a, b) => a + b, 0)).toBe(162);
    expect(Object.values(MINIMUM_PASS_COUNTS).reduce((a, b) => a + b, 0) + Object.keys(OPTIONAL_SKIPS).length).toBe(164);
  });

  test("accepts complete non-skipped successful evidence", () => {
    expect(inspectSuiteResult(suite, { status: 0, stdout: "", stderr: summary() }).ok).toBe(true);
  });

  test.each([
    { status: 1, stdout: "", stderr: summary() },
    { status: null, signal: "SIGTERM", stdout: "", stderr: summary() },
    { status: 0, error: new Error("buffer overflow"), stdout: "", stderr: summary() },
    { status: 0, stdout: "", stderr: "(pass) partial output\n" },
    { status: 0, stdout: "", stderr: summary("", 0) },
    { status: 0, stdout: "", stderr: summary("(skip) database missing", 0, 1) },
    { status: 0, stdout: "", stderr: summary().replace("0 fail", "1 fail") },
    { status: 0, stdout: "", stderr: summary().replace("1 file", "2 files") },
    { status: 0, stdout: "", stderr: summary().replace("Ran 7 tests", "Ran 8 tests") },
    { status: 0, stdout: "", stderr: `${summary()}${summary()}` },
    { status: 0, stdout: "", stderr: summary("(pass) one\n(skip) surprise", 1, 1) },
  ])("refuses failures, early exits, empty runs and unexpected skips", (result) => {
    expect(inspectSuiteResult(suite, result).ok).toBe(false);
  });

  test("only the two named private/external optional checks may remain skipped", () => {
    expect(Object.keys(OPTIONAL_SKIPS).sort()).toEqual(["idp.integration.test.ts", "postgres.integration.test.ts"]);
    for (const [file, label] of Object.entries(OPTIONAL_SKIPS)) {
      const passed = MINIMUM_PASS_COUNTS[file];
      expect(inspectSuiteResult(file, { status: 0, stderr: summary(`${passLines(passed)}\n(skip) ${label}`, passed, 1) }).ok).toBe(true);
      expect(inspectSuiteResult(file, { status: 0, stderr: summary(`${passLines(passed)}\n(skip) unrelated`, passed, 1) }).ok).toBe(false);
      expect(inspectSuiteResult(suite, { status: 0, stderr: summary(`${passLines(passed)}\n(skip) ${label}`, passed, 1) }).ok).toBe(false);
      expect(inspectSuiteResult(file, { status: 0, stderr: summary(passLines(passed), passed) }).ok).toBe(false);
    }
  });

  test("counts the observed Bun skip recap as a recap, not another executed skip", () => {
    // Run33657200410: 22 pass/1 skip/0 fail, then Bun repeats that one skip
    // beneath '1 tests skipped:'. Both occurrences must agree with the summary.
    const file = "postgres.integration.test.ts";
    const label = OPTIONAL_SKIPS[file];
    const events = `${passLines(22)}\n(skip) ${label}`;
    const recap = `\n1 tests skipped:\n(skip) ${label}\n`;
    expect(inspectSuiteResult(file, { status: 0, stderr: summary(events + recap, 22, 1) }))
      .toEqual({ ok: true, passed: 22, skipped: 1 });
    for (const body of [
      events + recap.replace("1 tests", "2 tests"),
      events + recap.replace(label, "unexpected skipped database case"),
      events + recap + recap,
      events + `\n(skip) ${label}`,
      passLines(22) + recap,
      events + "\n1 tests skipped:\n",
      events + recap + `\n(skip) ${label}`,
      events.replace(label, "unexpected skipped database case") + recap,
      events + recap + "\n(pass) unaccounted case",
      events + recap + "\n(fail) failed case",
    ]) {
      expect(inspectSuiteResult(file, { status: 0, stderr: summary(body, 22, 1) }).ok).toBe(false);
    }
  });

  test("reconciles an actual pinned Bun recap without any database access", () => {
    const root = mkdtempSync(resolve(tmpdir(), "emails-pg-recap-"));
    const home = resolve(root, "home");
    mkdirSync(home);
    try {
      const file = "postgres.integration.test.ts";
      const [group, label] = OPTIONAL_SKIPS[file].split(" > ");
      const fixture = resolve(root, "reporter.test.ts");
      writeFileSync(fixture, [
        'import { describe, expect, test } from "bun:test";',
        `describe(${JSON.stringify(group)}, () => {`,
        ...Array.from({ length: 22 }, (_, i) => `test("synthetic ${i}", () => expect(true).toBe(true));`),
        `test.skip(${JSON.stringify(label)}, () => { throw new Error("must stay skipped"); });`,
        "});",
      ].join("\n"));
      const result = spawnSync(process.execPath, ["--no-env-file", "--no-install", "test", fixture], {
        cwd: root, encoding: "utf8", timeout: 3000,
        env: { HOME: home, NO_COLOR: "1", FORCE_COLOR: "0", BUN_RUNTIME_TRANSPILER_CACHE_PATH: resolve(root, "bun-cache") },
      });
      expect(result.status).toBe(0);
      expect(result.error).toBeUndefined();
      expect(result.stderr).toMatch(/\n1 tests? skipped:\n/);
      expect(inspectSuiteResult(file, result)).toEqual({ ok: true, passed: 22, skipped: 1 });
      expect(readdirSync(home)).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("every file has a substantive executed-case floor", () => {
    for (const file of LIVE_POSTGRES_SUITES) {
      const passed = MINIMUM_PASS_COUNTS[file] - 1;
      const optional = OPTIONAL_SKIPS[file];
      const body = `${passLines(passed)}${optional ? `\n(skip) ${optional}` : ""}`;
      expect(inspectSuiteResult(file, { status: 0, stderr: summary(body, passed, optional ? 1 : 0) }).ok).toBe(false);
    }
  });

  test("attempts all eleven subprocesses after an early failure without overriding case deadlines", () => {
    const calls: string[] = [];
    const env = buildLivePostgresEnv({ EMAILS_TEST_DATABASE_URL: databaseUrl }, "/isolated/home");
    const results = executeSuiteProcesses(packageRoot, env, (_executable, args, options) => {
      const file = args[3].split("/").at(-1);
      calls.push(file);
      expect(args.slice(0, 3)).toEqual(["--no-env-file", "--no-install", "test"]);
      expect(args).not.toContain("--timeout");
      expect(options.env).toBe(env);
      if (calls.length === 1) return { status: 1, stderr: "synthetic first-file failure" };
      const passed = MINIMUM_PASS_COUNTS[file];
      const optional = OPTIONAL_SKIPS[file];
      return { status: 0, stderr: summary(`${passLines(passed)}${optional ? `\n(skip) ${optional}` : ""}`, passed, optional ? 1 : 0) };
    }, () => {});
    expect(calls).toEqual(LIVE_POSTGRES_SUITES);
    expect(results.filter((result) => result.ok)).toHaveLength(10);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
  });

  test("manifest, package script and active root workflow name the real gate", () => {
    const pkg = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, "hasna.contract.json"), "utf8"));
    const workflow = readFileSync(resolve(packageRoot, "../../.github/workflows/emails-live-postgres.yml"), "utf8");
    expect(pkg.scripts["test:postgres"]).toBe("bun --no-env-file scripts/live-postgres-test.mjs");
    expect(manifest.storage.pgTestGate).toEqual({ envVar: "EMAILS_TEST_DATABASE_URL", command: "bun run test:postgres" });
    expect(workflow).toContain("EMAILS_TEST_DATABASE_URL:");
    expect(workflow).toContain("run: bun run test:postgres");
    expect(workflow).toContain("working-directory: apps/emails");
    expect(workflow).not.toContain("continue-on-error");
  });
});
