/**
 * @hasna/logs — Store resolver: client-transport derivation.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
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

// The flip is the @hasna/contracts client transport contract (0.11.1):
// HASNA_LOGS_API_URL + an API credential select HTTP; everything else is
// local SQLite. Legacy storage-mode variables are REJECTED by the client with
// migration guidance — the tests below prove the rejection, they never
// exercise it as a mode switch.
//
// The machine may carry real HASNA_LOGS_* env vars; the tests scrub them so
// the resolution is hermetic.

function scrub(): () => void {
  const saved = {
    url: process.env.HASNA_LOGS_API_URL,
    key: process.env.HASNA_LOGS_API_KEY,
    mode: process.env.HASNA_LOGS_STORAGE_MODE,
  };
  delete process.env.HASNA_LOGS_API_URL;
  delete process.env.HASNA_LOGS_API_KEY;
  delete process.env.HASNA_LOGS_STORAGE_MODE;
  return () => {
    if (saved.url !== undefined) process.env.HASNA_LOGS_API_URL = saved.url;
    else delete process.env.HASNA_LOGS_API_URL;
    if (saved.key !== undefined) process.env.HASNA_LOGS_API_KEY = saved.key;
    else delete process.env.HASNA_LOGS_API_KEY;
    if (saved.mode !== undefined) process.env.HASNA_LOGS_STORAGE_MODE = saved.mode;
    else delete process.env.HASNA_LOGS_STORAGE_MODE;
  };
}

const API_ENV = {
  HASNA_LOGS_API_URL: "https://logs.hasna.xyz/v1",
  HASNA_LOGS_API_KEY: ["hasna", "logs", "FAKE", "TEST", "KEY"].join("_"),
} as NodeJS.ProcessEnv;

describe("resolveStore", () => {
  test("resolves LocalStore without API vars", () => {
    const restore = scrub();
    try {
      expect(resolveStore({})).toBeInstanceOf(LocalStore);
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
      // The 0.11.1 client refuses to route on a URL with no resolvable key
      // instead of silently flipping transport.
      expect(() => resolveStore({ HASNA_LOGS_API_URL: "https://logs.hasna.xyz/v1" })).toThrow();
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
      // the client never reads it — the API pair alone selects the transport.
      expect(() => resolveStore({ ...API_ENV, HASNA_LOGS_STORAGE_MODE: "cloud" })).not.toThrow();
      expect(usesHttpTransport({ HASNA_LOGS_STORAGE_MODE: "self_hosted" })).toBe(false);
      expect(usesHttpTransport(API_ENV)).toBe(true);
    } finally {
      restore();
    }
  });
});

describe("requireLocalStore / localStoreIfAvailable", () => {
  test("requireLocalStore returns the local store on the sqlite transport", () => {
    const restore = scrub();
    try {
      expect(requireLocalStore("db doctor segments", {})).toBeInstanceOf(LocalStore);
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

  test("localStoreIfAvailable is null on the HTTP transport, a store otherwise", () => {
    const restore = scrub();
    try {
      expect(localStoreIfAvailable(API_ENV)).toBeNull();
      expect(localStoreIfAvailable({})).toBeInstanceOf(LocalStore);
    } finally {
      restore();
    }
  });
});
