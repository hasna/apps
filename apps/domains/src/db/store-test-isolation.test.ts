import { describe, expect, test } from "bun:test";
import { getStore, getStoreResolution, isCloudStore } from "./store.js";

describe("runner context never enables client SQLite", () => {
  for (const NODE_ENV of ["test", "production", undefined]) {
    test(`path refusal in ${NODE_ENV ?? "unset"} context`, () => {
      const env = { NODE_ENV, DOMAINS_DIR: "/tmp/unit-only-fixture" };
      expect(() => getStore(env)).toThrow(/no longer supported/);
      expect(() => getStoreResolution(env)).toThrow(/no longer supported/);
      expect(() => isCloudStore(env)).toThrow(/no longer supported/);
    });
    test(`API resolution in ${NODE_ENV ?? "unset"} context`, () => {
      const env = { NODE_ENV, HASNA_DOMAINS_API_URL: "https://fixture.invalid", HASNA_DOMAINS_API_KEY: "synthetic-fixture" };
      expect(getStoreResolution(env).transport).toBe("http");
      expect(isCloudStore(env)).toBe(true);
      expect(() => getStore({ NODE_ENV })).toThrow(/fails closed/);
    });
  }
});
