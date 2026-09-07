/**
 * @hasna/logs — Store resolver: client-transport derivation.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Every-transport contract (owner directive 2026-08-15, storage-mode axis
 * retired): a credential from the shared chain resolves the HTTP ApiStore; a
 * truthy HASNA_LOGS_LOCAL=1 opt-in (alias LOGS_LOCAL=1) always selects the
 * on-box LocalStore, even when a credential resolves; and with NOTHING
 * configured, LocalStore is the default — never an error. A DECLARED
 * authority or credential that cannot be honoured (blank, URL without a key,
 * disagreeing aliases) refuses loudly — it is never silently routed to the
 * local store. Legacy storage-mode variables are inert; they never select a
 * transport.
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
  test("with nothing configured, the local store is the default (never an error)", () => {
    const restore = scrub();
    try {
      expect(resolveStore({})).toBeInstanceOf(LocalStore);
    } finally {
      restore();
    }
  });

  test("a truthy explicit local opt-in resolves LocalStore; blank/false values are never opt-ins but still default local", () => {
    const restore = scrub();
    try {
      expect(resolveStore({ HASNA_LOGS_LOCAL: "1" })).toBeInstanceOf(LocalStore);
      expect(resolveStore({ LOGS_LOCAL: "1" })).toBeInstanceOf(LocalStore);
      // Alias with a truthy spelling; blank/false values are never opt-ins —
      // but with nothing configured the default is local anyway.
      expect(resolveStore({ LOGS_LOCAL: "true" })).toBeInstanceOf(LocalStore);
      expect(resolveStore({ HASNA_LOGS_LOCAL: "" })).toBeInstanceOf(LocalStore);
      expect(resolveStore({ HASNA_LOGS_LOCAL: "0" })).toBeInstanceOf(LocalStore);
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

  test("the explicit local opt-in wins over a resolved credential", () => {
    const restore = scrub();
    try {
      // HASNA_LOGS_LOCAL=1 is the operator's explicit transport choice; it
      // selects the on-box store even when the chain resolves a credential.
      expect(
        resolveStore({ ...API_ENV, HASNA_LOGS_LOCAL: "1" }),
      ).toBeInstanceOf(LocalStore);
    } finally {
      restore();
    }
  });

  test("an API URL without a credential is a misconfiguration and is refused, never silently routed", () => {
    const restore = scrub();
    try {
      // The client refuses to route on a URL with no resolvable key instead
      // of silently flipping transport; the misdeclaration is an operator
      // error even under the opt-in (a *blank/conflicting* declaration).
      expect(() => resolveStore({ HASNA_LOGS_API_URL: "https://logs.hasna.xyz/v1" })).toThrow();
      // A URL-without-key + opt-in: the DECLARED authority still cannot be
      // honoured, but the opt-in is not a blank declaration, so local wins.
      expect(
        resolveStore({
          HASNA_LOGS_API_URL: "https://logs.hasna.xyz/v1",
          HASNA_LOGS_LOCAL: "1",
        }),
      ).toBeInstanceOf(LocalStore);
    } finally {
      restore();
    }
  });

  test("a declared-but-blank authority/credential refuses loudly, never falls through", () => {
    const restore = scrub();
    try {
      expect(() => resolveStore({ HASNA_LOGS_API_URL: "" })).toThrow();
      expect(() => resolveStore({ HASNA_LOGS_API_KEY: "" })).toThrow();
      // The explicit opt-in is a transport CHOICE that always wins: even a
      // blank declaration cannot override it (the operator asked for local).
      expect(resolveStore({ HASNA_LOGS_API_URL: "", HASNA_LOGS_LOCAL: "1" })).toBeInstanceOf(LocalStore);
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
      // transport, and without a credential the local default always serves.
      expect(() => resolveStore({ ...API_ENV, HASNA_LOGS_STORAGE_MODE: "cloud" })).not.toThrow();
      expect(resolveStore({ HASNA_LOGS_STORAGE_MODE: "self_hosted" })).toBeInstanceOf(LocalStore);
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

  test("reports local for the explicit opt-in AND for the no-credential default", () => {
    const restore = scrub();
    try {
      const optIn = resolveLogsTransport({ HASNA_LOGS_LOCAL: "1" });
      expect(optIn.transport).toBe("local");
      expect(optIn.source).toBe("local");
      expect(optIn.base_url).toBeNull();
      expect(optIn.api_key_present).toBe(false);
      expect(optIn.local_opt_in).toBe(true);

      const defaulted = resolveLogsTransport({});
      expect(defaulted.transport).toBe("local");
      expect(defaulted.source).toBe("local");
      expect(defaulted.base_url).toBeNull();
      expect(defaulted.local_opt_in).toBe(false);
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
  test("requireLocalStore returns the local store on every transport", () => {
    const restore = scrub();
    try {
      expect(requireLocalStore("db doctor segments", { HASNA_LOGS_LOCAL: "1" })).toBeInstanceOf(LocalStore);
      // No credential + no opt-in: the local default serves maintenance.
      expect(requireLocalStore("db doctor segments", {})).toBeInstanceOf(LocalStore);
      // Even with a resolved credential the raw-store maintenance family
      // runs against the on-box raw store (its subject always lives there).
      expect(requireLocalStore("db doctor segments", API_ENV)).toBeInstanceOf(LocalStore);
    } finally {
      restore();
    }
  });

  test("localStoreIfAvailable mirrors the data plane: null on HTTP and on a declared-but-un-honourable authority", () => {
    const restore = scrub();
    try {
      expect(localStoreIfAvailable(API_ENV)).toBeNull();
      expect(localStoreIfAvailable({})).toBeInstanceOf(LocalStore);
      expect(localStoreIfAvailable({ HASNA_LOGS_LOCAL: "1" })).toBeInstanceOf(LocalStore);
      // A declared authority that cannot be honoured is a misconfiguration,
      // never a local store: self-telemetry is skipped exactly like on HTTP.
      expect(
        localStoreIfAvailable({ HASNA_LOGS_API_URL: "https://logs.example.test/v1" }),
      ).toBeNull();
    } finally {
      restore();
    }
  });
});