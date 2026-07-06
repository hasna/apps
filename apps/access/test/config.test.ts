import { describe, expect, it } from "bun:test";
import { resolveStorageMode } from "../src/config.js";
import { assertCloudTlsPolicy } from "../src/db/cloud.js";

describe("storage mode resolution", () => {
  it("defaults to local", () => {
    expect(resolveStorageMode({})).toBe("local");
  });

  it("resolves cloud and deprecated aliases", () => {
    expect(resolveStorageMode({ HASNA_ACCESS_STORAGE_MODE: "cloud" })).toBe("cloud");
    expect(resolveStorageMode({ HASNA_ACCESS_STORAGE_MODE: "self_hosted", HASNA_ACCESS_DATABASE_URL: "x" })).toBe("cloud");
    expect(resolveStorageMode({ ACCESS_STORAGE_MODE: "remote", ACCESS_DATABASE_URL: "x" })).toBe("cloud");
  });

  it("throws on an unknown mode", () => {
    expect(() => resolveStorageMode({ HASNA_ACCESS_STORAGE_MODE: "hybrid-cache" })).toThrow(/Unknown storage mode/);
  });

  it("fails closed when a DSN is present but mode resolves to local", () => {
    expect(() => resolveStorageMode({ HASNA_ACCESS_DATABASE_URL: "postgres://x" })).toThrow(/resolved to 'local'/);
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
