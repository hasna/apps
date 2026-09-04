import { afterEach, describe, expect, test } from "bun:test";
import { env } from "./env.js";

/**
 * Every canonical/legacy pair the module reads. Keep in lockstep with env.ts:
 * the tests below pin the alias order (canonical wins, legacy fallback) and
 * the empty-string semantics of the shared `??` helper.
 */
const CASES: Array<{ read: () => string | undefined; canonical: string; legacy: string }> = [
  { read: () => env.apiKey(), canonical: "HASNA_MEMENTOS_API_KEY", legacy: "MEMENTOS_API_KEY" },
  { read: () => env.defaultScope(), canonical: "HASNA_MEMENTOS_DEFAULT_SCOPE", legacy: "MEMENTOS_DEFAULT_SCOPE" },
  { read: () => env.defaultCategory(), canonical: "HASNA_MEMENTOS_DEFAULT_CATEGORY", legacy: "MEMENTOS_DEFAULT_CATEGORY" },
  { read: () => env.defaultImportance(), canonical: "HASNA_MEMENTOS_DEFAULT_IMPORTANCE", legacy: "MEMENTOS_DEFAULT_IMPORTANCE" },
  { read: () => env.pgsyncQueryTimeoutMs(), canonical: "HASNA_MEMENTOS_PGSYNC_QUERY_TIMEOUT_MS", legacy: "MEMENTOS_PGSYNC_QUERY_TIMEOUT_MS" },
  { read: () => env.reflectProvider(), canonical: "HASNA_MEMENTOS_REFLECT_PROVIDER", legacy: "MEMENTOS_REFLECT_PROVIDER" },
  { read: () => env.reflectModel(), canonical: "HASNA_MEMENTOS_REFLECT_MODEL", legacy: "MEMENTOS_REFLECT_MODEL" },
];

const SAVED = new Map<string, string | undefined>();
for (const { canonical, legacy } of CASES) {
  SAVED.set(canonical, process.env[canonical]);
  SAVED.set(legacy, process.env[legacy]);
}
afterEach(() => {
  for (const [key, value] of SAVED) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("env alias resolution", () => {
  test("reads the legacy name when the canonical one is unset", () => {
    for (const { read, canonical, legacy } of CASES) {
      delete process.env[canonical];
      process.env[legacy] = `legacy-${legacy}`;
      expect(read(), legacy).toBe(`legacy-${legacy}`);
    }
  });

  test("canonical wins when both are set", () => {
    for (const { read, canonical, legacy } of CASES) {
      process.env[canonical] = `canonical-${canonical}`;
      process.env[legacy] = `legacy-${legacy}`;
      expect(read(), canonical).toBe(`canonical-${canonical}`);
    }
  });

  test("an empty canonical value still wins (`??` never falls back past it)", () => {
    for (const { read, canonical, legacy } of CASES) {
      process.env[canonical] = "";
      process.env[legacy] = `legacy-${legacy}`;
      expect(read(), canonical).toBe("");
    }
  });

  test("undefined when neither name is set", () => {
    for (const { read, canonical, legacy } of CASES) {
      delete process.env[canonical];
      delete process.env[legacy];
      expect(read(), `${canonical} / ${legacy}`).toBeUndefined();
    }
  });
});
