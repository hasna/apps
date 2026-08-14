/**
 * @hasna/logs — Store resolver: storage-mode derivation.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, test } from "bun:test";
import {
  SERVER_MODE_CANDIDATES,
  serverStorageMode,
  withImpliedServerMode,
} from "./index.ts";

// -- Forward compatibility across the storage-mode enum change -----------------
//
// The injected mode value is DERIVED from the installed @hasna/contracts, never
// hardcoded. That is load-bearing: the enum has already changed once and the two
// valid sets are DISJOINT.
//
//   contracts <= 0.8.5      accepts cloud + deprecated aliases (self_hosted,
//                           remote, hybrid); THROWS on postgres/sqlite
//   contracts post-#63      accepts ONLY sqlite/postgres; THROWS on everything
//                           else, including cloud and self_hosted
//
// So any literal pinned in source is a bet on which side of that change a given
// machine is on, and the bet loses on one side or the other. Measured 2026-07-30
// against the contracts this repo installs (0.5.2): `postgres` throws and
// `self_hosted` normalizes to cloud; against contracts main (0.8.6) `postgres`
// normalizes and `self_hosted` throws.
//
// `normalize` is injectable for exactly this reason — both generations have to
// be exercised, and only one of them can be installed at a time. Without the
// injection point, forward compatibility would be an assertion rather than a
// test.

describe("serverStorageMode", () => {
  const acceptOnly = (accepted: readonly string[]) => (value: string) => {
    if (!accepted.includes(value)) throw new Error(`Unknown storage mode '${value}'`);
    return value;
  };

  // Widened so `toContain` compares strings rather than narrowing its argument
  // to the literal union of the tuple.
  const CANDIDATES: readonly string[] = SERVER_MODE_CANDIDATES;

  test("derives self_hosted on the pre-#63 contracts enum", () => {
    const normalize = acceptOnly(["local", "cloud", "self_hosted", "remote", "hybrid"]);

    expect(serverStorageMode(normalize)).toBe("self_hosted");
  });

  test("derives postgres on the post-#63 contracts enum", () => {
    const normalize = acceptOnly(["sqlite", "postgres", "postgresql"]);

    expect(serverStorageMode(normalize)).toBe("postgres");
  });

  test("prefers the newest accepted token when several are valid", () => {
    // A transitional release that still honours the aliases must not pin the
    // deprecated one.
    const normalize = acceptOnly(["sqlite", "postgres", "cloud", "self_hosted"]);

    expect(serverStorageMode(normalize)).toBe("postgres");
  });

  test("throws with an actionable message when the enum changes again", () => {
    // Guessing is the defect class this pin exists to remove, so an unrecognised
    // enum must fail loudly rather than fall through to a wrong dataset.
    const normalize = acceptOnly([]);

    expect(() => serverStorageMode(normalize)).toThrow(/No known server storage mode/);
    expect(() => serverStorageMode(normalize)).toThrow(/SERVER_MODE_CANDIDATES/);
  });

  test("an injected normalizer never poisons the cached default", () => {
    // The cache is only read/written for the default normalizer. Without that
    // guard, the first injected probe would fix the value for the whole process.
    const real = serverStorageMode();

    expect(serverStorageMode(acceptOnly(["sqlite", "postgres"]))).toBe("postgres");
    expect(serverStorageMode()).toBe(real);
  });

  test("agrees with the contracts version actually installed", () => {
    // Not a tautology: this is the assertion that fails the day a dependency
    // bump lands a generation the candidate list does not cover.
    expect(CANDIDATES).toContain(serverStorageMode());
  });
});

describe("withImpliedServerMode", () => {
  const CANDIDATES: readonly string[] = SERVER_MODE_CANDIDATES;
  const API_ENV = {
    HASNA_LOGS_API_URL: "https://logs.hasna.xyz/v1",
    HASNA_LOGS_API_KEY: ["hasna", "logs", "FAKE", "TEST", "KEY"].join("_"),
  } as NodeJS.ProcessEnv;

  test("the injected mode is the derived one, not a literal", () => {
    const env = withImpliedServerMode(API_ENV);

    expect(env.HASNA_LOGS_STORAGE_MODE).toBe(serverStorageMode());
  });

  test("the derived value is accepted by the installed contracts", () => {
    // The end-to-end property this migration exists to guarantee: whatever we
    // synthesize must be a token the resolver will not throw on.
    const env = withImpliedServerMode(API_ENV);

    // String() rather than a non-null assertion: an absent value must fail this
    // test, not be typed away.
    expect(CANDIDATES).toContain(String(env.HASNA_LOGS_STORAGE_MODE));
  });

  test("an explicit mode var is always respected", () => {
    const env = withImpliedServerMode({ ...API_ENV, HASNA_LOGS_STORAGE_MODE: "local" });

    expect(env.HASNA_LOGS_STORAGE_MODE).toBe("local");
  });

  test("nothing is synthesized without both API vars", () => {
    expect(withImpliedServerMode({}).HASNA_LOGS_STORAGE_MODE).toBeUndefined();
    expect(
      withImpliedServerMode({ HASNA_LOGS_API_URL: "https://logs.hasna.xyz/v1" })
        .HASNA_LOGS_STORAGE_MODE,
    ).toBeUndefined();
  });

  test("does not mutate the caller's env", () => {
    const source = { ...API_ENV };

    withImpliedServerMode(source);

    expect(source.HASNA_LOGS_STORAGE_MODE).toBeUndefined();
  });
});
