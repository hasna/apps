import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLIENT_TRANSPORTS,
  SERVER_DATA_BACKENDS,
  ClientTransportConfigurationError,
  createClientTransport,
  credentialDiskSources,
  resolveClientTransport,
  resolveDatabaseUrl,
  resolveServerDataBackend,
  validateServiceContractManifest,
} from "../src";
import { MigrationLedger, defineMigration } from "../src/kit/templates/migrations";
import type { TypedQueryClient } from "../src/kit/templates/query";

const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function xdgConfig(app: string, body: string): { env: Record<string, string>; path: string } {
  const root = mkdtempSync(join(tmpdir(), "contracts-xdg-"));
  scratch.push(root);
  const configRoot = join(root, "config");
  const dir = join(configRoot, "hasna");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${app}.env`);
  writeFileSync(path, body, { mode: 0o600 });
  chmodSync(path, 0o600);
  return { env: { HOME: root, XDG_CONFIG_HOME: configRoot }, path };
}

describe("canonical public client", () => {
  test("has one transport and never returns a local fallback", () => {
    expect(CLIENT_TRANSPORTS).toEqual(["http"]);
    for (const env of [
      {},
      { HASNA_DEMO_API_URL: "" },
      { HASNA_DEMO_API_URL: "https://demo.example.test" },
      { HASNA_DEMO_API_URL: "http://demo.example.test", HASNA_DEMO_API_KEY: "fixture-key" },
    ]) {
      expect(() => resolveClientTransport("demo", env)).toThrow(ClientTransportConfigurationError);
    }
  });

  test("uses authenticated HTTPS and keeps exact loopback HTTP as a bounded test allowance", () => {
    const https = resolveClientTransport("demo", {
      HASNA_DEMO_API_URL: "https://demo.example.test",
      HASNA_DEMO_API_KEY: "fixture-key",
    });
    expect(https).toMatchObject({ transport: "http", baseUrl: "https://demo.example.test/v1" });

    const loopback = createClientTransport("demo", {
      HASNA_DEMO_API_URL: "http://127.0.0.1:43123",
      HASNA_DEMO_API_KEY: "fixture-key",
    });
    expect(loopback.transport).toBe("http");
    expect(loopback.resolution.baseUrl).toBe("http://127.0.0.1:43123/v1");
  });

  test("rejects blank and conflicting authority or credential aliases", () => {
    expect(() => resolveClientTransport("demo", {
      HASNA_DEMO_API_URL: " ",
      DEMO_API_URL: "https://demo.example.test",
      HASNA_DEMO_API_KEY: "fixture-key",
    })).toThrow(/blank/);
    expect(() => resolveClientTransport("demo", {
      HASNA_DEMO_API_URL: "https://one.example.test",
      DEMO_API_URL: "https://two.example.test",
      HASNA_DEMO_API_KEY: "fixture-key",
    })).toThrow(/disagree/);
    expect(() => resolveClientTransport("demo", {
      HASNA_DEMO_API_URL: "https://demo.example.test",
      HASNA_DEMO_API_KEY: " ",
      DEMO_API_KEY: "fixture-key",
    })).toThrow(/blank/);
  });

  test("reads only owner-safe XDG config and does not consult legacy data roots", () => {
    const { env, path } = xdgConfig(
      "demo",
      "HASNA_DEMO_API_URL=https://demo.example.test\nHASNA_DEMO_API_KEY=fixture-key\n",
    );
    expect(credentialDiskSources("demo", env)).toEqual([path]);
    expect(resolveClientTransport("demo", env).baseUrl).toBe("https://demo.example.test/v1");
    chmodSync(path, 0o644);
    expect(() => resolveClientTransport("demo", env)).toThrow(/owner-only/);
  });

  test("client database URLs never select or repair a transport", () => {
    expect(() => resolveClientTransport("demo", {
      HASNA_DEMO_DATABASE_URL: "postgres://db.example.test/demo",
    })).toThrow(/API_URL/);
  });

  test("ambiguous disk aliases, duplicate declarations, and blank env keys cannot be rescued", () => {
    for (const extra of ["DEMO_API_KEY=other-key", "HASNA_DEMO_API_KEY=other-key", "DEMO_API_KEY=", "DEMO_API_URL=https://other.example.test"]) {
      const { env } = xdgConfig("demo", `HASNA_DEMO_API_URL=https://demo.example.test\nHASNA_DEMO_API_KEY=fixture-key\n${extra}\n`);
      expect(() => resolveClientTransport("demo", env)).toThrow();
    }
    const { env } = xdgConfig("demo", "HASNA_DEMO_API_URL=https://demo.example.test\nHASNA_DEMO_API_KEY=fixture-key\n");
    expect(() => resolveClientTransport("demo", { ...env, HASNA_DEMO_API_KEY: " " })).toThrow(/blank/);
    expect(() => resolveClientTransport("demo", { ...env, HASNA_DEMO_API_URL: "https://demo.example.test\n" })).toThrow(/control/);
  });

  test("a changed authority never receives a rotated credential through an existing client", async () => {
    const { env, path } = xdgConfig("demo", "HASNA_DEMO_API_URL=https://demo.example.test\nHASNA_DEMO_API_KEY=fixture-key\n");
    let calls = 0;
    const wired = createClientTransport("demo", env, { fetchImpl: async () => { calls++; return Response.json({}); }, retry: false });
    writeFileSync(path, "HASNA_DEMO_API_URL=https://other.example.test\nHASNA_DEMO_API_KEY=rotated-key\n", { mode: 0o600 });
    await expect(wired.client.get("/items")).rejects.toThrow(/authority changed/);
    expect(calls).toBe(0);
  });

  test("binds authority and credential when rotation lands between their reads", async () => {
    let authority = "https://old.example.test";
    let key = "old-key";
    const rotateDuringCredentialRead = true;
    const env: Record<string, string> = {};
    Object.defineProperties(env, {
      HASNA_DEMO_API_URL: { enumerable: true, get: () => authority },
      HASNA_DEMO_API_KEY: {
        enumerable: true,
        get: () => {
          if (rotateDuringCredentialRead) {
            authority = "https://new.example.test";
            key = "new-authority-key";
          }
          return key;
        },
      },
    });

    let calls = 0;
    expect(() => createClientTransport("demo", env, {
      fetchImpl: async () => {
        calls++;
        return Response.json({});
      },
      retry: false,
    })).toThrow(/accessor-backed/);
    // Accessor-backed configuration is refused before either getter can run,
    // which is stricter than detecting its rotation only at request time.
    expect(authority).toBe("https://old.example.test");
    expect(key).toBe("old-key");
    expect(calls).toBe(0);
  });
});

