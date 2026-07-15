import { describe, expect, test } from "bun:test";
import type { QueryResultRow } from "pg";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/query.js";
import { assertTenantEnforcementBootstrap } from "./index.js";

function bootstrapClient(role: {
  rolcreaterole: boolean;
  rolsuper: boolean;
  owner_settable: boolean;
  migrator_settable: boolean;
  controls_public_schema: boolean;
} | null, probeFails = false, statements: string[] = []): PoolQueryClient {
  const base: TypedQueryClient = {
    query: async <T extends QueryResultRow>() => ({ rows: [] as T[], rowCount: 0 }),
    many: async <T extends QueryResultRow>() => [] as T[],
    one: async <T extends QueryResultRow>() => role as unknown as T,
    get: async <T extends QueryResultRow>() => role as unknown as T | null,
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
  test("requires CREATEROLE or superuser before tenant enforcement", async () => {
    const complete = {
      rolcreaterole: true,
      rolsuper: false,
      owner_settable: true,
      migrator_settable: true,
      controls_public_schema: true,
    };
    await expect(assertTenantEnforcementBootstrap(bootstrapClient({ ...complete, rolcreaterole: false })))
      .rejects.toThrow("CREATEROLE");
    await expect(assertTenantEnforcementBootstrap(bootstrapClient({ ...complete, owner_settable: false })))
      .rejects.toThrow("SET ROLE capability for owner/migrator");
    await expect(assertTenantEnforcementBootstrap(bootstrapClient(complete, true)))
      .rejects.toThrow("provider-level authority");
    await expect(assertTenantEnforcementBootstrap(bootstrapClient(complete)))
      .resolves.toBeUndefined();
    await expect(assertTenantEnforcementBootstrap(bootstrapClient({
      rolcreaterole: false,
      rolsuper: true,
      owner_settable: false,
      migrator_settable: false,
      controls_public_schema: false,
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
      controls_public_schema: true,
    }, false, statements))).resolves.toBeUndefined();
    const roleCreate = statements.findIndex((sql) => sql.includes("DO $probe_roles$"));
    const roleAlter = statements.findIndex((sql) => sql.startsWith("ALTER ROLE open_loops_owner"));
    expect(roleCreate).toBeGreaterThan(-1);
    expect(roleAlter).toBeGreaterThan(roleCreate);
    const databaseGrantProbe = statements.find((sql) => sql.includes("DO $probe_database_acl$"));
    expect(databaseGrantProbe).toContain("CREATE ROLE %I NOLOGIN");
    expect(databaseGrantProbe).toContain("GRANT CONNECT ON DATABASE %I TO %I");
    expect(databaseGrantProbe).toContain("aclexplode");
    expect(databaseGrantProbe).toContain("acl.privilege_type = 'CONNECT'");
  });
});
