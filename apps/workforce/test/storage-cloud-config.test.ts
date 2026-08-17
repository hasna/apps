import { afterEach, describe, expect, it } from "bun:test";
import { openCloudPool } from "../src/db/database.js";
import { resolveStorageMode } from "../src/config.js";

// §4.8 + §2.3 config assertions (no live DB required).

afterEach(() => {
  delete process.env["HASNA_WORKFORCE_DATABASE_URL"];
});

describe("cloud storage config", () => {
  it("refuses a cloud DSN that is not sslmode=verify-full", async () => {
    await expect(openCloudPool("postgres://u:p@h:5432/db?sslmode=require")).rejects.toThrow(/verify-full/);
  });

  it("resolves the postgres backend when a DATABASE_URL is present", () => {
    process.env["HASNA_WORKFORCE_DATABASE_URL"] = "postgres://db.internal:5432/workforce?sslmode=verify-full";
    expect(resolveStorageMode()).toBe("cloud");
  });

  it("defaults to SQLite and ignores the retired STORAGE_MODE variable", () => {
    process.env["HASNA_WORKFORCE_STORAGE_MODE"] = "cloud";
    process.env["HASNA_WORKFORCE_DATABASE_URL"] = "postgres://db.internal:5432/workforce?sslmode=verify-full";
    expect(resolveStorageMode()).toBe("cloud");
    delete process.env["HASNA_WORKFORCE_DATABASE_URL"];
    process.env["HASNA_WORKFORCE_STORAGE_MODE"] = "cloud";
    expect(resolveStorageMode()).toBe("local");
  });
});
