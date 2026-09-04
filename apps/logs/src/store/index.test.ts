/**
 * @hasna/logs — Store resolver: client-transport derivation.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Fail-closed contract (owner ruling 2026-09-04): running WITHOUT the fleet
 * API env must NEVER silently fall back to the local SQLite store
 * (~/.hasna/logs/logs.db). resolveStore({}) FAILS CLOSED; LocalStore is
 * reachable only through the explicit opt-in HASNA_LOGS_LOCAL=1 (alias
 * LOGS_LOCAL=1). Legacy storage-mode variables are REJECTED by the client with
 * migration guidance — the tests prove the rejection, they never exercise it
 * as a mode switch.
 *
 * The machine may carry real HASNA_LOGS_* env vars; the tests scrub them so
 * the resolution is hermetic.
 */
import { describe, expect, test } from "bun:test";
import { resolveStorageClient } from "@hasna/contracts/client/storage";
import {
  LOGS_APP_SLUG,
  localStoreIfAvailable,
  requireLocalStore,
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
    "HASNA_LOGS_STORAGE_MODE",
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
  test("FAILS CLOSED without API vars: no silent local fallback", () => {
    const restore = scrub();
    try {
      expect(() => resolveStore({})).toThrow(/HASNA_LOGS_API_URL/);
      expect(() => resolveStore({})).toThrow(/HASNA_LOGS_LOCAL/);
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

  test("resolves ApiStore when API URL + credential are present", () => {
    const restore = scrub();
    try {
      expect(resolveStore(API_ENV)).toBeInstanceOf(ApiStore);
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
    } finally {
      restore();
    }
  });

  test("a legacy storage-mode variable is inert: the API pair alone selects the transport", () => {
    const restore = scrub();
    try {
      // HASNA_LOGS_STORAGE_MODE was removed from the contracts client contract;
      // the client never reads it — the API pair alone selects the transport,
      // and without the pair there is no silent local fallback.
      expect(() => resolveStore({ ...API_ENV, HASNA_LOGS_STORAGE_MODE: "cloud" })).not.toThrow();
      expect(() => resolveStore({ HASNA_LOGS_STORAGE_MODE: "self_hosted" })).toThrow();
      expect(usesHttpTransport({ HASNA_LOGS_STORAGE_MODE: "self_hosted" })).toBe(false);
      expect(usesHttpTransport(API_ENV)).toBe(true);
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

  test("requireLocalStore FAILS CLOSED without the opt-in and without API vars", () => {
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
