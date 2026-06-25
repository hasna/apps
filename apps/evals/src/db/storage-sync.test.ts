import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  parseStorageTables,
} from "./storage-sync";

const ENV_NAMES = [
  "HASNA_EVALS_DATABASE_URL",
  "EVALS_DATABASE_URL",
  "HASNA_EVALS_STORAGE_MODE",
  "EVALS_STORAGE_MODE",
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

describe("evals storage sync configuration", () => {
  beforeEach(() => {
    for (const name of ENV_NAMES) delete process.env[name];
  });

  afterEach(() => {
    for (const name of ENV_NAMES) {
      const value = ORIGINAL_ENV.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("prefers canonical storage database env over fallback env", () => {
    process.env["EVALS_DATABASE_URL"] = "postgres://fallback";
    process.env["HASNA_EVALS_DATABASE_URL"] = "postgres://canonical";

    expect(getStorageDatabaseUrl()).toBe("postgres://canonical");
    expect(getStorageDatabaseEnv()).toEqual({
      name: "HASNA_EVALS_DATABASE_URL",
    });
  });

  test("accepts fallback storage database env", () => {
    process.env["EVALS_DATABASE_URL"] = "postgres://fallback";

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback");
    expect(getStorageDatabaseEnv()).toEqual({
      name: "EVALS_DATABASE_URL",
    });
  });

  test("uses storage mode envs", () => {
    expect(getStorageMode()).toBe("local");

    process.env["EVALS_DATABASE_URL"] = "postgres://remote";
    expect(getStorageMode()).toBe("hybrid");

    process.env["HASNA_EVALS_STORAGE_MODE"] = "remote";
    expect(getStorageMode()).toBe("remote");
  });

  test("parses and validates storage table filters", () => {
    expect(parseStorageTables()).toEqual(["runs", "baselines"]);
    expect(parseStorageTables([" runs ", "baselines"])).toEqual(["runs", "baselines"]);
    expect(() => parseStorageTables(["missing"])).toThrow("Unknown evals sync table");
  });
});
