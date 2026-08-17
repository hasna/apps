import { describe, expect, it } from "bun:test";
import { resolveStorageMode } from "../src/config.js";
import { assertCloudTlsPolicy } from "../src/db/cloud.js";

describe("storage mode resolution", () => {
  it("defaults to local", () => {
    expect(resolveStorageMode({})).toBe("local");
  });

  it("resolves postgres backend when a DATABASE_URL is present", () => {
    expect(resolveStorageMode({ HASNA_ACCESS_DATABASE_URL: "postgres://x" })).toBe("cloud");
    expect(resolveStorageMode({ ACCESS_DATABASE_URL: "postgres://x" })).toBe("cloud");
  });

  it("ignores the retired HASNA_ACCESS_STORAGE_MODE variable", () => {
    expect(resolveStorageMode({ HASNA_ACCESS_STORAGE_MODE: "cloud" })).toBe("local");
    expect(resolveStorageMode({ HASNA_ACCESS_STORAGE_MODE: "cloud", ACCESS_STORAGE_MODE: "remote" })).toBe("local");
  });
});

describe("cloud TLS policy", () => {
  it("accepts sslmode=verify-full", () => {
    const policy = assertCloudTlsPolicy("postgres://u:p@h:5432/db?sslmode=verify-full");
    expect(policy.sslmode).toBe("verify-full");
    expect(policy.requiresCaBundle).toBe(true);
  });

  it("rejects sslmode=require (no cert verification)", () => {
    expect(() => assertCloudTlsPolicy("postgres://u:p@h:5432/db?sslmode=require")).toThrow(/verify-full/);
  });

  it("rejects a DSN with no sslmode", () => {
    expect(() => assertCloudTlsPolicy("postgres://u:p@h:5432/db")).toThrow(/verify-full/);
  });
});
