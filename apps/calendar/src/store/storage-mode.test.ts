import { describe, expect, test } from "bun:test";
import {
  CANONICAL_STORAGE_MODES,
  UnknownStorageModeError,
  isRemoteMode,
  parseStorageMode,
  resolveConfiguredStorageMode,
} from "./storage-mode.js";
import { resolveClientTransport, resolveStorageClient } from "./http-storage.js";
import { isCloudModeEnabled, resolveServiceMode } from "../server/cloud.js";

/**
 * REGRESSION FENCE for defect 2: `HASNA_CALENDAR_STORAGE_MODE=remote` (the value
 * the live calendar-prod task definition carried) was NOT recognised by
 * `normalizeMode`, so the client resolver warned and silently fell back to the
 * on-box SQLite LocalStore — while `/v1` kept using RDS via `getCloudStore`.
 * Two planes, two different stores, in one production process.
 *
 * These tests fail against main: there, `resolveClientTransport` returns
 * `{ transport: "local" }` with a warning instead of throwing.
 */
describe("storage-mode vocabulary", () => {
  test("the canonical modes are exactly local | self_hosted | cloud", () => {
    expect([...CANONICAL_STORAGE_MODES]).toEqual(["local", "self_hosted", "cloud"]);
  });

  test.each(["local", "self_hosted", "cloud", "SELF_HOSTED", " self-hosted "])(
    "accepts canonical mode %p",
    (raw) => {
      expect(() => parseStorageMode(raw, "TEST_MODE")).not.toThrow();
    },
  );

  test("self_hosted and cloud are remote; local is not", () => {
    expect(isRemoteMode("self_hosted")).toBe(true);
    expect(isRemoteMode("cloud")).toBe(true);
    expect(isRemoteMode("local")).toBe(false);
  });

  test("'remote' is REJECTED, not aliased, and the error names the replacement", () => {
    let thrown: unknown;
    try {
      parseStorageMode("remote", "HASNA_CALENDAR_STORAGE_MODE");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnknownStorageModeError);
    const err = thrown as UnknownStorageModeError;
    expect(err.code).toBe("UNKNOWN_STORAGE_MODE");
    expect(err.value).toBe("remote");
    expect(err.message).toContain("HASNA_CALENDAR_STORAGE_MODE");
    expect(err.message).toContain("self_hosted");
    expect(err.message).toContain("local | self_hosted | cloud");
  });

  test.each(["banana", "", "  ", "remote-ish", "self hosted", "LOCALHOST"])(
    "rejects unrecognised mode %p",
    (raw) => {
      expect(() => parseStorageMode(raw, "HASNA_CALENDAR_STORAGE_MODE")).toThrow(UnknownStorageModeError);
    },
  );

  test("resolveConfiguredStorageMode returns null when nothing is set", () => {
    expect(resolveConfiguredStorageMode("calendar", {})).toBeNull();
  });

  test("resolveConfiguredStorageMode throws on the live misconfiguration", () => {
    expect(() =>
      resolveConfiguredStorageMode("calendar", { HASNA_CALENDAR_STORAGE_MODE: "remote" }),
    ).toThrow(UnknownStorageModeError);
  });
});

describe("client transport no longer degrades on an unknown mode", () => {
  test("resolveClientTransport THROWS instead of silently using the local store", () => {
    expect(() =>
      resolveClientTransport("calendar", {
        HASNA_CALENDAR_STORAGE_MODE: "remote",
        HASNA_CALENDAR_API_URL: "https://calendar.hasna.xyz",
        HASNA_CALENDAR_API_KEY: "test-key-not-a-real-credential",
      }),
    ).toThrow(UnknownStorageModeError);
  });

  test("resolveStorageClient THROWS too (this is the getStore() path)", () => {
    expect(() =>
      resolveStorageClient("calendar", { HASNA_CALENDAR_STORAGE_MODE: "remote" }),
    ).toThrow(UnknownStorageModeError);
  });

  test("canonical self_hosted + key still resolves to the cloud HTTP transport", () => {
    const r = resolveClientTransport("calendar", {
      HASNA_CALENDAR_STORAGE_MODE: "self_hosted",
      HASNA_CALENDAR_API_URL: "https://calendar.hasna.xyz",
      HASNA_CALENDAR_API_KEY: "test-key-not-a-real-credential",
    });
    expect(r.transport).toBe("cloud-http");
    expect(r.baseUrl).toBe("https://calendar.hasna.xyz/v1");
    expect(r.warning).toBeNull();
  });

  test("explicit local stays local", () => {
    const r = resolveClientTransport("calendar", { HASNA_CALENDAR_STORAGE_MODE: "local" });
    expect(r.transport).toBe("local");
    expect(r.warning).toBeNull();
  });
});

describe("server-side hosted detection uses the same vocabulary", () => {
  test("'remote' no longer silently enables hosted mode — it throws", () => {
    expect(() => isCloudModeEnabled({ HASNA_CALENDAR_STORAGE_MODE: "remote" })).toThrow(
      UnknownStorageModeError,
    );
  });

  test("self_hosted and cloud enable the hosted plane", () => {
    expect(isCloudModeEnabled({ HASNA_CALENDAR_STORAGE_MODE: "self_hosted" })).toBe(true);
    expect(isCloudModeEnabled({ HASNA_CALENDAR_STORAGE_MODE: "cloud" })).toBe(true);
    expect(isCloudModeEnabled({ HASNA_CALENDAR_STORAGE_MODE: "local" })).toBe(false);
    expect(isCloudModeEnabled({})).toBe(false);
  });

  test("a DSN alone is hosted and reports the canonical self_hosted label", () => {
    const env = { HASNA_CALENDAR_DATABASE_URL: "postgres://user@host:5432/db" };
    expect(isCloudModeEnabled(env)).toBe(true);
    expect(resolveServiceMode(env)).toBe("self_hosted");
    expect(resolveServiceMode({})).toBe("local");
  });

  test("the service mode label is never the retired 'remote' string", () => {
    for (const env of [
      {},
      { HASNA_CALENDAR_STORAGE_MODE: "local" },
      { HASNA_CALENDAR_STORAGE_MODE: "self_hosted" },
      { HASNA_CALENDAR_STORAGE_MODE: "cloud" },
      { HASNA_CALENDAR_DATABASE_URL: "postgres://user@host:5432/db" },
    ]) {
      expect(resolveServiceMode(env)).not.toBe("remote");
      expect(CANONICAL_STORAGE_MODES).toContain(resolveServiceMode(env));
    }
  });
});
