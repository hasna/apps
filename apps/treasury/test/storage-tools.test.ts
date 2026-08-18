import { afterEach, describe, expect, it } from "bun:test";
import { seedFixture, type Fixture } from "./helpers.js";
import { openDatabase } from "../src/db/database.js";
import { storagePush, storageStatus, AUDIT_TABLES } from "../src/services/storage.js";
import { resolveServerBackend } from "../src/config.js";

let fx: Fixture;
afterEach(() => fx?.cleanup());

describe("storage tools", () => {
  it("returns a redacted status with computed remote_reachable", async () => {
    fx = await seedFixture();
    const status = await storageStatus(fx.owner);
    expect(status.backend).toBe("sqlite");
    expect(status.remote_reachable).toBe(false); // sqlite: no reachable remote
    expect(status.migrations_applied).toBeGreaterThanOrEqual(1);
    expect(status).not.toHaveProperty("dsn");
  });

  it("selects the postgresql backend when a DATABASE_URL is set, sqlite otherwise", () => {
    delete process.env["HASNA_TREASURY_DATABASE_URL"];
    delete process.env["TREASURY_DATABASE_URL"];
    delete process.env["HASNA_TREASURY_DATABASE_URL_FILE"];
    expect(resolveServerBackend()).toBe("sqlite");
    process.env["HASNA_TREASURY_DATABASE_URL"] = "postgres://u:p@db/treasury?sslmode=verify-full";
    expect(resolveServerBackend()).toBe("postgresql");
    delete process.env["HASNA_TREASURY_DATABASE_URL"];
  });

  it("rejects removed legacy storage-mode variables instead of interpreting them", () => {
    for (const key of ["HASNA_TREASURY_STORAGE_MODE", "TREASURY_STORAGE_MODE", "HASNA_TREASURY_MODE", "TREASURY_MODE"]) {
      process.env[key] = "cloud";
      expect(() => resolveServerBackend()).toThrow(/was removed/i);
      expect(() => resolveServerBackend()).toThrow(/DATABASE_URL/);
      delete process.env[key];
    }
  });

  it("pushes domain tables to a counterpart but NEVER the append-only audit table", async () => {
    fx = await seedFixture();
    const target = await openDatabase({ path: ":memory:" });
    const result = await storagePush(fx.owner, { target });
    expect(result.tables).toHaveProperty("entities");
    expect(result.audit_excluded).toEqual(AUDIT_TABLES);

    const entities = await target.all("SELECT * FROM entities");
    expect(entities.length).toBe(2);
    const audit = await target.all("SELECT * FROM audit_log");
    expect(audit.length).toBe(0); // audit never mirrored
    await target.close();
  });

  it("refuses to sync the audit table explicitly", async () => {
    fx = await seedFixture();
    const target = await openDatabase({ path: ":memory:" });
    await expect(storagePush(fx.owner, { tables: ["audit_log"], target })).rejects.toThrow(/append-only/);
    await target.close();
  });

  it("fails closed instead of silently self-copying when no counterpart target is given (sqlite backend)", async () => {
    for (const k of ["HASNA_TREASURY_DATABASE_URL", "TREASURY_DATABASE_URL", "HASNA_TREASURY_DATABASE_URL_FILE", "TREASURY_DATABASE_URL_FILE"]) {
      delete process.env[k];
    }
    fx = await seedFixture();
    // sqlite-backed process + no injected target => the counterpart is the
    // POSTGRESQL store, which requires a DSN. It must throw (fail-closed), NOT
    // re-open the same SQLite and self-copy rows into itself (the former silent
    // no-op).
    await expect(storagePush(fx.owner)).rejects.toThrow(/postgresql storage requires/i);
  });
});
