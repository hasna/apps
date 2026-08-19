// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// The one shared guard that stops a caller from supplying per-provider
// credentials to the self-hosted server, where they would be silently
// dropped on the wire and reported back as "Provider credentials are
// invalid" — both halves of that were false (see the module comment).
//
// Failure modes a weak test would miss:
//   - a whitespace-only string is NOT a supplied credential (it would
//     otherwise trip the guard on an empty flag);
//   - non-string values (a caller passing a number or null through the
//     loosely-typed input) must not be counted as supplied;
//   - the error must name the EXACT fields supplied, so the operator can see
//     which flags to drop;
//   - the guard must pass cleanly when nothing was supplied — the no-throw
//     branch is the one a regression here breaks first.

import { describe, expect, it } from "bun:test";
import {
  assertNoProviderCredentials,
  SelfHostedProviderCredentialsUnsupportedError,
  suppliedProviderCredentialFields,
} from "./provider-credentials.js";

describe("suppliedProviderCredentialFields", () => {
  it("returns [] when nothing is supplied", () => {
    expect(suppliedProviderCredentialFields({})).toEqual([]);
  });

  it("lists the credential fields that carry non-empty strings", () => {
    expect(suppliedProviderCredentialFields({ api_key: "k" })).toEqual(["api_key"]);
    expect(suppliedProviderCredentialFields({ api_key: "k", access_key: "a", secret_key: "s" })).toEqual([
      "api_key",
      "access_key",
      "secret_key",
    ]);
  });

  it("ignores whitespace-only and non-string values", () => {
    expect(suppliedProviderCredentialFields({ api_key: "   " })).toEqual([]);
    expect(suppliedProviderCredentialFields({ api_key: "" })).toEqual([]);
    // Loosely-typed callers could hand through anything; only real strings count.
    expect(suppliedProviderCredentialFields({ api_key: 12345, access_key: null, secret_key: undefined })).toEqual([]);
  });

  it("ignores non-credential fields entirely", () => {
    expect(suppliedProviderCredentialFields({ name: "smtp", provider_type: "ses" })).toEqual([]);
  });
});

describe("assertNoProviderCredentials", () => {
  it("throws the named error when credentials were supplied", () => {
    expect(() => assertNoProviderCredentials({ api_key: "k", secret_key: "s" })).toThrow(
      SelfHostedProviderCredentialsUnsupportedError,
    );
  });

  it("names the exact supplied fields in the message", () => {
    try {
      assertNoProviderCredentials({ access_key: "a" });
      throw new Error("expected assertNoProviderCredentials to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SelfHostedProviderCredentialsUnsupportedError);
      expect((error as SelfHostedProviderCredentialsUnsupportedError).fields).toEqual(["access_key"]);
      expect((error as Error).message).toContain("access_key");
      // The remedy must be visible: the operator is told to re-run without the flags.
      expect((error as Error).message).toContain("Re-run without the credential flags");
    }
  });

  it("does not throw when nothing was supplied", () => {
    expect(() => assertNoProviderCredentials({})).not.toThrow();
    expect(() => assertNoProviderCredentials({ name: "smtp" })).not.toThrow();
    expect(() => assertNoProviderCredentials({ api_key: "  " })).not.toThrow();
  });
});
