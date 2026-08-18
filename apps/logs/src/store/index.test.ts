/**
 * @hasna/logs — Store resolver: env-selection contract.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, test } from "bun:test";
import {
  ApiStore,
  isApiMode,
  LocalStore,
  localStoreIfAvailable,
  requireLocalStore,
  resolveStore,
} from "./index.ts";

const API_URL = "https://logs.example.invalid/v1";
const API_KEY = ["hasna", "logs", "FAKE", "TEST", "KEY"].join("_");

const API_ENV = {
  HASNA_LOGS_API_URL: API_URL,
  HASNA_LOGS_API_KEY: API_KEY,
} as NodeJS.ProcessEnv;

describe("resolveStore", () => {
  test("resolves to LocalStore when no hosted client env is set", () => {
    expect(resolveStore({})).toBeInstanceOf(LocalStore);
  });

  test("resolves to ApiStore when both hosted client vars are set", () => {
    expect(resolveStore(API_ENV)).toBeInstanceOf(ApiStore);
  });

  test("honors the unprefixed alias env keys", () => {
    expect(
      resolveStore({
        LOGS_API_URL: API_URL,
        LOGS_API_KEY: API_KEY,
      } as NodeJS.ProcessEnv),
    ).toBeInstanceOf(ApiStore);
  });

  test("throws when only the API URL is set", () => {
    expect(() =>
      resolveStore({ HASNA_LOGS_API_URL: API_URL } as NodeJS.ProcessEnv),
    ).toThrow(/must be set together/);
  });

  test("throws when only the API key is set", () => {
    expect(() =>
      resolveStore({ HASNA_LOGS_API_KEY: API_KEY } as NodeJS.ProcessEnv),
    ).toThrow(/must be set together/);
  });
});

describe("isApiMode", () => {
  test("true only when both hosted client vars are set", () => {
    expect(isApiMode(API_ENV)).toBe(true);
    expect(isApiMode({})).toBe(false);
    expect(
      isApiMode({ HASNA_LOGS_API_URL: API_URL } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      isApiMode({ HASNA_LOGS_API_KEY: API_KEY } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe("local-store guards", () => {
  test("requireLocalStore throws in api mode and returns local otherwise", () => {
    expect(() => requireLocalStore("db-repair", API_ENV)).toThrow(
      /local-only operation/,
    );
    expect(requireLocalStore("db-repair", {})).toBeInstanceOf(LocalStore);
  });

  test("localStoreIfAvailable returns null in api mode", () => {
    expect(localStoreIfAvailable(API_ENV)).toBeNull();
    expect(localStoreIfAvailable({})).toBeInstanceOf(LocalStore);
  });
});
