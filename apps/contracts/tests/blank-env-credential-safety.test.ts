// Red-first regressions for todos a71e18ce (BUG: @hasna/contracts blank backend
// env and unsafe credential-file fallback).
//
// Every test in this file fails against the pre-fix main. The classes:
//   - a DEFINED blank DATABASE_URL / API_URL must fail closed, never silently
//     select the local sqlite store;
//   - conflicting URL/key aliases (canonical vs short, env vs disk) must be
//     rejected loudly, never silently first-wins;
//   - credential files must be owner-only regular files (0400/0600, no symlink)
//     and reads must be stable against in-place replacement;
//   - a deliberately blank explicit credential must never fall through to a
//     lower tier;
//   - a long-lived client must never send a rotated credential to a retired
//     authority;
//   - the migration ledger must statically refuse transaction-control
//     statements with a migration-id-only diagnostic.
//
// Rebased 2026-09-04 onto the current contracts surface (1.0.0): the client
// now THROWS on blank/conflicting declarations (stricter than the original
// misconfigured=true return), the credential disk layer is the single
// credentials file at ~/.hasna/<app>/config/credentials (home-layout ruling of
// 2026-09-04), and the config-reader guards are exported as
// configFileModeAllowed / configFileReadsCoherent.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createClientTransport,
  resolveClientTransport,
} from "../src/client/transport.js";
import {
  configFileModeAllowed,
  configFileReadsCoherent,
  resolveCredential,
} from "../src/client/credentials.js";
import { resolveDatabaseUrl, resolveServerDataBackend } from "../src/server-backend.js";
import { defineMigration, MigrationLedger } from "../src/kit/templates/migrations.js";
import { wrapExecutor } from "../src/kit/templates/query.js";

const homes: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "a71e18ce-"));
  homes.push(home);
  return home;
}

/**
 * chmod via the system binary: Bun's `chmodSync` drops setuid/setgid/sticky
 * bits, so a special-bit fixture cannot be constructed with it. The kernel
 * keeps those bits when chmod(1) sets them on a file this process owns.
 */
function systemChmod(path: string, mode: string): void {
  execFileSync("chmod", [mode, path]);
}

function appConfigPath(home: string, app: string): string {
  return join(home, ".hasna", app, "config", "credentials");
}

function writeAppConfig(home: string, app: string, body: string): string {
  const path = appConfigPath(home, app);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, { mode: 0o600 });
  return path;
}

