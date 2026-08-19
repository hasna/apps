/**
 * TEST-GAP suite: provider env/scope preflight edges.
 *
 * AGENT-AUTHORED — the gpt-5.6-sol advisory consult was attempted on two
 * distinct provider accounts and refused at the capacity wall on both
 * ("Selected model is at capacity. Please try a different model."), so this
 * spec was produced from direct source analysis, not attributed to SOL.
 *
 * tests/store.test.ts "provider env and scope preflights fail closed" covers
 * one revolut + bcr case. This file locks the remaining matrix: empty-string
 * values never count as allowed, unknown providers fail closed (throw),
 * allowed scope grants, and unsupported-area reasons.
 */
import { describe, expect, test } from "bun:test";
import {
  getProvider,
  preflightProviderEnv,
  preflightProviderScopes,
  providerEnvAllowlist,
} from "../src/index.ts";

describe("provider env preflight", () => {
  test("empty-string values never count as present credentials", () => {
    const preflight = preflightProviderEnv("mercury", { MERCURY_API_KEY: "" });
    expect(preflight.allowedKeys).toEqual([]);
    expect(preflight.missingRequiredKeys).toContain("MERCURY_API_KEY");
  });

  test("required env groups accept any member of the group", () => {
    const sandboxOnly = preflightProviderEnv("mercury", { MERCURY_SANDBOX_API_KEY: "sandbox-key" });
    expect(sandboxOnly.allowedKeys).toContain("MERCURY_SANDBOX_API_KEY");
    expect(sandboxOnly.missingRequiredKeys).toEqual([]);

    const productionOnly = preflightProviderEnv("mercury", { MERCURY_PRODUCTION_API_KEY: "production-key" });
    expect(productionOnly.allowedKeys).toContain("MERCURY_PRODUCTION_API_KEY");
    expect(productionOnly.missingRequiredKeys).toEqual([]);
  });

  test("unknown provider ids fail closed instead of silently passing", () => {
    expect(providerEnvAllowlist("mercury")).toBeDefined();
    expect(() => preflightProviderEnv("nope" as never, {})).toThrow();
  });

  test("rejected keys never leak values into the preflight report", () => {
    const preflight = preflightProviderEnv("revolut-business", {
      REVOLUT_CLIENT_ID: "client-value",
      SOME_OTHER_SECRET: "other-value",
    });
    expect(preflight.rejectedKeys).toContain("SOME_OTHER_SECRET");
    expect(JSON.stringify(preflight)).not.toContain("client-value");
    expect(JSON.stringify(preflight)).not.toContain("other-value");
  });

  test("bunq requires both an API key group and a private-key group", () => {
    const apiKeyOnly = preflightProviderEnv("bunq", { BUNQ_API_KEY: "key" });
    expect(apiKeyOnly.missingRequiredKeys).toEqual(["BUNQ_PRIVATE_KEY"]);
    const privateKeyOnly = preflightProviderEnv("bunq", { BUNQ_PRIVATE_KEY: "key" });
    expect(privateKeyOnly.missingRequiredKeys).toEqual(["BUNQ_API_KEY"]);
  });
});

describe("provider scope preflight", () => {
  test("an area is allowed only when every required scope is granted", () => {
    const revolut = getProvider("revolut-business");
    if (!revolut) throw new Error("missing provider");

    const allowed = preflightProviderScopes(revolut, "read", ["READ"]);
    expect(allowed.allowed).toBe(true);
    expect(allowed.missingScopes).toEqual([]);

    const missingOne = preflightProviderScopes(revolut, "read", []);
    expect(missingOne.allowed).toBe(false);
    expect(missingOne.missingScopes).toEqual(["READ"]);

    const extra = preflightProviderScopes(revolut, "read", ["READ", "EXTRA"]);
    expect(extra.allowed).toBe(true);
  });

  test("unsupported areas carry the exact reason instead of a scope complaint", () => {
    const bcr = getProvider("erste-bcr");
    if (!bcr) throw new Error("missing provider");

    const cards = preflightProviderScopes(bcr, "cards", []);
    expect(cards.allowed).toBe(false);
    expect(cards.unsupportedReason).toBe("Provider does not support card scope operations.");
    expect(cards.missingScopes).toEqual([]);

    const sensitive = preflightProviderScopes(bcr, "sensitiveCardData", []);
    expect(sensitive.allowed).toBe(false);
    expect(sensitive.unsupportedReason).toBe("Provider does not support sensitive card data scope operations.");
  });

  test("granted scopes are reported verbatim without normalization", () => {
    const revolut = getProvider("revolut-business");
    if (!revolut) throw new Error("missing provider");
    // Scope matching is exact: a case-variant scope must NOT satisfy the requirement.
    const wrongCase = preflightProviderScopes(revolut, "read", ["read"]);
    expect(wrongCase.allowed).toBe(false);
    expect(wrongCase.missingScopes).toEqual(["READ"]);
  });
});
