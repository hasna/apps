import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import type { QueryResultRow } from "pg";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/query.js";
import type { PostgresStorage } from "../lib/storage/postgres.js";
import {
  assertTenantEnforcementBootstrap,
  assertTenantEnforcementBootstrapIfPending,
  classifyMigrationReadinessError,
  classifyTenantEnforcementGate,
  logServeCommandFailure,
  program,
  runProvisionRunnerKeyWithClient,
  splitCsv,
  writeTokenFile,
} from "./index.js";

function bootstrapClient(role: {
  rolcreaterole: boolean;
  rolsuper: boolean;
  owner_settable: boolean;
  migrator_settable: boolean;
  controls_database: boolean;
  controls_public_schema: boolean;
  controls_helper_functions: boolean;
  controls_existing_objects: boolean;
} | null, probeFails = false, statements: string[] = []): PoolQueryClient {
  const base: TypedQueryClient = {
    query: async <T extends QueryResultRow>() => ({ rows: [] as T[], rowCount: 0 }),
    many: async <T extends QueryResultRow>() => [] as T[],
    one: async <T extends QueryResultRow>() => role as unknown as T,
    get: async <T extends QueryResultRow>(sql: string) => {
      statements.push(sql);
      return role as unknown as T | null;
    },
    execute: async (sql) => {
      statements.push(sql);
      if (probeFails && (sql.startsWith("ALTER ROLE") || sql.includes("DO $bootstrap_roles$"))) {
        throw new Error("permission denied to alter role");
      }
    },
  };
  return {
    ...base,
    pool: null as never,
    transaction: async (fn) => fn(base),
    close: async () => undefined,
  };
}

