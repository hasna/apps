// Server data-backend regression tests (deployment-mode removal, todos
// 7abbf333). The server storage switch is `sqlite | postgresql`, selected by
// HASNA_MACHINES_DATABASE_URL presence — never by a storage-mode variable.

import { describe, expect, test } from "bun:test";
import {
  assertNoLegacyStorageMode as kitAssertNoLegacyStorageMode,
  resolveServerDataBackend,
} from "../generated/storage-kit/backend.js";
import { assertNoLegacyStorageMode } from "../lib/retired-storage-mode.js";

describe("resolveServerDataBackend (machines)", () => {
  test("absent DATABASE_URL resolves sqlite", () => {
    const r = resolveServerDataBackend("machines", {});
    expect(r.backend).toBe("sqlite");
    expect(r.databaseUrlPresent).toBe(false);
    expect(r.databaseUrlSource).toBeNull();
  });

  test("present HASNA_MACHINES_DATABASE_URL resolves postgresql", () => {
    const r = resolveServerDataBackend("machines", { HASNA_MACHINES_DATABASE_URL: "postgres://x" });
    expect(r.backend).toBe("postgresql");
    expect(r.databaseUrlPresent).toBe(true);
    expect(r.databaseUrlSource).toBe("HASNA_MACHINES_DATABASE_URL");
  });

  test("present MACHINES_DATABASE_URL alias resolves postgresql", () => {
    const r = resolveServerDataBackend("machines", { MACHINES_DATABASE_URL: "postgres://x" });
    expect(r.backend).toBe("postgresql");
    expect(r.databaseUrlSource).toBe("MACHINES_DATABASE_URL");
  });

  test("a set storage-mode variable throws naming the variable (server path)", () => {
    const legacyKeys = [
      "HASNA_MACHINES_STORAGE_MODE",
      "HASNA_MACHINES_MODE",
      "MACHINES_STORAGE_MODE",
      "MACHINES_MODE",
    ];
    for (const key of legacyKeys) {
      // The kit's own assert fires inside resolveServerDataBackend and names
      // the variable, whatever its value — including the retired deployment
      // words and the values that used to be silently remapped.
      for (const value of ["cloud", "local", "self_hosted", "remote", "hybrid"]) {
        expect(() => resolveServerDataBackend("machines", { [key]: value })).toThrow(
          new RegExp(`${key} was removed`),
        );
      }
    }
  });
});

describe("assertNoLegacyStorageMode (machines lib ratchet)", () => {
  test("a set storage-mode variable throws naming the variable (client paths)", () => {
    const cases: Array<[string, string]> = [
      ["HASNA_MACHINES_STORAGE_MODE", "cloud"],
      ["HASNA_MACHINES_STORAGE_MODE", "local"],
      ["HASNA_MACHINES_MODE", "cloud"],
      ["MACHINES_STORAGE_MODE", "cloud"],
      ["MACHINES_MODE", "cloud"],
    ];
    for (const [key, value] of cases) {
      expect(() => assertNoLegacyStorageMode({ [key]: value } as NodeJS.ProcessEnv)).toThrow(
        new RegExp(key),
      );
    }
  });

  test("no-op when no legacy storage-mode variable is set", () => {
    expect(() => assertNoLegacyStorageMode({} as NodeJS.ProcessEnv)).not.toThrow();
    expect(() =>
      assertNoLegacyStorageMode({ HASNA_MACHINES_API_URL: "https://x", HASNA_MACHINES_DATABASE_URL: "postgres://x" } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  test("kit assert agrees with the lib ratchet on the same keys", () => {
    for (const key of ["HASNA_MACHINES_STORAGE_MODE", "HASNA_MACHINES_MODE", "MACHINES_STORAGE_MODE", "MACHINES_MODE"]) {
      expect(() => kitAssertNoLegacyStorageMode("machines", { [key]: "cloud" })).toThrow(
        new RegExp(`${key} was removed`),
      );
    }
  });
});
