import { describe, expect, it } from "bun:test";
import { resolveStorageMode } from "../src/config.js";

describe("storage mode resolution", () => {
  it("defaults to local", () => {
    expect(resolveStorageMode({})).toBe("local");
  });

  it("normalizes deprecated aliases to cloud", () => {
    expect(resolveStorageMode({ HASNA_CONSOLIDATIONS_STORAGE_MODE: "self_hosted" })).toBe("cloud");
    expect(resolveStorageMode({ HASNA_CONSOLIDATIONS_STORAGE_MODE: "remote" })).toBe("cloud");
    expect(resolveStorageMode({ HASNA_CONSOLIDATIONS_STORAGE_MODE: "cloud" })).toBe("cloud");
  });

  it("honors the alias env key", () => {
    expect(resolveStorageMode({ CONSOLIDATIONS_STORAGE_MODE: "cloud" })).toBe("cloud");
  });

  it("rejects unknown modes", () => {
    expect(() => resolveStorageMode({ HASNA_CONSOLIDATIONS_STORAGE_MODE: "hybrid-cache" })).toThrow();
  });

  it("fails closed when a DSN is present but mode resolves to local (mis-deploy guard)", () => {
    expect(() =>
      resolveStorageMode({ HASNA_CONSOLIDATIONS_DATABASE_URL: "postgres://x/y" }),
    ).toThrow(/present but storage mode is 'local'/);
    expect(() =>
      resolveStorageMode({
        HASNA_CONSOLIDATIONS_STORAGE_MODE: "local",
        HASNA_CONSOLIDATIONS_DATABASE_URL: "postgres://x/y",
      }),
    ).toThrow(/present but storage mode is 'local'/);
  });
});
