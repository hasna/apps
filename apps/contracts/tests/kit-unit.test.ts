import { describe, expect, test } from "bun:test";
import {
  SERVER_DATA_BACKENDS,
  resolveServerDataBackend,
  resolveDatabaseUrl,
  serverDataBackendEnvKeys,
} from "../src/kit/templates/backend";
import { resolveTlsConfig, sslModeFromConnectionString } from "../src/kit/templates/tls";
import { wrapExecutor, type PgExecutor } from "../src/kit/templates/query";
import {
  checksumSql,
  defineMigration,
  MigrationLedger,
  type Migration,
} from "../src/kit/templates/migrations";
import { checkHealth, checkReady } from "../src/kit/templates/health";
import type { TypedQueryClient } from "../src/kit/templates/query";

// --- backend.ts ----------------------------------------------------------

describe("kit server backend resolution", () => {
  test("exposes exactly postgresql", () => {
    expect(SERVER_DATA_BACKENDS).toEqual(["postgresql"]);
  });

  test("database URL presence selects postgresql", () => {
    const keys = serverDataBackendEnvKeys("todos");
    expect(keys.databaseUrlKeys[0]).toBe("HASNA_TODOS_DATABASE_URL");

    expect(() => resolveServerDataBackend("todos", {})).toThrow(/DATABASE_URL.*required/);

    const aliasEnv = resolveServerDataBackend("todos", {
      TODOS_DATABASE_URL: "postgres://fixture.invalid/todos",
    });
    expect(aliasEnv.backend).toBe("postgresql");
    expect(aliasEnv.databaseUrlPresent).toBe(true);
    expect(aliasEnv.databaseUrlSource).toBe("TODOS_DATABASE_URL");
  });

  test("legacy mode variables are inert; DATABASE_URL is the only selector", () => {
    for (const value of ["cloud", "", "   "]) {
      expect(() => resolveServerDataBackend("todos", { HASNA_TODOS_STORAGE_MODE: value })).toThrow(/DATABASE_URL/);
      expect(
        resolveServerDataBackend("todos", {
          HASNA_TODOS_STORAGE_MODE: value,
          HASNA_TODOS_DATABASE_URL: "postgres://user@host/db",
        }).backend,
      ).toBe("postgresql");
    }
  });

  test("resolveDatabaseUrl honors alias but never logs value", () => {
    expect(() => resolveDatabaseUrl("todos", {})).toThrow(/DATABASE_URL.*required/);
    expect(resolveDatabaseUrl("todos", { TODOS_DATABASE_URL: "postgres://user@h/db" })).toBe(
      "postgres://user@h/db",
    );
  });
});

// --- tls.ts --------------------------------------------------------------

