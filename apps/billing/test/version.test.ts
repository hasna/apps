import { describe, expect, it } from "bun:test";
import { APP_VERSION } from "../src/version.js";
import { health } from "../src/server/health.js";
import packageJson from "../package.json";

describe("version + health", () => {
  it("APP_VERSION matches package.json", () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });

  it("health returns the { status, version, mode } contract shape", () => {
    const prev = process.env["HASNA_BILLING_STORAGE_MODE"];
    delete process.env["HASNA_BILLING_STORAGE_MODE"];
    try {
      const h = health();
      expect(h).toEqual({ status: "ok", version: APP_VERSION, mode: "local" });
    } finally {
      if (prev !== undefined) process.env["HASNA_BILLING_STORAGE_MODE"] = prev;
    }
  });
});
