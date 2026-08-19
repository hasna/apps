// Agent-authored test-gap analysis (no SOL spec): the SOL consult (gpt-5.6-sol,
// max reasoning) was admitted but produced no answer within its bounds, so this
// file was authored by the writing agent and must not be attributed to SOL.
//
// Target: src/env-token.ts and src/client/env-keys.ts — the app-name -> env-key
// derivation the conformance rule and the credential seam depend on. The
// modules exist precisely because "a second spelling of them is a second thing
// that can drift"; these tests pin the exact spellings and precedence orders so
// a drift becomes a failing test instead of a silently different key name.
// Deterministic, no fixtures, no mocks.

import { describe, expect, test } from "bun:test";
import { envToken } from "../src/env-token";
import {
  CREDENTIAL_PROFILE_ENV_KEY,
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
} from "../src/client/env-keys";

describe("envToken", () => {
  test("derives the upper-snake token for a kebab-case app name", () => {
    expect(envToken("mailery")).toBe("MAILERY");
    expect(envToken("internal-apps")).toBe("INTERNAL_APPS");
    expect(envToken("my-app-2")).toBe("MY_APP_2");
  });

  test("leaves already-upper names unchanged", () => {
    expect(envToken("ALREADY_UPPER")).toBe("ALREADY_UPPER");
  });

  test("handles the empty name", () => {
    expect(envToken("")).toBe("");
  });
});

describe("clientTransportEnvKeys", () => {
  test("returns the canonical key names in precedence order", () => {
    expect(clientTransportEnvKeys("mailery")).toEqual({
      apiUrlKeys: ["HASNA_MAILERY_API_URL", "MAILERY_API_URL"],
      apiKeyKeys: ["HASNA_MAILERY_API_KEY", "MAILERY_API_KEY"],
    });
  });

  test("derives from the kebab name, not the token", () => {
    expect(clientTransportEnvKeys("my-app")).toEqual({
      apiUrlKeys: ["HASNA_MY_APP_API_URL", "MY_APP_API_URL"],
      apiKeyKeys: ["HASNA_MY_APP_API_KEY", "MY_APP_API_KEY"],
    });
  });

  test("URL keys and key keys never overlap", () => {
    const spec = clientTransportEnvKeys("mailery");
    for (const urlKey of spec.apiUrlKeys) {
      expect(spec.apiKeyKeys).not.toContain(urlKey);
    }
  });

  test("the override key is distinct from every ordinary key", () => {
    const override = credentialOverrideEnvKey("mailery");
    expect(override).toBe("HASNA_MAILERY_API_KEY_OVERRIDE");
    const spec = clientTransportEnvKeys("mailery");
    expect([...spec.apiUrlKeys, ...spec.apiKeyKeys]).not.toContain(override);
  });
});

describe("credential override and profile pointer", () => {
  test("the global profile pointer has the stable reserved spelling", () => {
    expect(CREDENTIAL_PROFILE_ENV_KEY).toBe("HASNA_PROFILE");
  });

  test("the override key follows the token derivation", () => {
    expect(credentialOverrideEnvKey("my-app")).toBe("HASNA_MY_APP_API_KEY_OVERRIDE");
  });
});