describe("kit TLS (one correct approach)", () => {
  test("parses sslmode variants", () => {
    expect(sslModeFromConnectionString("postgres://h/db")).toBe("disable");
    expect(sslModeFromConnectionString("postgres://h/db?sslmode=require")).toBe("require");
    expect(sslModeFromConnectionString("postgres://h/db?sslmode=verify-full")).toBe("verify-full");
    expect(sslModeFromConnectionString("postgres://h/db?ssl=true")).toBe("require");
    expect(sslModeFromConnectionString("?sslnegotiation=direct")).toBe("require");
  });

  test("require verifies; verify-full needs a CA", () => {
    // Isolate from ambient PGSSLROOTCERT / NODE_EXTRA_CA_CERTS in the shell.
    const noEnv = { env: {} } as const;
    // No ssl parameter at all: NO explicit policy, so pg's own PGSSLMODE
    // fallback still applies. That is libpq behaviour and is deliberate.
    expect(resolveTlsConfig("postgres://h/db", noEnv)).toBeUndefined();
    // An EXPLICIT operator "off" resolves to an explicit `false` (row c317d0bf).
    // `undefined` would set no `ssl` key, letting pg read PGSSLMODE from the
    // environment and override the instruction in the DSN.
    expect(resolveTlsConfig("postgres://h/db?sslmode=disable", noEnv)).toBe(false);
    expect(resolveTlsConfig("postgres://h/db?sslmode=DISABLE", noEnv)).toBe(false);
    expect(resolveTlsConfig("postgres://h/db?ssl=false", noEnv)).toBe(false);
    expect(resolveTlsConfig("postgres://h/db?ssl=0", noEnv)).toBe(false);
    expect(resolveTlsConfig("postgres://h/db?ssl=off", noEnv)).toBe(false);
    // sslmode wins over ssl, so an explicit disable stays explicit.
    expect(resolveTlsConfig("postgres://h/db?sslmode=disable&ssl=true", noEnv)).toBe(false);
    expect(resolveTlsConfig("postgres://h/db?sslmode=require", noEnv)).toEqual({ rejectUnauthorized: true });
    expect(() => resolveTlsConfig("postgres://h/db?sslmode=verify-full", noEnv)).toThrow(/requires a CA bundle/);
    expect(resolveTlsConfig("postgres://h/db?sslmode=verify-full", { ca: "PEM", env: {} })).toEqual({
      rejectUnauthorized: true,
      ca: "PEM",
    });
    // require pins a CA when one is available, and verifies either way.
    expect(resolveTlsConfig("postgres://h/db?sslmode=require", { ca: "PEM", env: {} })).toEqual({
      rejectUnauthorized: true,
      ca: "PEM",
    });
    // `prefer` matches `require`: pg has always treated it as an alias for
    // verify-full, so the resolved config says so.
    expect(resolveTlsConfig("postgres://h/db?sslmode=prefer", noEnv)).toEqual({ rejectUnauthorized: true });
  });

  // Row 12615073. `sslmode` has always thrown on an unknown value; its sibling
  // `ssl` silently resolved to `disable`, so `?ssl=treu` handed the decision to
  // an ambient PGSSLMODE while the operator believed they had asked for TLS.
  // Both directions are pinned: the unknown value must be REFUSED, and every
  // recognised spelling must behave EXACTLY as it did before — a fix that
  // rejects valid input would be worse than the defect it closes.
  describe("an unrecognised ssl= value is refused, and recognised ones are untouched", () => {
    const noEnv = { env: {} } as const;

    test("refuses a value that is neither on nor off", () => {
      for (const bad of ["treu", "banana", "no-verify", "trueish", "trues", "enable", "verify-full"]) {
        expect(() => sslModeFromConnectionString(`postgres://h/db?ssl=${bad}`)).toThrow(
          `Unknown ssl value '${bad}' in connection string.`,
        );
        expect(() => resolveTlsConfig(`postgres://h/db?ssl=${bad}`, noEnv)).toThrow(/Unknown ssl value/);
      }
    });

    test("every recognised ON value still resolves to require", () => {
      for (const on of ["1", "true", "yes", "on", "require"]) {
        expect(sslModeFromConnectionString(`postgres://h/db?ssl=${on}`)).toBe("require");
        expect(resolveTlsConfig(`postgres://h/db?ssl=${on}`, noEnv)).toEqual({ rejectUnauthorized: true });
      }
      // Case and surrounding whitespace are normalised before the check, so the
      // new throw cannot fire on a value that used to be accepted.
      expect(sslModeFromConnectionString("postgres://h/db?ssl=TRUE")).toBe("require");
      expect(sslModeFromConnectionString("postgres://h/db?ssl=%20true%20")).toBe("require");
    });

    test("every recognised OFF value still resolves to an explicit false", () => {
      for (const off of ["0", "false", "no", "off", "disable"]) {
        expect(sslModeFromConnectionString(`postgres://h/db?ssl=${off}`)).toBe("disable");
        expect(resolveTlsConfig(`postgres://h/db?ssl=${off}`, noEnv)).toBe(false);
      }
      expect(sslModeFromConnectionString("postgres://h/db?ssl=FALSE")).toBe("disable");
      expect(resolveTlsConfig("postgres://h/db?ssl=FALSE", noEnv)).toBe(false);
    });

    test("refuses a present-but-empty ssl value instead of treating it as absence", () => {
      for (const empty of ["", "%20", "%20%20"]) {
        expect(() => sslModeFromConnectionString(`?ssl=${empty}`)).toThrow(
          /Unknown ssl value/,
        );
        expect(() => resolveTlsConfig(`?ssl=${empty}`, noEnv)).toThrow(
          /Unknown ssl value/,
        );
      }
    });

    test("no ssl parameter at all is untouched — PGSSLMODE fallback is preserved", () => {
      expect(sslModeFromConnectionString("postgres://h/db")).toBe("disable");
      expect(resolveTlsConfig("postgres://h/db", noEnv)).toBeUndefined();
    });

    test("sslmode still wins, so it decides before ssl is ever validated", () => {
      // Parity with hasna/emails: an explicit sslmode short-circuits, and the
      // ssl value beside it is never reached. Pinned so the precedence cannot
      // drift into throwing on a DSN that resolves fine today.
      expect(sslModeFromConnectionString("postgres://h/db?sslmode=require&ssl=treu")).toBe("require");
      expect(resolveTlsConfig("postgres://h/db?sslmode=disable&ssl=treu", noEnv)).toBe(false);
      // The unknown-sslmode throw is unchanged.
      expect(() => sslModeFromConnectionString("postgres://h/db?sslmode=bogus")).toThrow(/Unknown sslmode/);
    });

    test("sslnegotiation=direct still implies TLS when no ssl parameter is present", () => {
      expect(sslModeFromConnectionString("postgres://h/db?sslnegotiation=direct")).toBe("require");
    });
  });

  test("loads CA bundle from PGSSLROOTCERT / NODE_EXTRA_CA_CERTS env", () => {
    const config = resolveTlsConfig("postgres://h/db?sslmode=verify-full", {
      env: { NODE_EXTRA_CA_CERTS: "PATH_UNUSED" },
      ca: "INLINE_CA",
    });
    expect(config).toEqual({ rejectUnauthorized: true, ca: "INLINE_CA" });
  });
});

