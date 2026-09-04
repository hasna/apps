import { afterEach, describe, expect, test } from "bun:test";
import { env } from "./env.js";

/**
 * Every key chain the module reads, in scan order. Keep in lockstep with
 * env.ts: projects' alias helper scans for the first TRUTHY value, so an
 * empty canonical value falls through to the legacy names (unlike the `??`
 * helpers in the other apps' env modules).
 */
const CASES: Array<{ read: () => string | undefined; keys: string[] }> = [
  { read: () => env.json(), keys: ["HASNA_PROJECTS_JSON", "PROJECTS_JSON"] },
  { read: () => env.reportsToken(), keys: ["HASNA_PROJECTS_REPORTS_TOKEN", "PROJECTS_REPORTS_TOKEN"] },
  { read: () => env.conversationsBin(), keys: ["HASNA_PROJECTS_CONVERSATIONS_BIN", "PROJECTS_CONVERSATIONS_BIN"] },
  { read: () => env.agentModel(), keys: ["HASNA_PROJECTS_AGENT_MODEL", "PROJECTS_AGENT_MODEL"] },
  { read: () => env.agentContextLimit(), keys: ["HASNA_PROJECTS_AGENT_CONTEXT_LIMIT", "PROJECTS_AGENT_CONTEXT_LIMIT"] },
  { read: () => env.openrouterApiKey(), keys: ["HASNA_PROJECTS_OPENROUTER_API_KEY", "OPENROUTER_API_KEY", "PROJECTS_OPENROUTER_API_KEY"] },
  { read: () => env.openrouterSecretKey(), keys: ["HASNA_PROJECTS_OPENROUTER_SECRET_KEY", "PROJECTS_OPENROUTER_SECRET_KEY"] },
  { read: () => env.useSecrets(), keys: ["HASNA_PROJECTS_USE_SECRETS", "PROJECTS_USE_SECRETS"] },
  { read: () => env.modelPricingJson(), keys: ["HASNA_PROJECTS_MODEL_PRICING_JSON", "PROJECTS_MODEL_PRICING_JSON"] },
];

const SAVED = new Map<string, string | undefined>();
for (const { keys } of CASES) {
  for (const key of keys) SAVED.set(key, process.env[key]);
}
afterEach(() => {
  for (const [key, value] of SAVED) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("env alias resolution", () => {
  test("reads the first legacy name when the canonical one is unset", () => {
    for (const { read, keys } of CASES) {
      const [canonical, ...legacy] = keys;
      delete process.env[canonical];
      for (const key of legacy) delete process.env[key];
      process.env[legacy[0]] = `legacy-${legacy[0]}`;
      expect(read(), legacy[0]).toBe(`legacy-${legacy[0]}`);
    }
  });

  test("canonical wins when both are set", () => {
    for (const { read, keys } of CASES) {
      const [canonical, ...legacy] = keys;
      process.env[canonical] = `canonical-${canonical}`;
      for (const key of legacy) process.env[key] = `legacy-${key}`;
      expect(read(), canonical).toBe(`canonical-${canonical}`);
    }
  });

  test("an empty canonical value falls through to the legacy names (truthy scan)", () => {
    for (const { read, keys } of CASES) {
      const [canonical, ...legacy] = keys;
      process.env[canonical] = "";
      process.env[legacy[0]] = `legacy-${legacy[0]}`;
      expect(read(), legacy[0]).toBe(`legacy-${legacy[0]}`);
    }
  });

  test("the provider-generic fallback is read between the canonical and legacy names", () => {
    process.env.HASNA_PROJECTS_OPENROUTER_API_KEY = "";
    delete process.env.OPENROUTER_API_KEY;
    process.env.PROJECTS_OPENROUTER_API_KEY = "";
    process.env.OPENROUTER_API_KEY = "provider-key";
    expect(env.openrouterApiKey()).toBe("provider-key");
  });

  test("undefined when no name in the chain is set", () => {
    for (const { read, keys } of CASES) {
      for (const key of keys) delete process.env[key];
      expect(read(), keys.join(" / ")).toBeUndefined();
    }
  });
});
