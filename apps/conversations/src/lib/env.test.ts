import { afterEach, describe, expect, test } from "bun:test";
import { env } from "./env.js";

/**
 * Every canonical/legacy pair the module reads. Keep in lockstep with env.ts:
 * the tests below pin the alias order (canonical wins, legacy fallback) and
 * the empty-string semantics of the shared `??` helper.
 */
const CASES: Array<{ read: () => string | undefined; canonical: string; legacy: string }> = [
  { read: () => env.agentId(), canonical: "HASNA_CONVERSATIONS_AGENT_ID", legacy: "CONVERSATIONS_AGENT_ID" },
  { read: () => env.sessionId(), canonical: "HASNA_CONVERSATIONS_SESSION_ID", legacy: "CONVERSATIONS_SESSION_ID" },
  { read: () => env.useMachineIdentity(), canonical: "HASNA_CONVERSATIONS_USE_MACHINE_IDENTITY", legacy: "CONVERSATIONS_USE_MACHINE_IDENTITY" },
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