// --- query.ts ------------------------------------------------------------

function stubExecutor(rowsByCall: Record<string, unknown[]>): PgExecutor {
  return {
    async query<T>(sql: string): Promise<{ rows: T[]; rowCount: number | null }> {
      const rows = (rowsByCall[sql] ?? []) as T[];
      return { rows, rowCount: rows.length };
    },
  };
}

describe("kit typed query wrapper", () => {
  test("get returns first row or null (the method knowledge dropped)", async () => {
    const client = wrapExecutor(
      stubExecutor({ "SELECT * FROM t": [{ id: 1 }, { id: 2 }], "SELECT * FROM empty": [] }),
    );
    expect(await client.get("SELECT * FROM t")).toEqual({ id: 1 });
    expect(await client.get("SELECT * FROM empty")).toBeNull();
    expect(await client.many("SELECT * FROM t")).toHaveLength(2);
  });

  test("one throws unless exactly one row", async () => {
    const client = wrapExecutor(stubExecutor({ single: [{ id: 1 }], multi: [{ id: 1 }, { id: 2 }] }));
    expect(await client.one("single")).toEqual({ id: 1 });
    await expect(client.one("multi")).rejects.toThrow(/exactly one row/);
  });
});

// --- migrations.ts (in-memory ledger shim) -------------------------------

/**
 * Minimal in-memory TypedQueryClient that emulates the `schema_migrations`
 * ledger, so ledger logic is testable without a live Postgres (pragmatic
 * sqlite/pg-mem substitute). It interprets the exact SQL the ledger emits.
 */
function inMemoryLedgerClient(): TypedQueryClient & { appliedDdl: string[] } {
  const ledger = new Map<string, { id: string; checksum: string; applied_at: string }>();
  const appliedDdl: string[] = [];
  const client: TypedQueryClient & { appliedDdl: string[] } = {
    appliedDdl,
    async query<T>() {
      return { rows: [] as T[], rowCount: 0 };
    },
    async many<T>(sql: string): Promise<T[]> {
      if (/SELECT id, checksum, applied_at FROM/.test(sql)) {
        return [...ledger.values()].sort((a, b) => a.id.localeCompare(b.id)) as unknown as T[];
      }
      return [] as T[];
    },
    async get<T>() {
      return null as T | null;
    },
    async one<T>(): Promise<T> {
      throw new Error("not used");
    },
    async execute(sql: string, params?: readonly unknown[]) {
      if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return;
      if (/^INSERT INTO/.test(sql.trim()) && params) {
        const [id, checksum] = params as [string, string];
        ledger.set(id, { id, checksum, applied_at: new Date().toISOString() });
        return;
      }
      appliedDdl.push(sql);
    },
  };
  return client;
}

