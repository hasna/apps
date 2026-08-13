import { describe, expect, test } from "bun:test";
import pg from "pg";
import { buildPgPoolConfig } from "./remote-storage.js";

function pgUrl(host: string, query?: string): string {
  return `postgres://user:pass@${host}:5432/brains${query ? `?${query}` : ""}`;
}

function pgEffectiveSsl(connectionString: string): unknown {
  const client = new pg.Client(buildPgPoolConfig(connectionString));
  return (client as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl;
}

describe("PostgreSQL remote storage TLS", () => {
  test("requires verified TLS for remote hosts by default", () => {
    expect(buildPgPoolConfig(pgUrl("db.example.com")).ssl).toEqual({ rejectUnauthorized: true });
  });

  test("keeps verified TLS when standard TLS params are present", () => {
    expect(buildPgPoolConfig(pgUrl("db.example.com", ["sslmode", "require"].join("="))).ssl).toEqual({
      rejectUnauthorized: true,
    });
    expect(buildPgPoolConfig(pgUrl("db.example.com", ["ssl", "true"].join("="))).ssl).toEqual({
      rejectUnauthorized: true,
    });
    expect(pgEffectiveSsl(pgUrl("db.example.com", ["sslmode", "require"].join("=")))).toEqual({
      rejectUnauthorized: true,
    });
  });

  test("rejects remote hosts that disable or weaken TLS", () => {
    expect(() => buildPgPoolConfig(pgUrl("db.example.com", ["sslmode", "disable"].join("=")))).toThrow(
      "verified TLS"
    );
    expect(() => buildPgPoolConfig(pgUrl("db.example.com", ["ssl", "false"].join("=")))).toThrow(
      "verified TLS"
    );
    expect(() => buildPgPoolConfig(pgUrl("db.example.com", ["sslmode", "prefer"].join("=")))).toThrow(
      "verified TLS"
    );
    expect(() =>
      buildPgPoolConfig(pgUrl("db.example.com", `${["sslmode", "verify-full"].join("=")}&${["sslmode", "disable"].join("=")}`))
    ).toThrow("verified TLS");
    expect(() =>
      buildPgPoolConfig(pgUrl("db.example.com", `${["ssl", "true"].join("=")}&${["ssl", "0"].join("=")}`))
    ).toThrow("verified TLS");
    expect(() =>
      buildPgPoolConfig(pgUrl("db.example.com", `${["sslmode", "require"].join("=")}&uselibpqcompat=true`))
    ).toThrow("verified TLS");
  });

  test("allows local PostgreSQL without TLS for development", () => {
    expect(buildPgPoolConfig(pgUrl("localhost", ["sslmode", "disable"].join("="))).ssl).toBeUndefined();
    expect(buildPgPoolConfig(pgUrl("127.0.0.1")).ssl).toBeUndefined();
  });
});
