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
    const LEGACY_KEYS = [
      "HASNA_CONSOLIDATIONS_STORAGE_MODE",
      "HASNA_CONSOLIDATIONS_MODE",
      "CONSOLIDATIONS_STORAGE_MODE",
      "CONSOLIDATIONS_MODE",
    ] as const;
    for (const key of LEGACY_KEYS) {
      // A set variable is a stale configuration even when its value is blank.
      for (const value of ["cloud", "local", ""]) {
        expect(() => resolveDataBackend({ [key]: value })).toThrow(
          /was removed\. Delete the storage-mode variable/,
        );
      }
    }
  });

  it("databaseUrlPresent detects URL and FILE variants without reading values", () => {
    expect(databaseUrlPresent({})).toBe(false);
    expect(databaseUrlPresent({ HASNA_CONSOLIDATIONS_DATABASE_URL: "postgres://x/y" })).toBe(true);
    expect(databaseUrlPresent({ CONSOLIDATIONS_DATABASE_URL_FILE: "/run/secrets/dsn" })).toBe(true);
  });
});
