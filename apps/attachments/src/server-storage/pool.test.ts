import { test, expect } from "bun:test";
import pg from "pg";
import { createPgPool } from "./pool";

for (const mode of ["verify-full", "verify-ca"]) test(mode + " survives the actual pg.Client parser", async () => {
  const pool = createPgPool({ connectionString: "postgresql://u:p@db.example.test/db?sslmode=" + mode, ca: "synthetic-ca", env: {} });
  try {
    const client = new pg.Client(pool.options);
    const parameters = (client as unknown as { connectionParameters: { ssl: object; host: string } }).connectionParameters;
    expect(parameters.ssl).toEqual({ rejectUnauthorized: true, ca: "synthetic-ca" });
    expect(parameters.host).toBe("db.example.test");
    expect((parameters.ssl as { checkServerIdentity?: unknown }).checkServerIdentity).toBeUndefined();
    expect(pool.options.connectionString).not.toContain("sslmode");
  } finally { await pool.end(); }
});

for (const query of [
  "sslmode=verify-full&sslmode=no-verify", "sslmode=verify-full&sslmode=verify-full",
  "sslmode=verify-full&ssl=false", "sslmode=verify-full&sslrootcert=unread",
  "sslmode=verify-full&sslcert=unread", "sslmode=verify-full&sslkey=unread",
  "sslmode=verify-full&uselibpqcompat=true", "sslnegotiation=direct",
  "sslmode=no-verify", "sslmode=", "ssl=unknown", "SSLmode=verify-full",
]) test("reject TLS parser ambiguity: " + query, () => {
  expect(() => createPgPool({ connectionString: "postgresql://u:p@db.example.test/db?" + query, ca: "synthetic-ca", env: {} })).toThrow();
});

test("an explicit no-TLS decision cannot inherit ambient PGSSLMODE", async () => {
  const previous = process.env.PGSSLMODE;
  process.env.PGSSLMODE = "no-verify";
  try {
    const pool = createPgPool({ connectionString: "postgresql://u:p@db.example.test/db", env: {} });
    expect((new pg.Client(pool.options) as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl).toBe(false);
    await pool.end();
  } finally { if (previous === undefined) delete process.env.PGSSLMODE; else process.env.PGSSLMODE = previous; }
});
