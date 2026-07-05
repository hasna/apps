import { afterEach, describe, expect, it } from "bun:test";
import {
  CANONICAL_SECRETS_RDS_CLUSTER,
  CANONICAL_SECRETS_RDS_DATABASE,
  CANONICAL_SECRETS_RDS_SECRET_PATH,
  SECRETS_STORAGE_FALLBACK_ENV,
  SECRETS_STORAGE_ENV,
  SECRETS_STORAGE_TABLES,
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  STORAGE_TABLES,
  getCanonicalSecretsRdsConfig,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  resolveTables,
} from "./storage-sync.js";

const ENV_NAMES = [
  ...STORAGE_DATABASE_ENV,
  ...STORAGE_MODE_ENV,
] as const;

afterEach(() => {
  for (const name of ENV_NAMES) {
    delete process.env[name];
  }
});

describe("secrets storage configuration", () => {
  it("prefers canonical storage database envs over the short fallback", () => {
    process.env["HASNA_SECRETS_DATABASE_URL"] = "postgres://new.example/secrets";
    process.env["SECRETS_DATABASE_URL"] = "postgres://fallback.example/secrets";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/secrets");
    expect(getStorageDatabaseEnvName()).toBe("HASNA_SECRETS_DATABASE_URL");
  });

  it("keeps the short storage database env as a non-deprecated fallback", () => {
    process.env["SECRETS_DATABASE_URL"] = "postgres://fallback.example/secrets";

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback.example/secrets");
    expect(getStorageDatabaseEnvName()).toBe("SECRETS_DATABASE_URL");
  });

  it("uses storage mode overrides", () => {
    process.env["SECRETS_DATABASE_URL"] = "postgres://fallback.example/secrets";
    expect(getStorageMode()).toBe("hybrid");

    process.env["HASNA_SECRETS_STORAGE_MODE"] = "remote";
    expect(getStorageMode()).toBe("remote");
  });

  it("publishes stable storage tables, fallback env, and redacted status", () => {
    process.env["SECRETS_DATABASE_URL"] = "postgres://user:secret@example.test/secrets?sslmode=query-secret&password=query-secret";

    const status = getStorageStatus();

    expect(SECRETS_STORAGE_TABLES).toEqual(STORAGE_TABLES);
    expect(SECRETS_STORAGE_FALLBACK_ENV.databaseUrl).toBe("SECRETS_DATABASE_URL");
    expect(status.service).toBe("secrets");
    expect(status.tables).toEqual(STORAGE_TABLES);
    expect(status.env.databaseUrl.name).toBe("HASNA_SECRETS_DATABASE_URL");
    expect(status.env.databaseUrl.active_name).toBe("SECRETS_DATABASE_URL");
    expect(status.database.redacted_url).toBe("postgres://user:***@example.test/secrets?sslmode=***");
    expect(JSON.stringify(status)).not.toContain("query-secret");
    expect(status.canonical).toEqual(getCanonicalSecretsRdsConfig());
  });

  it("exposes canonical RDS metadata without secrets", () => {
    expect(getCanonicalSecretsRdsConfig()).toEqual({
      cluster: CANONICAL_SECRETS_RDS_CLUSTER,
      database: CANONICAL_SECRETS_RDS_DATABASE,
      runtimeSecretPath: CANONICAL_SECRETS_RDS_SECRET_PATH,
      primaryEnv: SECRETS_STORAGE_ENV.databaseUrl,
      fallbackEnv: SECRETS_STORAGE_FALLBACK_ENV.databaseUrl,
    });
  });

  it("returns all tables by default and rejects unknown tables", () => {
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(() => resolveTables(["secrets", "missing"])).toThrow("Unknown secrets sync table");
  });

  it("exports storage helpers from the storage subpath source", async () => {
    const storage = await import("./storage.js");

    expect(storage.STORAGE_TABLES).toEqual(STORAGE_TABLES);
    expect(storage.getStorageDatabaseUrl()).toBeNull();
    expect(storage.getStorageMode()).toBe("local");
    expect(storage.PG_MIGRATIONS.length).toBeGreaterThan(0);
    expect(typeof storage.PgAdapterAsync).toBe("function");
    expect(typeof storage.createAwsSecretsManagerReference).toBe("function");
    expect(storage.getCloudRuntimeReferenceStatus().remote.s3.runtimeObjectStore).toBe(false);
  });
});
