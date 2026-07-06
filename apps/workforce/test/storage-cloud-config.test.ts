import { afterEach, describe, expect, it } from "bun:test";
import { openCloudPool } from "../src/db/database.js";
import { resolveStorageMode } from "../src/config.js";

// §4.8 + §2.3 config assertions (no live DB required).

afterEach(() => {
  delete process.env["HASNA_WORKFORCE_STORAGE_MODE"];
  delete process.env["HASNA_WORKFORCE_DATABASE_URL"];
});

describe("cloud storage config", () => {
  it("refuses a cloud DSN that is not sslmode=verify-full", async () => {
    await expect(openCloudPool("postgres://u:p@h:5432/db?sslmode=require")).rejects.toThrow(/verify-full/);
  });

  it("fail-closed: a DSN present while mode=local is a hard error", () => {
    process.env["HASNA_WORKFORCE_STORAGE_MODE"] = "local";
    process.env["HASNA_WORKFORCE_DATABASE_URL"] = "postgres://u:p@h:5432/db?sslmode=verify-full";
    expect(() => resolveStorageMode()).toThrow(/DATABASE_URL is present but/i);
  });

  it("normalizes deprecated aliases to cloud", () => {
    process.env["HASNA_WORKFORCE_STORAGE_MODE"] = "self_hosted";
    process.env["HASNA_WORKFORCE_DATABASE_URL"] = "postgres://u:p@h/db?sslmode=verify-full";
    expect(resolveStorageMode()).toBe("cloud");
  });

  it("rejects an unknown storage mode", () => {
    process.env["HASNA_WORKFORCE_STORAGE_MODE"] = "hybrid-turbo";
    expect(() => resolveStorageMode()).toThrow(/Unknown storage mode/);
  });
});
