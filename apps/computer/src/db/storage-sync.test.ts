import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  allowStorageInsecureTls,
  assertStorageRemoteAllowed,
  getStorageDatabaseUrl,
  getStorageMode,
  hasStorageSyncConsent,
  inspectStorageTls,
  filterRowsForSync,
  resolveTables,
  STORAGE_TABLES,
} from "./storage-sync.js";

const envKeys = [
  "HASNA_COMPUTER_DATABASE_URL",
  "COMPUTER_DATABASE_URL",
  "HASNA_COMPUTER_STORAGE_MODE",
  "COMPUTER_STORAGE_MODE",
  "HASNA_COMPUTER_STORAGE_SYNC_CONSENT",
  "COMPUTER_STORAGE_SYNC_CONSENT",
  "HASNA_COMPUTER_STORAGE_ALLOW_INSECURE_TLS",
  "COMPUTER_STORAGE_ALLOW_INSECURE_TLS",
] as const;

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  savedEnv.clear();
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("computer storage sync config", () => {
  test("canonical storage database env wins over fallback env", () => {
    process.env.HASNA_COMPUTER_DATABASE_URL = "postgres://new.example/computer";
    process.env.COMPUTER_DATABASE_URL = "postgres://fallback.example/computer";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/computer");
    expect(getStorageMode()).toBe("hybrid");
  });

  test("fallback storage database env is accepted", () => {
    process.env.COMPUTER_DATABASE_URL = "postgres://fallback.example/computer";

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback.example/computer");
    expect(getStorageMode()).toBe("hybrid");
  });

  test("canonical storage mode wins over fallback mode", () => {
    process.env.HASNA_COMPUTER_STORAGE_MODE = "remote";
    process.env.COMPUTER_STORAGE_MODE = "hybrid";

    expect(getStorageMode()).toBe("remote");
  });

  test("resolves storage tables", () => {
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(resolveTables(["audit_events"])).toEqual(["audit_events"]);
    expect(resolveTables(["feedback"])).toEqual(["feedback"]);
    expect(() => resolveTables(["missing"])).toThrow("Unknown computer sync table");
  });

  test("does not sync active local runtime leases across machines", () => {
    const rows = [
      { id: "local-active", resource_id: "local:main", status: "active" },
      { id: "local-released", resource_id: "local:main", status: "released" },
      { id: "fleet-active", resource_id: "machine001", status: "active" },
    ];

    expect(filterRowsForSync("resource_leases", rows, "push").map((row) => row.id)).toEqual(["local-released", "fleet-active"]);
    expect(filterRowsForSync("resource_leases", rows, "pull").map((row) => row.id)).toEqual(["local-released", "fleet-active"]);
  });

  test("requires explicit consent before remote sync", () => {
    process.env.HASNA_COMPUTER_DATABASE_URL = "postgres://remote.example/computer?sslmode=require";

    expect(hasStorageSyncConsent()).toBe(false);
    expect(() => assertStorageRemoteAllowed()).toThrow("requires explicit consent");
  });

  test("allows remote sync after consent when TLS is required", () => {
    process.env.HASNA_COMPUTER_DATABASE_URL = "postgres://remote.example/computer?sslmode=require";
    process.env.HASNA_COMPUTER_STORAGE_SYNC_CONSENT = "1";

    expect(hasStorageSyncConsent()).toBe(true);
    expect(assertStorageRemoteAllowed()).toEqual({
      local: false,
      required: true,
      mode: "require",
      insecure: false,
    });
  });

  test("rejects non-local remote sync without TLS", () => {
    process.env.HASNA_COMPUTER_DATABASE_URL = "postgres://remote.example/computer";
    process.env.HASNA_COMPUTER_STORAGE_SYNC_CONSENT = "1";

    expect(() => assertStorageRemoteAllowed()).toThrow("requires TLS");
  });

  test("rejects non-local insecure TLS modes", () => {
    process.env.HASNA_COMPUTER_DATABASE_URL = "postgres://remote.example/computer?sslmode=disable";
    process.env.HASNA_COMPUTER_STORAGE_SYNC_CONSENT = "1";

    expect(() => assertStorageRemoteAllowed()).toThrow("must not use insecure TLS");
  });

  test("allows local development database URLs without TLS after consent", () => {
    process.env.HASNA_COMPUTER_DATABASE_URL = "postgres://localhost/computer";
    process.env.HASNA_COMPUTER_STORAGE_SYNC_CONSENT = "1";

    expect(assertStorageRemoteAllowed()).toEqual({
      local: true,
      required: false,
      mode: null,
      insecure: false,
    });
  });

  test("detects explicit insecure TLS override for local development", () => {
    process.env.HASNA_COMPUTER_STORAGE_ALLOW_INSECURE_TLS = "true";

    expect(allowStorageInsecureTls()).toBe(true);
    expect(inspectStorageTls("postgres://localhost/computer?sslmode=require")).toEqual({
      local: true,
      required: true,
      mode: "require",
      insecure: false,
    });
  });
});
