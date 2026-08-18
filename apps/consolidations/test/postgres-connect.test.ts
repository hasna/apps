import { afterAll, describe, expect, it } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgresStore } from "../src/db/postgres-store.js";

// The *_DATABASE_URL_FILE mount variant must reach the pool factory: the
// docker-compose self-host artifact wires the DSN through the FILE secret mount.
// connect() must fail on the FILE READ (or the connection), never on "needs a
// database URL" — and with no DSN at all it must refuse fast.

const ORIG_URL = process.env["HASNA_CONSOLIDATIONS_DATABASE_URL"];
const ORIG_ALIAS = process.env["CONSOLIDATIONS_DATABASE_URL"];
const ORIG_FILE = process.env["HASNA_CONSOLIDATIONS_DATABASE_URL_FILE"];

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prev = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    prev.set(key, process.env[key]);
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of prev) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

describe("PostgresStore.connect backend resolution", () => {
  it("refuses fast with no DSN anywhere", async () => {
    await withEnv(
      { HASNA_CONSOLIDATIONS_DATABASE_URL: undefined, CONSOLIDATIONS_DATABASE_URL: undefined, HASNA_CONSOLIDATIONS_DATABASE_URL_FILE: undefined },
      async () => {
        await expect(PostgresStore.connect()).rejects.toThrow(/needs a database URL/);
      },
    );
  });

  it("honors the *_DATABASE_URL_FILE mount (fails on the file read, never on resolution)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cons-dsn-file-"));
    const file = join(dir, "dsn");
    writeFileSync(file, "postgres://probe:probe@db:5432/consolidations?sslmode=verify-full", "utf8");
    try {
      await withEnv(
        { HASNA_CONSOLIDATIONS_DATABASE_URL: undefined, CONSOLIDATIONS_DATABASE_URL: undefined, HASNA_CONSOLIDATIONS_DATABASE_URL_FILE: file },
        async () => {
          // The connection itself cannot succeed without a live server; the
          // assertion is that resolution succeeds and the failure is a
          // connection-stage error, never "needs a database URL".
          const err = await PostgresStore.connect().then(
            () => null,
            (e: unknown) => e,
          );
          expect(err).not.toBeNull();
          const message = err instanceof Error ? err.message : String(err);
          expect(message).not.toContain("needs a database URL");
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (ORIG_URL === undefined) delete process.env["HASNA_CONSOLIDATIONS_DATABASE_URL"];
    else process.env["HASNA_CONSOLIDATIONS_DATABASE_URL"] = ORIG_URL;
    if (ORIG_ALIAS === undefined) delete process.env["CONSOLIDATIONS_DATABASE_URL"];
    else process.env["CONSOLIDATIONS_DATABASE_URL"] = ORIG_ALIAS;
    if (ORIG_FILE === undefined) delete process.env["HASNA_CONSOLIDATIONS_DATABASE_URL_FILE"];
    else process.env["HASNA_CONSOLIDATIONS_DATABASE_URL_FILE"] = ORIG_FILE;
  });
});
