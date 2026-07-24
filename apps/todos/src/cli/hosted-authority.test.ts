import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHostedCliHarness, type HostedCliHarness, type HostedCliResult } from "./hosted-cli.test-helper";
import { assertTodosCliStageAContainment, isTodosCliPureMetadataInvocation } from "./stage-a";
import { TODOS_CLI_HELP_COMMAND_PATHS } from "./metadata-command-paths";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const DATABASE_PATH_MARKER = "FAKE_ONLY_CLI_DATABASE_PATH_MARKER";
const ENCODED_DATABASE_PATH_MARKER = Array.from(new TextEncoder().encode(DATABASE_PATH_MARKER))
  .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
  .join("");

function expectStageADenial(result: HostedCliResult, harness: HostedCliHarness): void {
  expect(result.timedOut).toBe(false);
  expect(result.exitCode).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
  expect(harness.requests).toEqual([]);
  expect(harness.databaseConnections).toEqual([]);
  expect(harness.sqliteExists()).toBe(false);
  expect(harness.createdPaths()).toEqual([]);
}

const COMMAND_FAMILIES = [
  ["task reads", ["--json", "list", "--status", "pending"]],
  ["task writes", ["--json", "add", "synthetic task"]],
  ["direct IDs", ["--json", "show", TASK_ID]],
  ["plans/templates", ["--json", "plans"]],
  ["projects", ["--json", "projects"]],
  ["agents", ["--json", "agents"]],
  ["config and serve", ["--json", "config"]],
  ["queries/reports", ["--json", "report"]],
  ["MCP and hooks", ["--json", "hooks", "list"]],
  ["dispatch", ["--json", "dispatches"]],
  ["machines", ["--json", "machines"]],
  ["API keys", ["--json", "api-keys", "list"]],
  ["environment snapshots", ["--json", "env-snapshot", "list"]],
  ["knowledge", ["--json", "knowledge", "list"]],
  ["risks", ["--json", "risks", "list"]],
  ["retrospectives", ["--json", "retrospectives", "list"]],
  ["agent reliability", ["--json", "reliability", "show", "synthetic-agent"]],
  ["onboarding", ["--json", "onboarding"]],
  ["local snapshots", ["--json", "snapshots"]],
  ["SDK fixtures", ["--json", "sdk-fixtures"]],
  ["review queue", ["--json", "reviews", "list"]],
  ["roadmaps", ["--json", "roadmaps", "list"]],
  ["capacity", ["--json", "capacity", "report"]],
  ["audit ledger", ["--json", "audit-ledger", "show"]],
  ["release compatibility", ["--json", "release-compat", "check"]],
  ["usage ledger", ["--json", "usage", "report"]],
  ["local backups", ["--json", "backup", "create"]],
  ["scale hardening", ["--json", "scale", "report"]],
  ["delegated events", ["--json", "events", "list"]],
  ["delegated webhooks", ["--json", "webhooks", "list"]],
] as const;

