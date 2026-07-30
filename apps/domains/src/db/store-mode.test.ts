import { describe, expect, test } from "bun:test";
import { domainsCloudEnv, serverStorageMode, SERVER_MODE_CANDIDATES } from "./store.js";

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
// machine is on, and the bet loses on one side or the other. Measured 2026-07-30:
// against contracts 0.5.2 `postgres` throws and `self_hosted` normalizes; against
// contracts main (0.8.6) `postgres` normalizes and `self_hosted` throws.
//
// `normalize` is injectable for exactly this reason — both generations have to be
// exercised, and only one of them can be installed at a time.

describe("serverStorageMode", () => {
  const acceptOnly = (accepted: readonly string[]) => (value: string) => {
    if (!accepted.includes(value)) throw new Error(`Unknown storage mode '${value}'`);
    return value;
  };

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

  test("agrees with the contracts version actually installed", () => {
    // Not a tautology: this is the assertion that fails the day a dependency bump
    // lands a generation the candidate list does not cover.
    expect(SERVER_MODE_CANDIDATES).toContain(serverStorageMode());
  });

  test("the injected mode is the derived one, not a literal", () => {
    const env = domainsCloudEnv({
      HASNA_DOMAINS_API_URL: "https://domains.hasna.xyz",
      HASNA_DOMAINS_API_KEY: ["domains", "FAKE", "KEY"].join("_"),
    });

    expect(env.HASNA_DOMAINS_STORAGE_MODE).toBe(serverStorageMode());
  });
});