describe("kit migration ledger", () => {
  const migrations: Migration[] = [
    defineMigration("0001_init", "CREATE TABLE demo (id int);"),
    defineMigration("0002_more", "ALTER TABLE demo ADD COLUMN name text;"),
  ];

  test("checksum is stable and content-addressed", () => {
    expect(checksumSql("SELECT 1;")).toBe(checksumSql(" SELECT 1; "));
    expect(checksumSql("A")).not.toBe(checksumSql("B"));
  });

  test("applies pending once, then is idempotent", async () => {
    const client = inMemoryLedgerClient();
    const ledger = new MigrationLedger(client, migrations);
    const first = await ledger.migrate();
    expect(first.applied.map((m) => m.id)).toEqual(["0001_init", "0002_more"]);
    expect(client.appliedDdl).toHaveLength(2);

    const second = await ledger.migrate();
    expect(second.plan.every((p) => p.state === "already_applied")).toBe(true);
    expect(client.appliedDdl).toHaveLength(2); // no re-run
  });

  test("dry-run reports plan without applying", async () => {
    const client = inMemoryLedgerClient();
    const ledger = new MigrationLedger(client, migrations);
    const plan = await ledger.migrate({ dryRun: true });
    expect(plan.dryRun).toBe(true);
    expect(plan.plan.every((p) => p.state === "pending")).toBe(true);
    expect(client.appliedDdl).toHaveLength(0);
  });

  test("detects checksum drift after apply", async () => {
    const client = inMemoryLedgerClient();
    await new MigrationLedger(client, migrations).migrate();
    const tampered: Migration[] = [
      { ...migrations[0]!, sql: "CREATE TABLE demo (id bigint);", checksum: checksumSql("changed") },
      migrations[1]!,
    ];
    await expect(new MigrationLedger(client, tampered).migrate()).rejects.toThrow(/checksum mismatch/);
  });

  test("detects downgrade (applied migration unknown to build)", async () => {
    const client = inMemoryLedgerClient();
    await new MigrationLedger(client, migrations).migrate();
    await expect(new MigrationLedger(client, [migrations[0]!]).migrate()).rejects.toThrow(/not recognized/);
  });

  test("rejects duplicate migration ids", () => {
    expect(() => new MigrationLedger(inMemoryLedgerClient(), [migrations[0]!, migrations[0]!])).toThrow(
      /Duplicate migration id/,
    );
  });

  // --- acknowledged legacy migrations (O15-00671) -------------------------
  //
  // The prod domains ledger carries an out-of-band row
  // (`domains_apikeys_tenancy_0001`) that no published build ever generated.
  // The downgrade guard refuses it, so `domains db migrate` fails and the
  // deploy lane is blocked. The remedy is an EXPLICIT opt-in list of applied
  // ids that the build acknowledges as non-reproducible history: they pass
  // the downgrade guard, are never checksum-compared (their SQL is gone), and
  // are never re-applied. Every other guarantee is unchanged: an
  // unacknowledged unknown row still throws, and declared migrations still
  // checksum-bind.

  async function seedLegacyRow(
    client: ReturnType<typeof inMemoryLedgerClient>,
    id: string,
    checksum = "sha256:not-reproducible",
  ): Promise<void> {
    await client.execute(
      `INSERT INTO schema_migrations (id, checksum, applied_at) VALUES ($1, $2, now())`,
      [id, checksum],
    );
  }

  test("acknowledged legacy applied rows pass the downgrade guard and are never re-applied", async () => {
    const client = inMemoryLedgerClient();
    await new MigrationLedger(client, migrations).migrate();
    await seedLegacyRow(client, "domains_apikeys_tenancy_0001");

    const ledger = new MigrationLedger(client, migrations, {
      acknowledgedLegacyIds: ["domains_apikeys_tenancy_0001"],
    });
    const result = await ledger.migrate();
    expect(result.applied.map((m) => m.id)).toEqual(
      expect.arrayContaining(["0001_init", "0002_more", "domains_apikeys_tenancy_0001"]),
    );
    expect(client.appliedDdl).toHaveLength(2); // declared migrations only, never re-run
  });

  test("acknowledged legacy rows are not checksum-compared (their SQL is not reproducible)", async () => {
    const client = inMemoryLedgerClient();
    await new MigrationLedger(client, migrations).migrate();
    await seedLegacyRow(client, "legacy_arbitrary_checksum", "not-a-real-checksum");

    const ledger = new MigrationLedger(client, migrations, {
      acknowledgedLegacyIds: ["legacy_arbitrary_checksum"],
    });
    await expect(ledger.migrate()).resolves.toBeDefined();
  });

  test("acknowledging one id does not mask OTHER unknown applied rows", async () => {
    const client = inMemoryLedgerClient();
    await new MigrationLedger(client, migrations).migrate();
    await seedLegacyRow(client, "legacy_a");
    await seedLegacyRow(client, "rogue_b");

    const ledger = new MigrationLedger(client, migrations, { acknowledgedLegacyIds: ["legacy_a"] });
    await expect(ledger.migrate()).rejects.toThrow(/rogue_b.*not recognized/);
  });

  test("an acknowledged id that is also declared is rejected at construction", () => {
    expect(
      () =>
        new MigrationLedger(inMemoryLedgerClient(), migrations, {
          acknowledgedLegacyIds: ["0001_init"],
        }),
    ).toThrow(/also declared/);
  });
});

// --- health.ts -----------------------------------------------------------

describe("kit health/ready", () => {
  test("checkHealth ok and failure", async () => {
    const ok = await checkHealth(wrapExecutor(stubExecutor({ "SELECT 1 AS ok": [{ ok: 1 }] })));
    expect(ok.ok).toBe(true);
    const failing: TypedQueryClient = {
      ...wrapExecutor(stubExecutor({})),
      async get() {
        throw new Error("boom");
      },
    };
    const bad = await checkHealth(failing);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("boom");
  });

  test("checkReady flags pending migrations", async () => {
    const migrations = [defineMigration("0001", "CREATE TABLE x (id int);")];
    const client = inMemoryLedgerClient();
    const before = await checkReady(client, migrations);
    expect(before.ok).toBe(false);
    expect(before.pendingMigrations).toEqual(["0001"]);
    await new MigrationLedger(client, migrations).migrate();
    const after = await checkReady(client, migrations);
    expect(after.ok).toBe(true);
    expect(after.pendingMigrations).toEqual([]);
  });
});