describe("loops-serve database bootstrap", () => {
  const completeBootstrapRole = {
    rolcreaterole: true,
    rolsuper: false,
    owner_settable: true,
    migrator_settable: true,
    controls_database: true,
    controls_public_schema: true,
    controls_helper_functions: true,
    controls_existing_objects: true,
  };

  test("requires CREATEROLE or superuser before tenant enforcement", async () => {
    const complete = completeBootstrapRole;
    await expect(assertTenantEnforcementBootstrap(bootstrapClient({ ...complete, rolcreaterole: false })))
      .rejects.toThrow("CREATEROLE");
    await expect(assertTenantEnforcementBootstrap(bootstrapClient({
      ...complete,
      owner_settable: false,
      migrator_settable: false,
    }))).resolves.toBeUndefined();
    await expect(assertTenantEnforcementBootstrap(bootstrapClient({ ...complete, controls_database: false })))
      .rejects.toThrow("database-owning");
    await expect(assertTenantEnforcementBootstrap(bootstrapClient({ ...complete, controls_helper_functions: false })))
      .rejects.toThrow("every existing non-system schema, relation, function, and migration ledger owner");
    await expect(assertTenantEnforcementBootstrap(bootstrapClient(complete, true)))
      .rejects.toThrow("provider-level authority");
    await expect(assertTenantEnforcementBootstrap(bootstrapClient(complete)))
      .resolves.toBeUndefined();
    await expect(assertTenantEnforcementBootstrap(bootstrapClient({
      rolcreaterole: false,
      rolsuper: true,
      owner_settable: false,
      migrator_settable: false,
      controls_database: false,
      controls_public_schema: false,
      controls_helper_functions: false,
      controls_existing_objects: false,
    })))
      .resolves.toBeUndefined();
  });

  test("probes fresh role creation and database CONNECT authority before tenant enforcement", async () => {
    const statements: string[] = [];
    await expect(assertTenantEnforcementBootstrap(bootstrapClient({
      rolcreaterole: true,
      rolsuper: false,
      owner_settable: true,
      migrator_settable: true,
      controls_database: true,
      controls_public_schema: true,
      controls_helper_functions: true,
      controls_existing_objects: true,
    }, false, statements))).resolves.toBeUndefined();
    const roleCreate = statements.findIndex((sql) => sql.includes("DO $bootstrap_roles$"));
    const membershipNormalization = statements.findIndex((sql) => sql.includes("DO $bootstrap_memberships$"));
    expect(roleCreate).toBeGreaterThan(-1);
    expect(statements[roleCreate]).toContain("CREATE ROLE %I INHERIT NOLOGIN");
    expect(statements[roleCreate]).toContain("ALTER ROLE %I INHERIT NOLOGIN");
    expect(statements[roleCreate]).toContain("reserved OpenLoops database role % is LOGIN");
    expect(membershipNormalization).toBeGreaterThan(roleCreate);
    expect(statements.some((sql) => sql.includes("DO $cluster_role_exclusivity$"))).toBe(true);
    expect(statements.some((sql) => sql.includes("DO $privileged_role_membership_acl$"))).toBe(true);
    expect(statements).toContain("SET LOCAL ROLE open_loops_owner");
    expect(statements).toContain("SET LOCAL ROLE open_loops_migrator");
    expect(statements.some((sql) => sql.includes("ALTER TABLE open_loops_schema_migrations OWNER TO open_loops_migrator")))
      .toBe(true);
    expect(statements.some((sql) => sql.includes("__open_loops_bootstrap_session_probe__"))).toBe(true);
    const bootstrapQuery = statements.find((sql) => sql.includes("controls_helper_functions"));
    expect(bootstrapQuery).toContain("helper.proowner, 'USAGE'");
    const databaseGrantProbe = statements.find((sql) => sql.includes("DO $probe_database_acl$"));
    expect(databaseGrantProbe).toContain("CREATE ROLE %I NOLOGIN");
    expect(databaseGrantProbe).toContain("GRANT CONNECT ON DATABASE %I TO %I");
    expect(databaseGrantProbe).toContain("aclexplode");
    expect(databaseGrantProbe).toContain("acl.privilege_type = 'CONNECT'");
    const serviceAclProbe = statements.find((sql) => sql.includes("DO $probe_service_role_acl$"));
    expect(serviceAclProbe).toContain("REVOKE ALL PRIVILEGES ON DATABASE");
    expect(serviceAclProbe).toContain("ALL SEQUENCES IN SCHEMA");
    expect(serviceAclProbe).toContain("ALL FUNCTIONS IN SCHEMA");
    const serviceMembershipProbe = statements.find((sql) => sql.includes("DO $service_role_memberships$"));
    expect(serviceMembershipProbe).toContain("REVOKE %I FROM %I");
    const serviceCleanupProbe = statements.find((sql) => sql.includes("DO $service_member_acl$"));
    expect(serviceCleanupProbe).toContain("provider/bootstrap login % must never be processed as a service login");
    expect(serviceCleanupProbe).toContain("owns database objects");
  });

  test("skips bootstrap probe when tenant enforcement migration is already applied", async () => {
    const statements: string[] = [];
    const schema = {
      migrate: async () => ({
        backend: "postgresql" as const,
        dryRun: true,
        applied: [],
        plan: [{
          migration: { id: "0010_tenant_enforce", sql: "", checksum: "sha256:test" },
          state: "already_applied" as const,
        }],
      }),
    } as unknown as PostgresStorage;
    await expect(assertTenantEnforcementBootstrapIfPending(
      bootstrapClient(null, true, statements),
      schema,
    )).resolves.toBeUndefined();
    expect(statements).toEqual([]);
  });

  test("runs bootstrap probe when tenant enforcement migration is pending", async () => {
    const statements: string[] = [];
    const schema = {
      migrate: async () => ({
        backend: "postgresql" as const,
        dryRun: true,
        applied: [],
        plan: [{
          migration: { id: "0010_tenant_enforce", sql: "", checksum: "sha256:test" },
          state: "pending" as const,
        }],
      }),
    } as unknown as PostgresStorage;
    await expect(assertTenantEnforcementBootstrapIfPending(
      bootstrapClient(completeBootstrapRole, false, statements),
      schema,
    )).resolves.toBeUndefined();
    expect(statements.some((sql) => sql.includes("DO $bootstrap_roles$"))).toBe(true);
  });

  test("turns migration-ledger 42501 into a ledger-independent ownership gate", async () => {
    const statements: string[] = [];
    const permissionDenied = Object.assign(new Error("permission denied for table open_loops_schema_migrations"), {
      code: "42501",
    });
    const schema = {
      migrate: async () => { throw permissionDenied; },
    } as unknown as PostgresStorage;
    await expect(assertTenantEnforcementBootstrapIfPending(
      bootstrapClient({ ...completeBootstrapRole, controls_existing_objects: false }, false, statements),
      schema,
    )).rejects.toThrow("every existing non-system schema, relation, function, and migration ledger owner");
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("controls_existing_objects");
    expect(statements[0]).toContain("pg_class");
    expect(statements[0]).toContain("pg_proc");
  });

  test("classifies migration checksum drift as an explicit readiness failure", () => {
    expect(classifyMigrationReadinessError(new Error("Postgres migration checksum mismatch for 0003_remote_runners_and_audit")))
      .toBe("migration_checksum_mismatch");
    expect(classifyMigrationReadinessError(new Error("connect ECONNREFUSED")))
      .toBe("storage_unreachable");
  });

  test("command failures use stable logs without provider details", () => {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      logServeCommandFailure(Object.assign(new Error(
        "postgres://user:secret@db.internal/loops private-bucket approved/sha256-private.json bundle-private-id",
      ), {
        name: "postgres://name-secret@db.internal/loops",
        code: "temporary-access-key temporary-session-token postgres://code-secret@db.internal/loops",
      }));
      expect(logged).toEqual([JSON.stringify({ evt: "loops_serve_command_failed", errorType: "error" })]);
    } finally {
      console.error = originalError;
    }
  });

  test("operator logs expose a stable secret-safe tenant-enforcement gate", () => {
    const error = new Error(
      "tenant enforcement requires a database-owning bootstrap login with CREATEROLE and provider authority over every existing non-system schema, relation, function, and migration ledger owner; reassign legacy objects or grant exact owner-role membership before retrying",
    );
    expect(classifyTenantEnforcementGate(error)).toEqual({
      gate: "legacy_object_ownership",
      action: "reassign every non-system database object to the bootstrap login or an exact SETtable owner role",
    });
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      logServeCommandFailure(error);
      expect(JSON.parse(logged[0]!)).toEqual({
        evt: "loops_serve_command_failed",
        errorType: "error",
        gate: "legacy_object_ownership",
        action: "reassign every non-system database object to the bootstrap login or an exact SETtable owner role",
      });
    } finally {
      console.error = originalError;
    }
  });

  test("exposes fixed S3 backfill delivery while preserving the local-file command", () => {
    const s3Command = program.commands.find((command) => command.name() === "tenant-backfill-s3");
    expect(s3Command).toBeDefined();
    expect(s3Command!.options).toHaveLength(0);

    const localCommand = program.commands.find((command) => command.name() === "tenant-backfill");
    expect(localCommand).toBeDefined();
    expect(localCommand!.options.map((option) => ({ flags: option.flags, required: option.required })))
      .toContainEqual({ flags: "--input <path>", required: true });
  });

  test("exposes the fixed db-credentials reconcile command without operator-supplied secret flags", () => {
    const dbCredentials = program.commands.find((command) => command.name() === "db-credentials");
    expect(dbCredentials).toBeDefined();
    expect(dbCredentials!.options).toHaveLength(0);
    const reconcile = dbCredentials!.commands.find((command) => command.name() === "reconcile");
    expect(reconcile).toBeDefined();
    expect(reconcile!.options).toHaveLength(0);
  });

  test("exposes a fixed no-option shared database transfer command", () => {
    const transferCommand = program.commands.find((command) => command.name() === "shared-to-dedicated-transfer");
    expect(transferCommand).toBeDefined();
    expect(transferCommand!.options).toHaveLength(0);
  });
});

