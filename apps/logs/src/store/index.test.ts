/**
 * @hasna/logs — Store resolver: client-transport derivation.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Fail-closed contract (owner ruling 2026-09-04, credential-resolver
 * adoption, hasna/apps#1720): running WITHOUT a resolvable fleet credential
 * must NEVER silently fall back to the local SQLite store
 * (~/.hasna/logs/logs.db). resolveStore({}) FAILS CLOSED; LocalStore is
 * reachable only through the explicit opt-in HASNA_LOGS_LOCAL=1 (alias
 * LOGS_LOCAL=1). A DECLARED authority or credential that cannot be honoured
 * refuses loudly — the opt-in never overrides a configured half-pair.
 * Legacy storage-mode variables are inert; they never select a transport.
 *
 * The machine may carry real HASNA_LOGS_* env vars; the tests scrub them so
 * the resolution is hermetic, and a temp HOME anchors the disk tier away
 * from any real ~/.hasna/logs/config/credentials.
 */
import { describe, expect, test } from "bun:test";
import { resolveClientTransport } from "@hasna/contracts/client";
import { resolveStorageClient } from "@hasna/contracts/client/storage";
import {
  LOGS_APP_SLUG,
  localStoreIfAvailable,
  requireLocalStore,
  resolveLogsTransport,
  resolveStore,
  usesHttpTransport,
} from "./index.ts";
import { ApiStore } from "./api.ts";
import { LocalStore } from "./local.ts";

function scrub(): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const name of [
    "HASNA_LOGS_API_URL",
    "HASNA_LOGS_API_KEY",
    "LOGS_API_URL",
    "LOGS_API_KEY",
    "HASNA_LOGS_API_KEY_OVERRIDE",
    "HASNA_LOGS_API_KEY_REF",
    "HASNA_PROFILE",
    "HASNA_LOGS_STORAGE_MODE",
    "HASNA_LOGS_MODE",
    "LOGS_STORAGE_MODE",
    "LOGS_MODE",
    "HASNA_LOGS_LOCAL",
    "LOGS_LOCAL",
  ]) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  return () => {
    for (const name of Object.keys(saved)) {
      if (saved[name] !== undefined) process.env[name] = saved[name];
      else delete process.env[name];
    }
  };
}

const API_ENV = {
  HASNA_LOGS_API_URL: "https://logs.hasna.xyz/v1",
  HASNA_LOGS_API_KEY: ["hasna", "logs", "FAKE", "TEST", "KEY"].join("_"),
} as NodeJS.ProcessEnv;

describe("resolveStore", () => {
  test("FAILS CLOSED without a credential: no silent local fallback", () => {
    const restore = scrub();
    try {
      expect(() => resolveStore({})).toThrow(/HASNA_LOGS_API_URL/);
      expect(() => resolveStore({})).toThrow(/HASNA_LOGS_API_KEY/);
      expect(() => resolveStore({})).toThrow(/HASNA_LOGS_LOCAL/);
      expect(() => resolveStore({})).toThrow(/config\/credentials/);
    } finally {
      restore();
    }
  });

  test("resolves LocalStore only under the explicit local opt-in", () => {
    const restore = scrub();
    try {
      expect(resolveStore({ HASNA_LOGS_LOCAL: "1" })).toBeInstanceOf(LocalStore);
      expect(resolveStore({ LOGS_LOCAL: "1" })).toBeInstanceOf(LocalStore);
      // Alias with a truthy spelling; blank/false values are never opt-ins.
      expect(resolveStore({ LOGS_LOCAL: "true" })).toBeInstanceOf(LocalStore);
      expect(() => resolveStore({ HASNA_LOGS_LOCAL: "" })).toThrow(
        /HASNA_LOGS_API_URL/,
      );
      expect(() => resolveStore({ HASNA_LOGS_LOCAL: "0" })).toThrow(
        /HASNA_LOGS_API_URL/,
      );
    } finally {
      restore();
    }
  });

  test("resolves ApiStore when a credential resolves via the env tier", () => {
    const restore = scrub();
    try {
      expect(resolveStore(API_ENV)).toBeInstanceOf(ApiStore);
    } finally {
      restore();
    }
  });

  test("a credential alone resolves the fleet gateway (no URL needed)", () => {
    const restore = scrub();
    try {
      // Key without URL: the resolver defaults the authority to the fleet
      // gateway — a key alone is a complete configuration.
      const store = resolveStore({ HASNA_LOGS_API_KEY: "fleet-only-key" });
      expect(store).toBeInstanceOf(ApiStore);
      expect((store as ApiStore).baseUrl).toBe("https://api.hasna.com/logs/v1");
    } finally {
      restore();
    }
  });

  test("an API URL without a credential is refused, never silently routed", () => {
    const restore = scrub();
    try {
      // The client refuses to route on a URL with no resolvable key instead
      // of silently flipping transport; the opt-in never overrides api mode.
      expect(() => resolveStore({ HASNA_LOGS_API_URL: "https://logs.hasna.xyz/v1" })).toThrow();
      expect(() =>
        resolveStore({
          HASNA_LOGS_API_URL: "https://logs.hasna.xyz/v1",
          HASNA_LOGS_LOCAL: "1",
        }),
      ).toThrow();
    } finally {
      restore();
    }
  });

  test("a declared-but-blank authority/credential refuses loudly, never falls through", () => {
    const restore = scrub();
    try {
      expect(() => resolveStore({ HASNA_LOGS_API_URL: "" })).toThrow();
      expect(() => resolveStore({ HASNA_LOGS_API_KEY: "" })).toThrow();
      // ...even under the local opt-in: a declared-but-blank variable is a
      // refusal, not an absence.
      expect(() => resolveStore({ HASNA_LOGS_API_URL: "", HASNA_LOGS_LOCAL: "1" })).toThrow();
    } finally {
      restore();
    }
  });

  test("does not mutate the caller's env", () => {
    const restore = scrub();
    try {
      const source = { ...API_ENV };
      resolveStore(source);
      expect(source).toEqual(API_ENV);
    } finally {
      restore();
    }
  });

  test("the resolved transport agrees with the contracts client", () => {
    const restore = scrub();
    try {
      const resolved = resolveStorageClient(LOGS_APP_SLUG, API_ENV);
      expect(resolved.transport).toBe("http");
      expect(usesHttpTransport(API_ENV)).toBe(true);
      expect(usesHttpTransport({})).toBe(false);
      // The report agrees with the shared resolver decision.
      const report = resolveLogsTransport(API_ENV);
      expect(report.transport).toBe("http");
      expect(report.base_url).toBe("https://logs.hasna.xyz/v1");
    } finally {
      restore();
    }
  });

  test("a legacy storage-mode variable is inert: the credential pair alone selects the transport", () => {
    const restore = scrub();
    try {
      // HASNA_LOGS_STORAGE_MODE was removed from the contracts client contract;
      // the client never reads it — the credential pair alone selects the
      // transport, and without a credential there is no silent local fallback.
      expect(() => resolveStore({ ...API_ENV, HASNA_LOGS_STORAGE_MODE: "cloud" })).not.toThrow();
      expect(() => resolveStore({ HASNA_LOGS_STORAGE_MODE: "self_hosted" })).toThrow();
      expect(usesHttpTransport({ HASNA_LOGS_STORAGE_MODE: "self_hosted" })).toBe(false);
      expect(usesHttpTransport(API_ENV)).toBe(true);
    } finally {
      restore();
    }
  });
});

