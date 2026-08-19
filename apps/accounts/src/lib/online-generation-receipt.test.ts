// agent-authored: the SOL consult refused on two distinct accounts
// (usage-limit, then model-at-capacity), so this gap analysis and test
// spec were authored by Paulinus from direct source reading. No test file
// in this package imported src/lib/online-generation-receipt.ts; the
// module's runtime surface (the verification error class and the pinned
// provenance constants) had zero coverage.
import { describe, expect, test } from "bun:test";

import { AccountsError } from "../types.js";
import {
  ONLINE_GENERATION_CHECK_RECEIPT_SCHEMA_VERSION,
  ONLINE_GENERATION_CHECK_RECEIPT_VALIDATION_EVIDENCE_SCHEMA_VERSION,
  ONLINE_GENERATION_RECEIPT_LEGACY_CONTRACT_SHA256,
  ONLINE_GENERATION_RECEIPT_MAXIMUM_AGE_MS,
  ONLINE_GENERATION_RECEIPT_MAXIMUM_CLOCK_SKEW_MS,
  ONLINE_GENERATION_RECEIPT_MAXIMUM_LIFETIME_MS,
  ONLINE_GENERATION_RECEIPT_REASON_CODES,
  OnlineGenerationReceiptVerificationError,
  type OnlineGenerationReceiptVerificationErrorCode,
} from "./online-generation-receipt.js";

const ERROR_CODE_MESSAGES: Record<OnlineGenerationReceiptVerificationErrorCode, string> = {
  MALFORMED_RECEIPT: "Online generation receipt verification failed: malformed receipt",
  UNTRUSTED_RECEIPT: "Online generation receipt verification failed: untrusted receipt",
  STALE_RECEIPT: "Online generation receipt verification failed: stale receipt",
  BINDING_MISMATCH: "Online generation receipt verification failed: binding mismatch",
  INVALID_VERIFIER_CONFIGURATION:
    "Online generation receipt verification failed: invalid verifier configuration",
};

describe("OnlineGenerationReceiptVerificationError", () => {
  for (const [code, message] of Object.entries(ERROR_CODE_MESSAGES) as [
    OnlineGenerationReceiptVerificationErrorCode,
    string,
  ][]) {
    test(`${code} maps to its exact message`, () => {
      const error = new OnlineGenerationReceiptVerificationError(code);
      expect(error.message).toBe(message);
    });
  }

  test("every constructible code is present in the message map", () => {
    expect(Object.keys(ERROR_CODE_MESSAGES).sort()).toEqual(
      [
        "BINDING_MISMATCH",
        "INVALID_VERIFIER_CONFIGURATION",
        "MALFORMED_RECEIPT",
        "STALE_RECEIPT",
        "UNTRUSTED_RECEIPT",
      ].sort(),
    );
  });

  test("carries the class name and code, and is an AccountsError", () => {
    const error = new OnlineGenerationReceiptVerificationError("STALE_RECEIPT");
    expect(error.name).toBe("OnlineGenerationReceiptVerificationError");
    expect(error.code).toBe("STALE_RECEIPT");
    expect(error).toBeInstanceOf(AccountsError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe("receipt provenance constants", () => {
  test("schema versions are pinned to the documented contract strings", () => {
    expect(ONLINE_GENERATION_CHECK_RECEIPT_SCHEMA_VERSION).toBe(
      "accounts.online-generation-check-receipt.v1",
    );
    expect(ONLINE_GENERATION_CHECK_RECEIPT_VALIDATION_EVIDENCE_SCHEMA_VERSION).toBe(
      "accounts.online-generation-check-receipt-validation-evidence.v1",
    );
  });

  test("legacy contract sha256 is the pinned provenance digest", () => {
    expect(ONLINE_GENERATION_RECEIPT_LEGACY_CONTRACT_SHA256).toBe(
      "0d2b45c286f56452312b251b7622e009c486e2fe71fe8f2a5a59c01472eb8b2a",
    );
  });

  test("age bounds are internally consistent", () => {
    expect(ONLINE_GENERATION_RECEIPT_MAXIMUM_AGE_MS).toBe(60_000);
    expect(ONLINE_GENERATION_RECEIPT_MAXIMUM_LIFETIME_MS).toBe(120_000);
    expect(ONLINE_GENERATION_RECEIPT_MAXIMUM_CLOCK_SKEW_MS).toBe(5_000);
    // A receipt cannot be fresh longer than it is allowed to live.
    expect(ONLINE_GENERATION_RECEIPT_MAXIMUM_AGE_MS).toBeLessThanOrEqual(
      ONLINE_GENERATION_RECEIPT_MAXIMUM_LIFETIME_MS,
    );
  });
});

describe("reason code vocabulary", () => {
  test("is non-empty and contains no duplicates", () => {
    expect(ONLINE_GENERATION_RECEIPT_REASON_CODES.length).toBeGreaterThan(0);
    expect(new Set(ONLINE_GENERATION_RECEIPT_REASON_CODES).size).toBe(
      ONLINE_GENERATION_RECEIPT_REASON_CODES.length,
    );
  });

  test("includes the deny, staleness, and use-limit members the receipt types branch on", () => {
    for (const member of [
      "CURRENT_DENY",
      "HEALTH_STALE",
      "POLICY_DIGEST_MISMATCH",
      "CREDENTIAL_BINDING_EXPIRED",
      "USE_LIMIT_REACHED",
      "CAPSULE_OWNER_MISMATCH",
    ]) {
      expect(ONLINE_GENERATION_RECEIPT_REASON_CODES).toContain(member);
    }
  });

  test("every code is upper-case snake, so the vocabulary stays machine-greppable", () => {
    for (const code of ONLINE_GENERATION_RECEIPT_REASON_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});
