import { describe, expect, test } from "bun:test";
import type { QueryResultRow } from "pg";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/query.js";
import type { PostgresStorage } from "../lib/storage/postgres.js";
import {
  assertIdentityAliasesAreSolePending,
  assertTenantEnforcementBootstrap,
  assertTenantEnforcementBootstrapIfPending,
  classifyMigrationReadinessError,
  classifyTenantEnforcementGate,
  logServeCommandFailure,
  program,
  resolveServeMigrationTarget,
  runGuardedPostgresMigrations,
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
        backend: "postgres" as const,
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
        backend: "postgres" as const,
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
    expect(classifyMigrationReadinessError(new Error("Postgres migration 0014_unknown is not recognized by this binary")))
      .toBe("unknown_migrations");
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

  test("exposes ordered identity migration and a fixed no-option catalog repair route", () => {
    const migrate = program.commands.find((command) => command.name() === "migrate");
    expect(migrate).toBeDefined();
    expect(migrate!.options.map((option) => option.flags)).toContain("--identity-aliases");

    const repair = program.commands.find((command) => command.name() === "identity-catalog-repair");
    expect(repair).toBeDefined();
    expect(repair!.options).toHaveLength(0);
    expect(resolveServeMigrationTarget({})).toBe("0008_tenant_prepare");
    expect(resolveServeMigrationTarget({ enforceTenancy: true })).toBe("0010_tenant_enforce");
    expect(resolveServeMigrationTarget({ identityAliases: true })).toBe("0013_loops_identity_aliases");
    expect(() => resolveServeMigrationTarget({
      enforceTenancy: true,
      identityAliases: true,
    })).toThrow("separate ordered migration phases");

    const identityMigration = {
      id: "0013_loops_identity_aliases",
      sql: "SELECT 1",
      checksum: "sha256:test",
      rollingDeploy: {
        kind: "canonical_identity_aliases" as const,
        allowAsSolePending: true as const,
        preApplyCatalogState: "aliases_absent" as const,
        postApplyCatalogState: "aliases_exact" as const,
        repair: "transactional_reapply" as const,
      },
    };
    const earlierMigration = {
      id: "0010_tenant_enforce",
      sql: "SELECT 1",
      checksum: "sha256:earlier",
    };
    const result = (pending: string[]) => {
      const plan = [earlierMigration, identityMigration].map((migration) => ({
        migration,
        state: pending.includes(migration.id) ? "pending" as const : "already_applied" as const,
      }));
      return {
        backend: "postgres" as const,
        dryRun: true,
        applied: plan
          .filter((item) => item.state === "already_applied")
          .map((item) => ({
            id: item.migration.id,
            checksum: item.migration.checksum,
            appliedAt: "2026-07-23T00:00:00.000Z",
          })),
        plan,
      };
    };
    expect(() => assertIdentityAliasesAreSolePending(
      result(["0013_loops_identity_aliases"]),
      [earlierMigration, identityMigration],
    )).not.toThrow();
    expect(() => assertIdentityAliasesAreSolePending(
      result([]),
      [earlierMigration, identityMigration],
    )).not.toThrow();
    expect(() => assertIdentityAliasesAreSolePending(
      result(["0010_tenant_enforce", "0013_loops_identity_aliases"]),
      [earlierMigration, identityMigration],
    )).toThrow("only after every earlier known migration");
    const futureMigration = {
      id: "0014_future",
      sql: "SELECT 1",
      checksum: "sha256:future",
    };
    expect(() => assertIdentityAliasesAreSolePending({
      backend: "postgres",
      dryRun: true,
      applied: [
        {
          id: earlierMigration.id,
          checksum: earlierMigration.checksum,
          appliedAt: "2026-07-23T00:00:00.000Z",
        },
        {
          id: futureMigration.id,
          checksum: futureMigration.checksum,
          appliedAt: "2026-07-23T00:00:01.000Z",
        },
      ],
      plan: [
        { migration: earlierMigration, state: "already_applied" },
        { migration: identityMigration, state: "pending" },
        { migration: futureMigration, state: "already_applied" },
      ],
    }, [earlierMigration, identityMigration, futureMigration]))
      .toThrow("exact prior migration ledger");
    const checksumDrift = result(["0013_loops_identity_aliases"]);
    checksumDrift.applied[0] = {
      ...checksumDrift.applied[0]!,
      checksum: "sha256:tampered",
    };
    expect(() => assertIdentityAliasesAreSolePending(
      checksumDrift,
      [earlierMigration, identityMigration],
    )).toThrow("ledger and immutable migration plan");
  });

  test("the shared runner stops tenant enforcement before the identity boundary", async () => {
    const migrations = [
      {
        id: "0010_tenant_enforce",
        sql: "SELECT 1",
        checksum: "sha256:tenant",
      },
      {
        id: "0013_loops_identity_aliases",
        sql: "SELECT 1",
        checksum: "sha256:identity",
        rollingDeploy: {
          kind: "canonical_identity_aliases" as const,
          allowAsSolePending: true as const,
          preApplyCatalogState: "aliases_absent" as const,
          postApplyCatalogState: "aliases_exact" as const,
          repair: "transactional_reapply" as const,
        },
      },
    ];
    const calls: Array<{ dryRun?: boolean; through?: string }> = [];
    const result = {
      backend: "postgres" as const,
      dryRun: false,
      applied: [{
        id: migrations[0]!.id,
        checksum: migrations[0]!.checksum,
        appliedAt: "2026-07-23T00:00:00.000Z",
      }],
      plan: [
        { migration: migrations[0]!, state: "already_applied" as const },
        { migration: migrations[1]!, state: "pending" as const },
      ],
    };
    const schema = {
      migrations,
      migrate: async (opts: { dryRun?: boolean; through?: string } = {}) => {
        calls.push(opts);
        return { ...result, dryRun: opts.dryRun === true };
      },
    } as unknown as PostgresStorage;

    await runGuardedPostgresMigrations(
      bootstrapClient(null),
      schema,
      { enforceTenancy: true },
    );

    expect(calls).toEqual([
      { dryRun: true },
      { dryRun: false, through: "0010_tenant_enforce" },
    ]);
  });

  test("exposes a fixed no-option shared database transfer command", () => {
    const transferCommand = program.commands.find((command) => command.name() === "shared-to-dedicated-transfer");
    expect(transferCommand).toBeDefined();
    expect(transferCommand!.options).toHaveLength(0);
  });
});
