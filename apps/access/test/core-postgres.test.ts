import { expect, test } from "bun:test";
import { CoreDatabase, getDatabase, postgresOptions, postgresSql, withCoreTransaction, type CoreConnection, type CorePool } from "../src/server/core-store.js";
import { migrateCoreSchema } from "../src/server/core-schema.js";
import { createCoreAuthenticator } from "../src/server/core-auth.js";

test("PG adapter parameter binding and query contracts", async () => {
  const calls: Array<[string, unknown[] | undefined]> = [];
  const db = new CoreDatabase({ async query(sql, params) { calls.push([sql, params]); return { rows: [{ id: "row" }] }; } });
  expect(await db.query("SELECT * FROM identities WHERE id = ?").get("value")).toEqual({ id: "row" });
  expect(calls[0]).toEqual(["SELECT * FROM identities WHERE id = $1", ["value"]]);
  expect(await db.query("SELECT * FROM identities").all()).toEqual([{ id: "row" }]);
  await db.query("UPDATE identities SET name = ? WHERE id = ?").run("name", "id");
  expect(calls[2]).toEqual(["UPDATE identities SET name = $1 WHERE id = $2", ["name", "id"]]);
  expect(postgresSql("SELECT '?' AS literal, ? AS value, 'it''s?' AS quoted")).toBe("SELECT '?' AS literal, $1 AS value, 'it''s?' AS quoted");
});

test("PG transaction binds one connection, commits or rolls back, always releases", async () => {
  for (const fail of [false, true]) {
    const calls: string[] = [];
    const connection: CoreConnection = { async query(sql) { calls.push(sql); return { rows: [] }; }, release() { calls.push("release"); } };
    const pool: CorePool = { async connect() { return connection; }, async end() {} };
    const result = withCoreTransaction(pool, async () => {
      await getDatabase().query("SELECT ?").all(1);
      if (fail) throw new Error("test rollback");
      return "done";
    });
    if (fail) await expect(result).rejects.toThrow("test rollback"); else expect(await result).toBe("done");
    expect(calls).toEqual(["BEGIN", "SELECT pg_advisory_xact_lock(1935762275)", "SELECT $1", fail ? "ROLLBACK" : "COMMIT", "release"]);
    expect(() => getDatabase()).toThrow("requires a server PostgreSQL transaction");
  }
});

test("server rejects absent, blank, conflicting, wrong protocol and unsafe TLS DSNs before connection", () => {
  for (const env of [{}, { HASNA_ACCESS_DATABASE_URL: "" }, { HASNA_ACCESS_DATABASE_URL: "postgres://user:pass@db.example.test/access?sslmode=require" }, { HASNA_ACCESS_DATABASE_URL: "sqlite:///tmp/access.db" }, { HASNA_ACCESS_DATABASE_URL: "postgres://user:pass@db.example.test/access?sslmode=verify-full", ACCESS_DATABASE_URL: "" }, { HASNA_ACCESS_DATABASE_URL_FILE: "/nonexistent-access-unit-test" }]) expect(() => postgresOptions(env)).toThrow();
  const result = postgresOptions({ HASNA_ACCESS_DATABASE_URL: "postgres://user:pass@db.example.test/access?sslmode=verify-full" });
  expect(result.host).toBe("db.example.test");
  expect(result.ssl.rejectUnauthorized).toBe(true);
  expect(Object.hasOwn(result, "connectionString")).toBe(false);
});

test("explicit schema migration rolls back and releases on DDL failure", async () => {
  const statements: string[] = [];
  const pool: CorePool = { async connect() { return { async query(sql) { statements.push(sql); if (sql.startsWith("CREATE TABLE")) throw new Error("test DDL failure"); return { rows: [] }; }, release() { statements.push("release"); } }; }, async end() {} };
  await expect(migrateCoreSchema(pool)).rejects.toThrow("test DDL failure");
  expect(statements.slice(-2)).toEqual(["ROLLBACK", "release"]);
  expect(statements).not.toContain("COMMIT");
});

test("server rejects missing, blank, malformed, conflicting and ambiguous credentials", () => {
  for (const env of [{}, { HASNA_ACCESS_API_KEY: "" }, { HASNA_ACCESS_API_KEY: "one", ACCESS_API_KEY: "two" }, { HASNA_ACCESS_API_CREDENTIALS: "invalid-json" }, { HASNA_ACCESS_API_CREDENTIALS: JSON.stringify([{ id: "a", token: "same" }, { id: "b", token: "same" }]) }]) expect(() => createCoreAuthenticator(env)).toThrow();
});

test("server credentials are snapshotted and returned contexts cannot mutate authority", async () => {
  const token = "isolated-auth-test";
  const env = { HASNA_ACCESS_API_CREDENTIALS: JSON.stringify([{ id: "unit", token, roles: ["auditor"], entity_ids: ["allowed"] }]) };
  const authenticate = createCoreAuthenticator(env);
  env.HASNA_ACCESS_API_CREDENTIALS = "[]";
  const request = new Request("https://access.example.test/v1/identities", { headers: { Authorization: `Bearer ${token}` } });
  const first = (await authenticate(request))!;
  first.entity_ids!.push("other");
  expect((await authenticate(request))!.entity_ids).toEqual(["allowed"]);
});