describe("Todos CLI Stage-A pre-dispatch containment", () => {
  test("the role gate precedes package metadata, command imports, and optional events registration", () => {
    const bootstrap = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
    const runtime = readFileSync(new URL("./runtime.tsx", import.meta.url), "utf8");
    const gateIndex = bootstrap.indexOf("assertTodosCliStageAContainment();");
    const runtimeImportIndex = bootstrap.indexOf('await import("./runtime.js")', gateIndex);
    const versionIndex = runtime.indexOf("getPackageVersion()");
    const commandImportIndex = runtime.indexOf("await Promise.all");
    const optionalEventsIndex = runtime.indexOf("await registerOptionalEventsCommands(program)");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(runtimeImportIndex).toBeGreaterThan(gateIndex);
    expect(versionIndex).toBeGreaterThan(-1);
    expect(commandImportIndex).toBeGreaterThan(-1);
    expect(optionalEventsIndex).toBeGreaterThan(-1);
  });

  test.each(COMMAND_FAMILIES)("%s fails before command imports, files, network, or SQLite", async (_label, args) => {
    const harness = createHostedCliHarness("todos-hosted-family-");
    try {
      expectStageADenial(await harness.run(args), harness);
    } finally {
      harness.dispose();
    }
  });

  test("invalid/conflicting intent fails at the same pre-dispatch boundary", async () => {
    const harness = createHostedCliHarness("todos-invalid-family-", {
      environment: {
        HASNA_TODOS_STORAGE_MODE: "local",
        TODOS_STORAGE_MODE: "remote",
      },
    });
    try {
      expectStageADenial(await harness.run(["--json", "events", "list"]), harness);
    } finally {
      harness.dispose();
    }
  });

  test.each([
    ["top-level help", ["--help"]],
    ["version", ["--version"]],
    ["manual metadata", ["manual", "--format", "json"]],
    ["completion metadata", ["completions", "bash"]],
  ] as const)("%s remains available without datastore side effects", async (_label, args) => {
    const harness = createHostedCliHarness("todos-hosted-metadata-");
    try {
      const result = await harness.run(args);
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(harness.requests).toEqual([]);
      expect(harness.databaseConnections).toEqual([]);
      expect(harness.sqliteExists()).toBe(false);
      expect(harness.createdPaths()).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  test("classifies only non-apply native storage metadata as pure", () => {
    expect(isTodosCliPureMetadataInvocation(["storage", "status", "--json"])).toBe(true);
    expect(isTodosCliPureMetadataInvocation(["--json", "storage", "sync-plan", "--schema-sql"])).toBe(true);
    expect(isTodosCliPureMetadataInvocation(["storage", "sync-plan", "--apply"])).toBe(false);
    expect(isTodosCliPureMetadataInvocation(["storage", "shadow-status"])).toBe(false);
    expect(isTodosCliPureMetadataInvocation(["storage", "shadow-drain"])).toBe(false);
    expect(isTodosCliPureMetadataInvocation(["storage", "artifacts", "upload"])).toBe(false);
    expect(isTodosCliPureMetadataInvocation(["machines", "sync", "--help"])).toBe(true);
    expect(isTodosCliPureMetadataInvocation(["unknown-command", "--help"])).toBe(false);
  });

  test("the dependency-light help whitelist matches every registered command path and alias", async () => {
    const harness = createHostedCliHarness("todos-help-command-paths-");
    try {
      const result = await harness.run(["manual", "--format", "json"]);
      expect(result.exitCode).toBe(0);
      const manual = JSON.parse(result.stdout) as {
        commands: Array<{ path: string[]; aliases: string[] }>;
      };
      const registered = new Set<string>();
      for (const command of manual.commands) {
        registered.add(command.path.join(" "));
        for (const alias of command.aliases) {
          registered.add([...command.path.slice(0, -1), alias].join(" "));
        }
      }
      expect([...TODOS_CLI_HELP_COMMAND_PATHS].sort()).toEqual([...registered].sort());
      expect(harness.requests).toEqual([]);
      expect(harness.databaseConnections).toEqual([]);
      expect(harness.sqliteExists()).toBe(false);
    } finally {
      harness.dispose();
    }
  });

  test.each([
    ["unknown option-only invocation", ["--json", "--definitely-unknown"]],
    ["missing global option value", ["--project", "--json"]],
    ["help mixed with an extra token", ["--json", "--help", "extra"]],
    ["manual missing its format value", ["manual", "--format", "--json"]],
    ["manual mixed with an extra token", ["--json", "manual", "--format", "json", "extra"]],
    ["completion mixed with an extra token", ["completions", "bash", "extra", "-j"]],
    ["storage status with an unknown flag", ["--json", "storage", "status", "--definitely-unknown"]],
    ["storage sync-plan mixed with an extra token", ["storage", "sync-plan", "--schema-sql", "extra", "-j"]],
  ] as const)("fails hostile metadata argv before runtime import: %s", async (_label, args) => {
    expect(isTodosCliPureMetadataInvocation(args)).toBe(false);
    expect(() => assertTodosCliStageAContainment(args, {
      HASNA_TODOS_STORAGE_MODE: "local",
      TODOS_STORAGE_MODE: "local",
    })).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");

    const harness = createHostedCliHarness("todos-hostile-metadata-", {
      environment: {
        HASNA_TODOS_STORAGE_MODE: "local",
        TODOS_STORAGE_MODE: "local",
      },
    });
    try {
      const result = await harness.run(args);
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: "hosted_authority_unavailable",
        code: "HOSTED_AUTHORITY_UNAVAILABLE",
        reason: "authority_resolver_unavailable",
      });
      expect(harness.requests).toEqual([]);
      expect(harness.databaseConnections).toEqual([]);
      expect(harness.sqliteExists()).toBe(false);
      expect(harness.createdPaths()).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  test.each([
    ["shadow drain", ["storage", "shadow-drain"]],
    ["sync apply", ["storage", "sync-plan", "--apply"]],
    ["artifact upload", ["storage", "artifacts", "upload", "--apply"]],
    ["artifact download", ["storage", "artifacts", "download", "--apply"]],
  ] as const)("%s stops in the pre-import bootstrap even under a local role", (_label, args) => {
    expect(() => assertTodosCliStageAContainment(args, {
      HASNA_TODOS_STORAGE_MODE: "local",
      TODOS_STORAGE_MODE: "local",
    })).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
  });

  test("hosted storage status is redacted metadata with zero datastore or network access", async () => {
    const harness = createHostedCliHarness("todos-hosted-storage-status-", {
      databaseTripwire: true,
      environment: {
        HASNA_TODOS_STORAGE_MODE: "remote",
        TODOS_STORAGE_MODE: "",
        HASNA_TODOS_DATABASE_URL:
          `postgres://fixture-user:fixture-pass@127.0.0.1/${ENCODED_DATABASE_PATH_MARKER}`
          + "?sslmode=require&password=query-secret&access_token=query-token#fragment-secret",
        HASNA_TODOS_DATABASE_SCHEMA: "fixture_schema",
        HASNA_TODOS_S3_BUCKET: "fixture-bucket",
        HASNA_TODOS_AWS_REGION: "test-region-1",
      },
    });
    try {
      const result = await harness.run(["--json", "storage", "status"]);
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload).toMatchObject({
        mode: "remote",
        remote_configured: true,
        remote_enabled: false,
        runtime_enabled: false,
        no_network: true,
      });
      expect(payload.database.redacted_url).toContain("***:***@127.0.0.1");
      expect(result.stdout).not.toContain("fixture-user");
      expect(result.stdout).not.toContain("fixture-pass");
      expect(result.stdout).not.toContain("query-secret");
      expect(result.stdout).not.toContain("query-token");
      expect(result.stdout).not.toContain("fragment-secret");
      expect(result.stdout).not.toContain("sslmode=require");
      expect(result.stdout).not.toContain(DATABASE_PATH_MARKER);
      expect(result.stdout).not.toContain(ENCODED_DATABASE_PATH_MARKER);
      expect(payload.database.redacted_url).toContain("/[REDACTED_PATH]");
      expect(harness.requests).toEqual([]);
      expect(harness.databaseConnections).toEqual([]);
      expect(harness.sqliteExists()).toBe(false);
      expect(harness.createdPaths()).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  test("source CLI status omits invalid boolean values and control characters", async () => {
    const marker = "not-a-boolean\r\nCLI_CONTROL_MARKER\u001b[31m";
    const harness = createHostedCliHarness("todos-hosted-storage-invalid-bool-", {
      environment: {
        HASNA_TODOS_STORAGE_MODE: "remote",
        TODOS_STORAGE_MODE: "",
        HASNA_TODOS_DATABASE_URL: "postgres://fixture-user:fixture-pass@127.0.0.1/todos",
        HASNA_TODOS_DATABASE_SSL: marker,
      },
    });
    try {
      const result = await harness.run(["--json", "storage", "status"]);
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.ok).toBe(false);
      expect(payload.issues.join("\n")).toContain("HASNA_TODOS_DATABASE_SSL");
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("not-a-boolean");
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("CLI_CONTROL_MARKER");
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("fixture-user");
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("fixture-pass");
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("\u001b");
      expect(harness.requests).toEqual([]);
      expect(harness.sqliteExists()).toBe(false);
    } finally {
      harness.dispose();
    }
  });

  test("hosted storage sync-plan renders SQL with zero datastore or network access", async () => {
    const harness = createHostedCliHarness("todos-hosted-storage-plan-", {
      databaseTripwire: true,
      environment: {
        HASNA_TODOS_STORAGE_MODE: "hybrid",
        TODOS_STORAGE_MODE: "",
        HASNA_TODOS_S3_BUCKET: "fixture-bucket",
        HASNA_TODOS_AWS_REGION: "test-region-1",
      },
    });
    try {
      const result = await harness.run(["--json", "storage", "sync-plan", "--schema-sql"]);
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload).toMatchObject({ dry_run: true, no_network: true });
      expect(payload.status.mode).toBe("hybrid");
      expect(payload.postgres.schema_sql.join("\n")).toContain("CREATE TABLE IF NOT EXISTS todos_sync_records");
      expect(result.stdout).not.toContain("fixture-user");
      expect(result.stdout).not.toContain("fixture-pass");
      expect(harness.requests).toEqual([]);
      expect(harness.databaseConnections).toEqual([]);
      expect(harness.sqliteExists()).toBe(false);
      expect(harness.createdPaths()).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  test.each(["remote", "cloud", "self_hosted", "self-hosted"])(
    "storage metadata reports %s intent canonically as remote",
    async (mode) => {
      const harness = createHostedCliHarness("todos-hosted-storage-alias-", {
        databaseTripwire: true,
        environment: {
          HASNA_TODOS_STORAGE_MODE: mode,
          TODOS_STORAGE_MODE: mode,
        },
      });
      try {
        for (const args of [
          ["--json", "storage", "status"],
          ["--json", "storage", "sync-plan"],
        ]) {
          const result = await harness.run(args);
          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout);
          const status = "status" in payload ? payload.status : payload;
          expect(status).toMatchObject({
            mode: "remote",
            local_default: false,
            remote_configured: true,
            remote_enabled: false,
            runtime_enabled: false,
          });
          expect(harness.requests).toEqual([]);
          expect(harness.databaseConnections).toEqual([]);
          expect(harness.sqliteExists()).toBe(false);
        }
      } finally {
        harness.dispose();
      }
    },
  );

  test("conflicting metadata reports fail-closed remote diagnostics without a local fallback", async () => {
    const harness = createHostedCliHarness("todos-hosted-storage-conflict-", {
      databaseTripwire: true,
      environment: {
        HASNA_TODOS_STORAGE_MODE: "local",
        TODOS_STORAGE_MODE: "remote",
      },
    });
    try {
      const result = await harness.run(["--json", "storage", "sync-plan"]);
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.status).toMatchObject({
        ok: false,
        mode: "remote",
        local_default: false,
        remote_configured: true,
        remote_enabled: false,
        runtime_enabled: false,
      });
      expect(payload.status.issues.join("\n")).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(payload.steps.join("\n")).not.toContain("Skip remote database writes in local mode");
      expect(harness.requests).toEqual([]);
      expect(harness.databaseConnections).toEqual([]);
      expect(harness.sqliteExists()).toBe(false);
    } finally {
      harness.dispose();
    }
  });

  test.each([
    ["shadow status", ["--json", "storage", "shadow-status"]],
    ["shadow drain", ["--json", "storage", "shadow-drain"]],
    ["sync-plan apply", ["--json", "storage", "sync-plan", "--apply"]],
  ] as const)("%s remains denied before datastore or network access", async (_label, args) => {
    const harness = createHostedCliHarness("todos-hosted-storage-denied-", { databaseTripwire: true });
    try {
      expectStageADenial(await harness.run(args), harness);
    } finally {
      harness.dispose();
    }
  });

  test.each(["upload", "download"])(
    "explicit local artifact %s --apply remains behind the Stage-A remote floor",
    async (direction) => {
      const harness = createHostedCliHarness("todos-local-artifact-floor-", {
        environment: {
          HASNA_TODOS_STORAGE_MODE: "local",
          TODOS_STORAGE_MODE: "local",
          HASNA_TODOS_S3_BUCKET: "synthetic-bucket",
          HASNA_TODOS_S3_REGION: "us-test-1",
          HASNA_TODOS_S3_ACCESS_KEY_ID: "synthetic-access-id",
          HASNA_TODOS_S3_SECRET_ACCESS_KEY: "synthetic-secret-value",
        },
      });
      try {
        expectStageADenial(
          await harness.run(["--json", "storage", "artifacts", direction, "--apply"]),
          harness,
        );
      } finally {
        harness.dispose();
      }
    },
  );
});