describe("loops-serve provision-runner-key command", () => {
  const SIGNING_SECRET = "provision-cli-test-signing-secret-32-b";

  function recordingClient(activeKey: { kid: string; expires_at: string } | null) {
    const statements: Array<{ sql: string; params: readonly unknown[] }> = [];
    const base: TypedQueryClient = {
      query: async <T extends QueryResultRow>() => ({ rows: [] as T[], rowCount: 0 }),
      many: async <T extends QueryResultRow>() => [] as T[],
      one: async <T extends QueryResultRow>() => {
        throw new Error("unexpected one()");
      },
      get: async <T extends QueryResultRow>(sql: string, params: readonly unknown[] = []) => {
        statements.push({ sql, params });
        if (sql.includes("FROM api_keys key")) return (activeKey ?? null) as unknown as T | null;
        return null;
      },
      execute: async (sql: string, params: readonly unknown[] = []) => {
        statements.push({ sql, params });
      },
    };
    const client: PoolQueryClient = {
      ...base,
      pool: null as never,
      transaction: async <T>(fn: (transaction: TypedQueryClient) => Promise<T>): Promise<T> => fn(base),
      close: async () => undefined,
    };
    return { client, statements };
  }

  function swapConsole(output: { stdout: string[]; stderr: string[] }) {
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = (message?: unknown) => output.stdout.push(String(message));
    console.warn = (message?: unknown) => output.stderr.push(String(message));
    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
    };
  }

  test("registers the command with its option surface and no token flag leakage", () => {
    const command = program.commands.find((command) => command.name() === "provision-runner-key");
    expect(command).toBeDefined();
    const flags = command!.options.map((option) => option.flags);
    expect(flags).toContain("--runner-id <id>");
    expect(flags).toContain("--tenant-id <id>");
    expect(flags).toContain("--roles <csv>");
    expect(flags).toContain("--scope <csv>");
    expect(flags).toContain("--ttl-seconds <n>");
    expect(flags).toContain("--token-out <path>");
    expect(flags).toContain("--print-token");
    // No flag may accept a literal token value.
    expect(command!.options.every((option) => !option.flags.includes("--token "))).toBe(true);
  });

  test("splitCsv trims, drops empties, and preserves order", () => {
    expect(splitCsv("worker, service ,,worker")).toEqual(["worker", "service", "worker"]);
    expect(splitCsv("")).toEqual([]);
    expect(splitCsv(undefined)).toEqual([]);
  });

  test("writeTokenFile writes mode 600 regardless of umask", () => {
    const dir = mkdtempSync(join(tmpdir(), "loops-provision-"));
    try {
      chmodSync(dir, 0o777);
      const path = join(dir, "runner.env");
      writeTokenFile(path, "hasna_loops_secret-token");
      expect(readFileSync(path, "utf8")).toBe("hasna_loops_secret-token\n");
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails closed before touching the database when tenant, secret, or delivery is missing", async () => {
    const definitelyBroken = {} as PoolQueryClient;
    const env = { HASNA_LOOPS_API_SIGNING_KEY: SIGNING_SECRET };
    await expect(runProvisionRunnerKeyWithClient({}, env, definitelyBroken))
      .rejects.toThrow("requires --tenant-id <id> or HASNA_LOOPS_TENANT_ID");
    await expect(runProvisionRunnerKeyWithClient({ tenantId: "tenant-a" }, env, definitelyBroken))
      .rejects.toThrow("requires --token-out <path> or --print-token");
    await expect(runProvisionRunnerKeyWithClient(
      { tenantId: "tenant-a", tokenOut: "/tmp/x", printToken: true },
      env,
      definitelyBroken,
    )).rejects.toThrow("either --token-out <path> or --print-token, not both");
    await expect(runProvisionRunnerKeyWithClient({ tenantId: "tenant-a" }, {}, definitelyBroken))
      .rejects.toThrow("requires HASNA_LOOPS_API_SIGNING_KEY");
  });

  test("provisioning with --token-out: stdout carries ONLY the JSON summary; the token lands in the file at 600", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loops-provision-"));
    try {
      const tokenOut = join(dir, "runner-token");
      const { client } = recordingClient(null);
      const output: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };
      const restore = swapConsole(output);
      try {
        const result = await runProvisionRunnerKeyWithClient(
          { runnerId: "station-cli-test", tenantId: "tenant-a", tokenOut },
          { HASNA_LOOPS_API_SIGNING_KEY: SIGNING_SECRET },
          client,
        );
        expect(result.provisioned).toBe(true);
      } finally {
        restore();
      }
      expect(output.stdout).toHaveLength(1);
      const summary = JSON.parse(output.stdout[0]);
      expect(Object.keys(summary).sort()).toEqual(["expiresAt", "kid", "runnerId"]);
      expect(summary.runnerId).toBe("station-cli-test");
      expect(output.stderr).toHaveLength(0);
      const token = readFileSync(tokenOut, "utf8").trim();
      expect(output.stdout.join("\n")).not.toContain(token);
      expect(token.startsWith("hasna_loops_")).toBe(true);
      expect(statSync(tokenOut).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--print-token emits exactly the JSON summary line then the token line", async () => {
    const { client } = recordingClient(null);
    const output: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };
    const restore = swapConsole(output);
    try {
      await runProvisionRunnerKeyWithClient(
        { runnerId: "station-cli-test", tenantId: "tenant-a", printToken: true },
        { HASNA_LOOPS_API_SIGNING_KEY: SIGNING_SECRET },
        client,
      );
    } finally {
      restore();
    }
    expect(output.stdout).toHaveLength(2);
    const summary = JSON.parse(output.stdout[0]);
    expect(Object.keys(summary).sort()).toEqual(["expiresAt", "kid", "runnerId"]);
    expect(output.stdout[1]).toMatch(/^hasna_loops_/);
  });

  test("runner id defaults to the container hostname; tenant id defaults from the env", async () => {
    const { client, statements } = recordingClient(null);
    const output: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };
    const restore = swapConsole(output);
    try {
      await runProvisionRunnerKeyWithClient(
        { printToken: true },
        { HASNA_LOOPS_API_SIGNING_KEY: SIGNING_SECRET, HASNA_LOOPS_TENANT_ID: "tenant-from-env" },
        client,
      );
    } finally {
      restore();
    }
    const membership = statements.find((s) => s.sql.includes("INSERT INTO tenant_memberships"));
    expect(membership?.params).toEqual(["tenant-from-env", hostname()]);
    const roleInserts = statements.filter((s) => s.sql.includes("INSERT INTO tenant_membership_roles"));
    expect(roleInserts.map((s) => s.params?.[2]).sort()).toEqual(["service", "worker"]);
    const keyInsert = statements.find((s) => s.sql.includes("INSERT INTO api_keys"));
    expect(keyInsert?.params).toHaveLength(8);
    expect(keyInsert?.params?.[1]).toBe(hostname()); // agent == runner principal id
    expect(JSON.parse(String(keyInsert?.params?.[2]))).toEqual(["loops:runner"]); // scopes
    expect(keyInsert?.params?.[6]).toBe("tenant-from-env"); // tenant_id
    expect(keyInsert?.params?.[7]).toBe(hostname()); // principal_id
    const issuedAt = keyInsert?.params?.[4] as Date;
    const expiresAt = keyInsert?.params?.[5] as Date;
    expect(Math.round((expiresAt.getTime() - issuedAt.getTime()) / 1000)).toBe(31_536_000);
  });

  test("already-provisioned: same summary shape, a stderr note, and NO token anywhere", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loops-provision-"));
    try {
      const tokenOut = join(dir, "runner-token");
      const { client } = recordingClient({ kid: "existing-key", expires_at: "2099-01-01T00:00:00.000Z" });
      const output: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };
      const restore = swapConsole(output);
      try {
        const result = await runProvisionRunnerKeyWithClient(
          { runnerId: "station-cli-test", tenantId: "tenant-a", tokenOut },
          { HASNA_LOOPS_API_SIGNING_KEY: SIGNING_SECRET },
          client,
        );
        expect(result.provisioned).toBe(false);
        expect(result.kid).toBe("existing-key");
      } finally {
        restore();
      }
      expect(output.stdout).toHaveLength(1);
      expect(JSON.parse(output.stdout[0]).kid).toBe("existing-key");
      expect(output.stderr).toHaveLength(1);
      expect(output.stderr[0]).toContain("no new token minted");
      expect(statSync(dir).isDirectory()).toBe(true);
      expect(readdirSync(dir)).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalid role or scope csvs fail with the module's message", async () => {
    const { client } = recordingClient(null);
    await expect(runProvisionRunnerKeyWithClient(
      { runnerId: "station-cli-test", tenantId: "tenant-a", roles: "admin,superuser", tokenOut: "/tmp/irrelevant" },
      { HASNA_LOOPS_API_SIGNING_KEY: SIGNING_SECRET },
      client,
    )).rejects.toThrow("invalid role 'superuser'");
    await expect(runProvisionRunnerKeyWithClient(
      { runnerId: "station-cli-test", tenantId: "tenant-a", scope: "loops:bogus,*,x", tokenOut: "/tmp/irrelevant" },
      { HASNA_LOOPS_API_SIGNING_KEY: SIGNING_SECRET },
      client,
    )).rejects.toThrow("invalid scope 'x'");
  });
});