afterEach(() => {
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Server backend: a DEFINED blank DATABASE_URL fails closed.
// ---------------------------------------------------------------------------

describe("server backend: a defined blank DATABASE_URL fails closed", () => {
  const cases: Array<[string, Record<string, string>, RegExp]> = [
    ["canonical empty", { HASNA_DEMO_DATABASE_URL: "" }, /blank/i],
    ["canonical whitespace", { HASNA_DEMO_DATABASE_URL: "   " }, /blank/i],
    // quoted whitespace is not recognized as blank by the env reader, but the
    // URL parser refuses it — fail-closed either way, never sqlite.
    ["canonical quoted whitespace", { HASNA_DEMO_DATABASE_URL: '"   "' }, /blank|PostgreSQL connection URL/i],
    ["short alias empty", { DEMO_DATABASE_URL: "" }, /blank/i],
    ["short alias whitespace", { DEMO_DATABASE_URL: " \t " }, /blank/i],
  ];
  for (const [label, env, pattern] of cases) {
    test(`${label} throws instead of silently selecting sqlite`, () => {
      expect(() => resolveServerDataBackend("demo", env)).toThrow(pattern);
    });
  }

  test("resolveDatabaseUrl throws on a defined blank value", () => {
    expect(() => resolveDatabaseUrl("demo", { HASNA_DEMO_DATABASE_URL: "" })).toThrow(/blank/i);
  });

  test("canonical and short aliases with DIFFERENT values are rejected, not silently first", () => {
    const a = "postgres://user:secret-a@one.example/demo";
    const b = "postgres://user:secret-b@two.example/demo";
    let message = "";
    try {
      resolveServerDataBackend("demo", {
        HASNA_DEMO_DATABASE_URL: a,
        DEMO_DATABASE_URL: b,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/HASNA_DEMO_DATABASE_URL/);
    expect(message).toMatch(/DEMO_DATABASE_URL/);
    expect(message).not.toContain("secret-a");
    expect(message).not.toContain("secret-b");
  });

  test("identical values in both aliases stay accepted", () => {
    expect(
      resolveServerDataBackend("demo", {
        HASNA_DEMO_DATABASE_URL: "postgres://one.example/demo",
        DEMO_DATABASE_URL: "postgres://one.example/demo",
      }),
    ).toMatchObject({ backend: "postgresql", databaseUrlPresent: true });
  });
});

// ---------------------------------------------------------------------------
// Client: a DEFINED blank API URL throws, never silent local.
// ---------------------------------------------------------------------------

describe("client: a defined blank API URL throws, never silent local", () => {
  const cases: Array<[string, Record<string, string>]> = [
    ["canonical empty", { HASNA_DEMO_API_URL: "" }],
    ["canonical whitespace", { HASNA_DEMO_API_URL: "   " }],
    ["short alias empty", { DEMO_API_URL: "" }],
  ];
  for (const [label, env] of cases) {
    test(`${label} throws naming the key, never silent local`, () => {
      expect(() => resolveClientTransport("demo", env)).toThrow(/set but blank/);
    });
  }

  test("canonical quoted whitespace throws (fail-closed never sqlite)", () => {
    expect(() => resolveClientTransport("demo", { HASNA_DEMO_API_URL: '"   "' })).toThrow(/URL|blank/i);
  });

  test("a defined blank env URL is not rescued by a valid disk URL", () => {
    const home = makeHome();
    writeAppConfig(home, "demo", "HASNA_DEMO_API_URL=https://disk.example\nHASNA_DEMO_API_KEY=diskA\n");
    expect(() => resolveClientTransport("demo", { HOME: home, HASNA_DEMO_API_URL: "" })).toThrow(/set but blank/);
  });

  test("createClientTransport throws on a defined blank env URL", () => {
    expect(() => createClientTransport("demo", { HASNA_DEMO_API_URL: " " })).toThrow(/set but blank/);
  });
});

// ---------------------------------------------------------------------------
// Client: a disk app-config with a blank or malformed URL declaration is
// misconfigured, never parsed as absent.
// ---------------------------------------------------------------------------

describe("client: a disk URL declaration that is blank or malformed is refused, not absent", () => {
  test("blank URL value on disk", () => {
    const home = makeHome();
    writeAppConfig(home, "demo", 'HASNA_DEMO_API_URL=""\nHASNA_DEMO_API_KEY=diskA\n');
    expect(() => resolveClientTransport("demo", { HOME: home })).toThrow(/declared but blank or malformed/);
  });

  test("unterminated-quote URL value on disk", () => {
    const home = makeHome();
    writeAppConfig(home, "demo", 'HASNA_DEMO_API_URL="https://demo.example.com\nHASNA_DEMO_API_KEY=diskA\n');
    expect(() => resolveClientTransport("demo", { HOME: home })).toThrow(/declared but blank or malformed/);
  });

  test("a fully valid disk pair still selects HTTP (positive control)", () => {
    const home = makeHome();
    writeAppConfig(home, "demo", "HASNA_DEMO_API_URL=https://demo.example.com\nHASNA_DEMO_API_KEY=diskA\n");
    const r = resolveClientTransport("demo", { HOME: home });
    expect(r.transport).toBe("http");
    expect(r.misconfigured).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Credential files: owner-only regular-file, no-symlink, stable read.
// ---------------------------------------------------------------------------

describe("credential files enforce owner-only regular-file no-symlink safety", () => {
  test("a 0644 credential file is refused, never read as absent", () => {
    const home = makeHome();
    const path = appConfigPath(home, "demo");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "HASNA_DEMO_API_KEY=diskA\n"); // default mode -> 0644
    expect(() => resolveCredential("demo", { HOME: home })).toThrow(/not safe|mode/i);
  });

  test("04600 is refused despite masking with 0777", () => {
    const home = makeHome();
    const path = writeAppConfig(home, "demo", "HASNA_DEMO_API_KEY=diskA\n");
    systemChmod(path, "4600");
    expect(() => resolveCredential("demo", { HOME: home })).toThrow(/not safe|mode/i);
  });

  test("a symlinked credential file is refused", () => {
    const home = makeHome();
    const dir = join(home, ".hasna", "demo", "config");
    mkdirSync(dir, { recursive: true });
    const real = join(dir, "real");
    writeFileSync(real, "HASNA_DEMO_API_KEY=diskA\n", { mode: 0o600 });
    symlinkSync(real, join(dir, "credentials"));
    expect(() => resolveCredential("demo", { HOME: home })).toThrow(/not safe|symlink/i);
  });

  test("a directory at the credential path is refused", () => {
    const home = makeHome();
    const path = appConfigPath(home, "demo");
    mkdirSync(path, { recursive: true });
    expect(() => resolveCredential("demo", { HOME: home })).toThrow(/not a regular file|not safe/i);
  });

  test("0600 and 0400 owner-only regular files are accepted", () => {
    const home = makeHome();
    writeAppConfig(home, "demo", "HASNA_DEMO_API_KEY=d6a\n");
    expect(resolveCredential("demo", { HOME: home })?.apiKey).toBe("d6a");

    const home2 = makeHome();
    const path = writeAppConfig(home2, "demo", "HASNA_DEMO_API_KEY=d4a\n");
    systemChmod(path, "400");
    expect(resolveCredential("demo", { HOME: home2 })?.apiKey).toBe("d4a");
  });

  test("mode predicate accepts exactly owner-only 0400/0600, masked with 07777", () => {
    expect(configFileModeAllowed(0o600)).toBe(true);
    expect(configFileModeAllowed(0o400)).toBe(true);
    for (const bad of [0, 0o200, 0o444, 0o644, 0o4600, 0o700, 0o777, 0o1000]) {
      expect(configFileModeAllowed(bad), `mode ${bad.toString(8)} must be refused`).toBe(false);
    }
  });

  test("read-identity predicate: a change on any axis refuses the read", () => {
    const base = { dev: 1, ino: 2, size: 10, mtimeMs: 100, ctimeMs: 100 };
    expect(configFileReadsCoherent(base, base)).toBe(true);
    for (const axis of ["dev", "ino", "size", "mtimeMs", "ctimeMs"] as const) {
      expect(configFileReadsCoherent(base, { ...base, [axis]: base[axis] + 1 })).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// A deliberately blank explicit credential is refused, never resolved around.
// ---------------------------------------------------------------------------

describe("a deliberately blank explicit credential is refused, never resolved around", () => {
  test("blank apiKey argument throws even when a disk credential exists", () => {
    const home = makeHome();
    writeAppConfig(home, "demo", "HASNA_DEMO_API_KEY=diskA\n");
    expect(() => resolveCredential("demo", { HOME: home }, { apiKey: "   " })).toThrow(/blank/i);
  });

  test("blank apiKey argument throws even when a legacy env key exists", () => {
    expect(() =>
      resolveCredential("demo", { HASNA_DEMO_API_KEY: "env-key" }, { apiKey: "" }),
    ).toThrow(/blank/i);
  });
});

// ---------------------------------------------------------------------------
// Authority coherence: a credential never reaches a different authority.
// ---------------------------------------------------------------------------

describe("authority coherence: a credential never reaches a different authority", () => {
  function captureFetch(): {
    calls: Array<{ url: string; key: string }>;
    fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  } {
    const calls: Array<{ url: string; key: string }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, key: headers["x-api-key"] ?? "" });
      return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
    };
    return { calls, fetchImpl };
  }

  function replaceConfigAtomically(home: string, app: string, body: string): void {
    const path = appConfigPath(home, app);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, path);
  }

  test("atomic URL+key replacement never sends the new key to the retired origin", async () => {
    const home = makeHome();
    const path = writeAppConfig(home, "demo", "HASNA_DEMO_API_URL=https://one.example.com\nHASNA_DEMO_API_KEY=key-one\n");
    const { calls, fetchImpl } = captureFetch();
    const client = createClientTransport("demo", { HOME: home }, { fetchImpl });
    expect(client.transport).toBe("http");

    const first = await client.client!.request("GET", "/items");
    expect(first).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("one.example.com");
    expect(calls[0]!.key).toBe("key-one");

    replaceConfigAtomically(home, "demo", "HASNA_DEMO_API_URL=https://two.example.com\nHASNA_DEMO_API_KEY=key-two\n");
    expect(path).not.toContain("two"); // path unchanged; contents replaced

    await expect(client.client!.request("GET", "/items")).rejects.toThrow(/authority|changed/i);
    const leaked = calls.some((c) => c.url.includes("one.example.com") && c.key === "key-two");
    expect(leaked).toBe(false);
    expect(calls).toHaveLength(1); // the second request never reached the network
  });

  test("same-authority key-only rotation heals without rebuilding", async () => {
    const home = makeHome();
    writeAppConfig(home, "demo", "HASNA_DEMO_API_URL=https://one.example.com\nHASNA_DEMO_API_KEY=key-one\n");
    const { calls, fetchImpl } = captureFetch();
    const client = createClientTransport("demo", { HOME: home }, { fetchImpl });

    await client.client!.request("GET", "/items");
    replaceConfigAtomically(home, "demo", "HASNA_DEMO_API_URL=https://one.example.com\nHASNA_DEMO_API_KEY=key-two\n");

    const result = await client.client!.request("GET", "/items");
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toContain("one.example.com");
    expect(calls[1]!.key).toBe("key-two");
  });

  test("env URL plus a disk pair rotated to a different URL fails closed at construction", async () => {
    const home = makeHome();
    writeAppConfig(home, "demo", "HASNA_DEMO_API_URL=https://two.example.com\nHASNA_DEMO_API_KEY=key-two\n");
    const { calls, fetchImpl } = captureFetch();
    expect(() =>
      createClientTransport("demo", { HOME: home, HASNA_DEMO_API_URL: "https://one.example.com" }, { fetchImpl }),
    ).toThrow(/conflict|differ|authority/i);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Migration ledger: transaction-control statements are statically refused.
// ---------------------------------------------------------------------------

describe("migration ledger: transaction-control statements are statically refused", () => {
  function recordingClient(): { executed: string[]; client: ReturnType<typeof wrapExecutor> } {
    const executed: string[] = [];
    const client = wrapExecutor({
      query: async (sql: string) => {
        executed.push(sql);
        return { rows: [], rowCount: 0 };
      },
    });
    return { executed, client };
  }

  const controlStatements = [
    "COMMIT",
    "BEGIN",
    "ROLLBACK",
    "SAVEPOINT sp1",
    "END",
    "ABORT",
    "START TRANSACTION",
    "COMMIT PREPARED 'm1'",
    "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
  ];

  for (const stmt of controlStatements) {
    test(`${stmt} inside migration SQL is refused before any execution`, async () => {
      const { executed, client } = recordingClient();
      const ledger = new MigrationLedger(client, [defineMigration("m1", `CREATE TABLE t (id int); ${stmt};`)]);
      await expect(ledger.migrate()).rejects.toThrow(/m1/);
      expect(executed).toEqual([]);
    });
  }

  test("dry-run refuses the same migration", async () => {
    const { executed, client } = recordingClient();
    const ledger = new MigrationLedger(client, [defineMigration("m1", "BEGIN; CREATE TABLE t (id int); COMMIT;")]);
    await expect(ledger.migrate({ dryRun: true })).rejects.toThrow(/m1/);
    expect(executed).toEqual([]);
  });

  test("the refusal names the migration id and never the SQL", async () => {
    const { client } = recordingClient();
    const ledger = new MigrationLedger(client, [defineMigration("m1", "CREATE TABLE t (id int); COMMIT;")]);
    let message = "";
    try {
      await ledger.migrate();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("m1");
    expect(message).not.toContain("CREATE TABLE");
    expect(message).not.toContain("COMMIT");
  });

  test("a plpgsql function body (BEGIN/END inside $$) is not a transaction-control statement", async () => {
    const { executed, client } = recordingClient();
    const ledger = new MigrationLedger(client, [
      defineMigration(
        "m1",
        "CREATE FUNCTION bump() RETURNS void AS $$ BEGIN UPDATE t SET n = n + 1; END $$ LANGUAGE plpgsql;",
      ),
    ]);
    await expect(ledger.migrate()).resolves.toBeDefined();
    expect(executed.some((sql) => /CREATE FUNCTION/i.test(sql))).toBe(true);
  });

  test("plain DDL migrations still run and are recorded", async () => {
    const { executed, client } = recordingClient();
    const ledger = new MigrationLedger(client, [defineMigration("m1", "CREATE TABLE t (id int);")]);
    await ledger.migrate();
    expect(executed.some((sql) => /CREATE TABLE t/i.test(sql))).toBe(true);
    expect(executed.some((sql) => /INSERT INTO schema_migrations/i.test(sql))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Production surface: the test-only deprecation-reset seam is not exported.
// ---------------------------------------------------------------------------

describe("the test-only deprecation-reset seam is not part of the public surface", () => {
  test("transport does not export __resetCredentialDeprecationNotices", async () => {
    const surface = await import("../src/client/transport.js");
    expect("__resetCredentialDeprecationNotices" in surface).toBe(false);
  });

  test("the package root does not export __resetCredentialDeprecationNotices", async () => {
    const root = await import("../src/index.js");
    expect("__resetCredentialDeprecationNotices" in root).toBe(false);
  });
});