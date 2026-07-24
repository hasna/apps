import { describe, expect, test } from "bun:test";
import { handleV1Request } from "./v1.js";
import {
  closeCloud,
  getCloudStorageAdapter,
  getCloudVerifier,
  isCloudModeEnabled,
  resolveCloudDatabaseUrl,
  resolveSigningSecret,
} from "./cloud.js";

describe("Todos Stage-A /v1 ordering", () => {
  test("constant hosted denial runs before revocation-backed verifier and datastore setup", async () => {
    const calls = { verifier: 0, schema: 0, storage: 0 };
    const url = new URL("https://todos.example.test/v1/tasks");
    const response = await handleV1Request(new Request(url), url, {
      environment: { HASNA_TODOS_STORAGE_MODE: "remote" },
      getVerifier: () => {
        calls.verifier += 1;
        throw new Error("revocation datastore must remain unreachable");
      },
      ensureSchema: async () => {
        calls.schema += 1;
      },
      getStorageAdapter: () => {
        calls.storage += 1;
        throw new Error("hosted storage must remain unreachable");
      },
    });

    expect(response?.status).toBe(503);
    expect(calls).toEqual({ verifier: 0, schema: 0, storage: 0 });
  });

  test("the cloud verifier retains its revocation callback", async () => {
    const source = await Bun.file(new URL("./cloud.ts", import.meta.url)).text();
    expect(source).toContain("isRevoked: store.isRevoked");
    expect(source).not.toContain("createStatelessCloudVerifier");
  });

  test("cold and warm cloud aliases fail before SQL, credentials, or cached adapters", async () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    const originalSql = Object.getOwnPropertyDescriptor(Bun, "SQL");
    let sqlCalls = 0;
    class ForbiddenSql {
      constructor() {
        sqlCalls += 1;
        throw new Error("FAKE_ONLY_CLOUD_SQL_MARKER");
      }
    }
    try {
      process.env.HASNA_TODOS_STORAGE_MODE = "local";
      process.env.TODOS_STORAGE_MODE = "local";
      (Bun as unknown as { SQL: unknown }).SQL = ForbiddenSql;

      for (const operation of [
        getCloudStorageAdapter,
        getCloudStorageAdapter,
        getCloudVerifier,
        getCloudVerifier,
        resolveCloudDatabaseUrl,
        resolveSigningSecret,
        isCloudModeEnabled,
      ]) {
        expect(operation).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      }
      await expect(closeCloud()).rejects.toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(sqlCalls).toBe(0);

      process.env.HASNA_TODOS_STORAGE_MODE = "remote";
      process.env.TODOS_STORAGE_MODE = "remote";
      expect(getCloudStorageAdapter).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(getCloudVerifier).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(sqlCalls).toBe(0);
    } finally {
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
      if (originalSql) (Bun as unknown as { SQL: unknown }).SQL = originalSql.value;
    }
  });

  test("direct cloud env aliases floor before hostile credential/config reads", () => {
    process.env.HASNA_TODOS_STORAGE_MODE = "local";
    process.env.TODOS_STORAGE_MODE = "local";
    let environmentReads = 0;
    const hostileEnvironment = new Proxy({}, {
      get() {
        environmentReads += 1;
        throw new Error("FAKE_ONLY_CLOUD_CREDENTIAL_ENV_MARKER");
      },
    }) as NodeJS.ProcessEnv;

    expect(() => resolveCloudDatabaseUrl(hostileEnvironment)).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
    expect(() => resolveSigningSecret(hostileEnvironment)).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
    expect(() => isCloudModeEnabled(hostileEnvironment)).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
    expect(environmentReads).toBe(0);
  });
});
