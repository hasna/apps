import { afterEach, describe, expect, test } from "bun:test";
import {
  CANONICAL_SHORTLINKS_RDS_CLUSTER,
  CANONICAL_SHORTLINKS_RDS_DATABASE,
  CANONICAL_SHORTLINKS_RDS_SECRET_PATH,
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  SHORTLINKS_STORAGE_ENV,
  SHORTLINKS_STORAGE_FALLBACK_ENV,
  getCanonicalShortlinksRdsConfig,
  getStorageDatabaseEnvName,
  getStorageConfig,
  getStorageDatabaseUrl,
} from "./storage-config.js";
import { STORAGE_TABLES, parseStorageTables } from "./storage-sync.js";

const ENV_NAMES = [
  ...STORAGE_DATABASE_ENV,
  ...STORAGE_MODE_ENV,
] as const;

afterEach(() => {
  for (const name of ENV_NAMES) {
    delete process.env[name];
  }
});

describe("shortlinks storage configuration", () => {
  test("prefers canonical storage database envs over fallback envs", () => {
    process.env["HASNA_SHORTLINKS_DATABASE_URL"] = "postgres://new.example/shortlinks";
    process.env["SHORTLINKS_DATABASE_URL"] = "postgres://fallback.example/shortlinks";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/shortlinks");
    expect(getStorageDatabaseEnvName()).toBe("HASNA_SHORTLINKS_DATABASE_URL");
  });

  test("uses service storage database env as fallback", () => {
    process.env["SHORTLINKS_DATABASE_URL"] = "postgres://fallback.example/shortlinks";

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback.example/shortlinks");
    expect(getStorageDatabaseEnvName()).toBe("SHORTLINKS_DATABASE_URL");
  });

  test("uses storage mode envs", () => {
    process.env["HASNA_SHORTLINKS_STORAGE_MODE"] = "remote";

    expect(getStorageConfig().mode).toBe("remote");
  });

  test("exposes canonical RDS metadata without secrets", () => {
    expect(getCanonicalShortlinksRdsConfig()).toEqual({
      cluster: CANONICAL_SHORTLINKS_RDS_CLUSTER,
      database: CANONICAL_SHORTLINKS_RDS_DATABASE,
      runtimeSecretPath: CANONICAL_SHORTLINKS_RDS_SECRET_PATH,
      primaryEnv: SHORTLINKS_STORAGE_ENV,
      fallbackEnv: SHORTLINKS_STORAGE_FALLBACK_ENV,
    });
  });

  test("returns all storage tables by default", () => {
    expect(parseStorageTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables("domains,links")).toEqual(["domains", "links"]);
    expect(() => parseStorageTables("missing")).toThrow("Unknown shortlinks storage table");
  });
});