describe("canonical server backend", () => {
  test("is PostgreSQL-only and fails closed on missing, blank, invalid, or ambiguous URLs", () => {
    expect([...SERVER_DATA_BACKENDS] as string[]).toEqual(["postgresql"]);
    for (const env of [
      {},
      { HASNA_DEMO_DATABASE_URL: "" },
      { HASNA_DEMO_DATABASE_URL: "sqlite:///tmp/demo.db" },
      { HASNA_DEMO_DATABASE_URL: "postgres://db.example.test" },
      {
        HASNA_DEMO_DATABASE_URL: "postgres://one.example.test/demo",
        DEMO_DATABASE_URL: "postgres://two.example.test/demo",
      },
    ]) {
      expect(() => resolveServerDataBackend("demo", env)).toThrow();
    }
    const env = { HASNA_DEMO_DATABASE_URL: "postgres://db.example.test/demo" };
    expect(resolveServerDataBackend("demo", env)).toEqual({
      backend: "postgresql",
      source: "HASNA_DEMO_DATABASE_URL",
      databaseUrlPresent: true,
      databaseUrlSource: "HASNA_DEMO_DATABASE_URL",
    });
    expect(resolveDatabaseUrl("demo", env)).toBe(env.HASNA_DEMO_DATABASE_URL);
  });

  test("retired selectors are inert and cannot select a backend", () => {
    expect(() => resolveServerDataBackend("demo", { HASNA_DEMO_STORAGE_MODE: "sqlite" })).toThrow(/DATABASE_URL/);
    expect(resolveServerDataBackend("demo", {
      HASNA_DEMO_STORAGE_MODE: "sqlite",
      HASNA_DEMO_DATABASE_URL: "postgres://db.example.test/demo",
    }).backend).toBe("postgresql");
  });

  test("manifest schema keeps SQLite only as explicit legacy capability metadata", () => {
    const base = {
      schema: "hasna.service_contract.v1",
      name: "demo",
      class: "cli-with-store",
      contractVersion: "v1",
      kitVersion: "0.14.2",
      bins: ["demo"],
      storage: {
        backend: "postgresql",
        engines: ["sqlite", "postgresql"],
        envPrefix: "HASNA_DEMO_",
        sqlitePath: "/tmp/legacy.db",
      },
    } as const;
    expect(validateServiceContractManifest(base).success).toBe(true);
    expect(validateServiceContractManifest({
      ...base,
      storage: { backend: "sqlite", engines: ["sqlite"], sqlitePath: "/tmp/legacy.db" },
      metadata: { conformance: { waivedStorageEngines: [{ engine: "postgresql", reason: "Bounded legacy import tool only." }] } },
    }).success).toBe(true);
  });
});

test("generated migration ledger rejects transaction control before any SQL", async () => {
  let calls = 0;
  const client = {
    many: async () => { calls++; return []; },
    execute: async () => { calls++; return { rowCount: 0 }; },
  } as unknown as TypedQueryClient;
  for (const sql of ["BEGIN; CREATE TABLE demo(id int); COMMIT;", 'RELEASE SAVEPOINT "quoted";', "/* outer /* inner */ still comment */ COMMIT;", "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;"]) {
    const ledger = new MigrationLedger(client, [defineMigration("unsafe", sql)]);
    await expect(ledger.migrate()).rejects.toThrow(/transaction-control/);
  }
  expect(calls).toBe(0);
});
