import { describe, expect, it } from "bun:test";
import { databaseUrlPresent, resolveDataBackend } from "../src/config.js";

describe("server data backend resolution", () => {
  it("defaults to sqlite", () => {
    expect(resolveDataBackend({})).toBe("sqlite");
  });

  it("selects postgresql when a DATABASE_URL is present", () => {
    expect(resolveDataBackend({ HASNA_CONSOLIDATIONS_DATABASE_URL: "postgres://x/y" })).toBe("postgresql");
  });

  it("honors the alias env key", () => {
    expect(resolveDataBackend({ CONSOLIDATIONS_DATABASE_URL: "postgres://x/y" })).toBe("postgresql");
  });

  it("selects postgresql when a DATABASE_URL_FILE mount is present", () => {
    expect(resolveDataBackend({ HASNA_CONSOLIDATIONS_DATABASE_URL_FILE: "/run/secrets/dsn" })).toBe(
      "postgresql",
    );
  });

  it("rejects legacy storage-mode variables with migration guidance", () => {
    expect(() =>
      resolveDataBackend({ HASNA_CONSOLIDATIONS_STORAGE_MODE: "cloud" }),
    ).toThrow(/was removed\. Delete the storage-mode variable/);
    expect(() =>
      resolveDataBackend({ HASNA_CONSOLIDATIONS_STORAGE_MODE: "local" }),
    ).toThrow(/was removed\. Delete the storage-mode variable/);
    expect(() =>
      resolveDataBackend({ CONSOLIDATIONS_STORAGE_MODE: "local" }),
    ).toThrow(/was removed\. Delete the storage-mode variable/);
  });

  it("databaseUrlPresent detects URL and FILE variants without reading values", () => {
    expect(databaseUrlPresent({})).toBe(false);
    expect(databaseUrlPresent({ HASNA_CONSOLIDATIONS_DATABASE_URL: "postgres://x/y" })).toBe(true);
    expect(databaseUrlPresent({ CONSOLIDATIONS_DATABASE_URL_FILE: "/run/secrets/dsn" })).toBe(true);
  });
});
