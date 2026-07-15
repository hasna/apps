import { describe, expect, test } from "bun:test";
import type { QueryResultRow } from "pg";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/query.js";
import type { PostgresStorage } from "../lib/storage/postgres.js";
import { assertTenantEnforcementBootstrap, assertTenantEnforcementBootstrapIfPending, logServeCommandFailure } from "./index.js";

function bootstrapClient(role: {
  rolcreaterole: boolean;
  rolsuper: boolean;
  owner_settable: boolean;
  migrator_settable: boolean;
  controls_database: boolean;
  controls_public_schema: boolean;
  controls_helper_functions: boolean;
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
      if (probeFails && sql.startsWith("ALTER ROLE")) throw new Error("permission denied to alter role");
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
  };

  test("requires CREATEROLE or superuser before tenant enforcement", async () => {
    const complete = completeBootstrapRole;
    await expect(assertTenantEnforcementBootstrap(bootstrapClient({ ...complete, rolcreaterole: false })))
      .rejects.toThrow("CREATEROLE");
    await expect(assertTenantEnforcementBootstrap(bootstrapClient({ ...complete, owner_settable: false })))
      .rejects.toThrow("SET ROLE capability for owner/migrator");
    await expect(assertTenantEnforcementBootstrap(bootstrapClient({ ...complete, controls_database: false })))
      .rejects.toThrow("database-owning");
    await expect(assertTenantEnforcementBootstrap(bootstrapClient({ ...complete, controls_helper_functions: false })))
      .rejects.toThrow("existing OpenLoops helper functions");
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
    }, false, statements))).resolves.toBeUndefined();
    const roleCreate = statements.findIndex((sql) => sql.includes("DO $probe_roles$"));
    const roleAlter = statements.findIndex((sql) => sql.startsWith("ALTER ROLE open_loops_owner"));
    expect(roleCreate).toBeGreaterThan(-1);
    expect(roleAlter).toBeGreaterThan(roleCreate);
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
    const serviceMembershipProbe = statements.find((sql) => sql.includes("DO $probe_service_role_memberships$"));
    expect(serviceMembershipProbe).toContain("REVOKE %I FROM %I");
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
    expect(statements.some((sql) => sql.includes("DO $probe_roles$"))).toBe(true);
  });

  test("command failures use stable logs without provider details", () => {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      logServeCommandFailure(Object.assign(new Error("postgres://user:secret@db.internal/loops"), {
        name: "postgres://name-secret@db.internal/loops",
        code: "postgres://code-secret@db.internal/loops",
      }));
      expect(logged).toEqual([JSON.stringify({ evt: "loops_serve_command_failed", errorType: "error" })]);
    } finally {
      console.error = originalError;
    }
  });
});
