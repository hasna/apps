import { describe, expect, test } from "bun:test";
import { inspect } from "node:util";
import {
  CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE,
  CredentialResolutionError,
  explicitCredential,
  resolveCredential,
  validateAndSealResolvedCredential,
} from "./credentials.js";

describe("credential review regressions", () => {
  test("header controls are rejected without reproducing the credential", () => {
    const secret = "secret\rleak";
    expect(() => resolveCredential("todos", {}, { apiKey: secret })).toThrow(CredentialResolutionError);
    try {
      resolveCredential("todos", {}, { apiKey: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  test("ordinary punctuation is accepted", () => {
    expect(resolveCredential("todos", {}, { apiKey: "sk-test_+=:.,@" })?.apiKey).toBe("sk-test_+=:.,@");
  });

  test("vault-shaped literals are refused and refs remain explicit pointers", () => {
    expect(() => resolveCredential("todos", {}, { apiKey: "hasna/todos/live/api_key" })).toThrow(
      CredentialResolutionError,
    );
    const pointer = resolveCredential("todos", { HASNA_TODOS_API_KEY_REF: "hasna/todos/live/api_key" })!;
    expect(pointer.tier).toBe("pointer");
    expect(pointer.apiKey).toBe("");
    expect(pointer.pointerVaultKey).toBe("hasna/todos/live/api_key");
  });

  test("ordinary credentials resolve independently, and pointer selection stays deliberate", () => {
    const env = {
      HOME: "/path-that-does-not-exist",
      HASNA_TODOS_API_KEY: "environment-key",
    };
    const ordinary = resolveCredential("todos", env)!;
    expect(ordinary.tier).toBe("env");
    expect(ordinary.apiKey).toBe("environment-key");

    const keychain = resolveCredential(
      "todos",
      { HASNA_STATION: "fixture" },
      {
        keychain: {
          platform: "darwin",
          hostname: () => "fixture",
          run: () => ({ status: 0, stdout: "keychain-key\n", stderr: "" }),
        },
      },
    )!;
    expect(keychain.tier).toBe("keychain");
    expect(keychain.apiKey).toBe("keychain-key");

    const pointer = resolveCredential("todos", {
      ...env,
      HASNA_TODOS_API_KEY_REF: "hasna/todos/live/api_key",
    })!;
    expect(pointer.tier).toBe("pointer");
    expect(pointer.pointerVaultKey).toBe("hasna/todos/live/api_key");
    expect(pointer.deliberate).toBe(true);
  });

  test("resolved credentials cannot spill through serialization or inspection", () => {
    const secret = "never-print-this";
    const resolved = explicitCredential("todos", secret);
    expect(JSON.stringify(resolved)).not.toContain(secret);
    expect(inspect(resolved)).not.toContain(secret);
    expect(Object.keys(resolved)).not.toContain("apiKey");
    expect({ ...resolved }).not.toHaveProperty("apiKey");
  });

  test("caller-supplied provider values are validated and resealed", () => {
    const resolved = validateAndSealResolvedCredential("todos", {
      apiKey: "provider-key",
      tier: "override",
      source: "untrusted label",
      deliberate: true,
      diskCandidates: [],
      warning: "untrusted warning",
    });
    expect(resolved.source).toBe(CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE);
    expect(resolved.warning).toBeNull();
    expect(JSON.stringify(resolved)).not.toContain("provider-key");
  });

  test("prototype properties cannot synthesize credentials", () => {
    const polluted = Object.create({ HASNA_TODOS_API_KEY: "prototype-key" }) as Record<string, string>;
    expect(resolveCredential("todos", polluted)).toBeNull();
  });
});