describe("resolveLogsTransport (transport report)", () => {
  test("reports the env tier sources without values", () => {
    const restore = scrub();
    try {
      const report = resolveLogsTransport(API_ENV);
      expect(report.transport).toBe("http");
      expect(report.source).toBe("HASNA_LOGS_API_URL");
      expect(report.base_url).toBe("https://logs.hasna.xyz/v1");
      expect(report.api_url_present).toBe(true);
      expect(report.api_url_source).toBe("HASNA_LOGS_API_URL");
      expect(report.api_key_present).toBe(true);
      expect(report.api_key_source).toBe("HASNA_LOGS_API_KEY");
      expect(report.api_key_tier).toBe("env");
      expect(report.local_opt_in).toBe(false);
      expect(JSON.stringify(report)).not.toContain("FAKE_TEST_KEY");
      expect(JSON.stringify(report)).not.toContain("hasna_logs");
    } finally {
      restore();
    }
  });

  test("reports the default gateway authority for a key-only environment", () => {
    const restore = scrub();
    try {
      const report = resolveLogsTransport({ HASNA_LOGS_API_KEY: "gateway-key" });
      expect(report.transport).toBe("http");
      expect(report.source).toBe("default");
      expect(report.base_url).toBe("https://api.hasna.com/logs/v1");
      expect(report.api_url_present).toBe(false);
      expect(report.api_url_source).toBe("default");
      expect(report.api_key_source).toBe("HASNA_LOGS_API_KEY");
      expect(JSON.stringify(report)).not.toContain("gateway-key");
    } finally {
      restore();
    }
  });

  test("reports local under the explicit opt-in when nothing is configured", () => {
    const restore = scrub();
    try {
      const report = resolveLogsTransport({ HASNA_LOGS_LOCAL: "1" });
      expect(report.transport).toBe("local");
      expect(report.source).toBe("local");
      expect(report.base_url).toBeNull();
      expect(report.api_key_present).toBe(false);
      expect(report.local_opt_in).toBe(true);
    } finally {
      restore();
    }
  });

  test("matches the shared resolver's own resolution for the same env", () => {
    const restore = scrub();
    try {
      const direct = resolveClientTransport(LOGS_APP_SLUG, API_ENV);
      const report = resolveLogsTransport(API_ENV);
      expect(report.base_url).toBe(direct.baseUrl);
      expect(report.api_url_source).toBe(direct.apiUrlSource);
      expect(report.api_key_source).toBe(direct.apiKeySource);
      expect(report.api_key_tier).toBe(direct.apiKeyTier);
    } finally {
      restore();
    }
  });
});

describe("requireLocalStore / localStoreIfAvailable", () => {
  test("requireLocalStore returns the local store under the explicit opt-in", () => {
    const restore = scrub();
    try {
      expect(requireLocalStore("db doctor segments", { HASNA_LOGS_LOCAL: "1" })).toBeInstanceOf(LocalStore);
    } finally {
      restore();
    }
  });

  test("requireLocalStore FAILS CLOSED without the opt-in and without a credential", () => {
    const restore = scrub();
    try {
      expect(() => requireLocalStore("db doctor segments", {})).toThrow(
        /local-only operation/,
      );
      expect(() => requireLocalStore("db doctor segments", {})).toThrow(
        /HASNA_LOGS_LOCAL/,
      );
    } finally {
      restore();
    }
  });

  test("requireLocalStore throws on the HTTP transport", () => {
    const restore = scrub();
    try {
      expect(() => requireLocalStore("db doctor segments", API_ENV)).toThrow(/local-only operation/);
    } finally {
      restore();
    }
  });

  test("localStoreIfAvailable is null on the HTTP transport and without an opt-in", () => {
    const restore = scrub();
    try {
      expect(localStoreIfAvailable(API_ENV)).toBeNull();
      expect(localStoreIfAvailable({})).toBeNull();
      expect(localStoreIfAvailable({ HASNA_LOGS_LOCAL: "1" })).toBeInstanceOf(LocalStore);
    } finally {
      restore();
    }
  });
});