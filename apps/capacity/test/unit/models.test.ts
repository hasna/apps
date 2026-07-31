import { describe, expect, test } from "bun:test";

import {
  ACCOUNTS_CAPACITY_SCHEMA_VERSION,
  ELIGIBILITY_REASON_CODES,
} from "../../src/domain/models";

describe("domain model runtime contracts", () => {
  test("publishes the canonical capacity schema version", () => {
    expect(ACCOUNTS_CAPACITY_SCHEMA_VERSION).toBe("accounts.capacity.v1");
  });

  test("publishes the complete ordered eligibility reason-code vocabulary", () => {
    expect(ELIGIBILITY_REASON_CODES).toEqual([
      "CURRENT_DENY",
      "ACCOUNT_NOT_ACTIVE",
      "ENTITLEMENT_NOT_ACTIVE",
      "TERMS_NOT_ALLOWED",
      "TERMS_STALE",
      "OPERATION_NOT_ALLOWED",
      "MODEL_NOT_ALLOWED",
      "DATA_CLASSIFICATION_NOT_ALLOWED",
      "DESTINATION_POLICY_NOT_ALLOWED",
      "CAPACITY_POOL_NOT_ACTIVE",
      "CAPACITY_EVIDENCE_STALE",
      "ACCESS_METHOD_NOT_READY",
      "HEALTH_NOT_HEALTHY",
      "HEALTH_STALE",
      "POLICY_EVIDENCE_STALE",
      "POLICY_DIGEST_MISMATCH",
      "CAPSULE_REQUIRED",
      "CAPSULE_NOT_READY",
      "CAPSULE_OWNER_MISMATCH",
      "CAPSULE_PLACEMENT_INVALID",
      "ATTESTATION_STALE",
      "CREDENTIAL_BINDING_REQUIRED",
      "CREDENTIAL_BINDING_NOT_ACTIVE",
      "CREDENTIAL_BINDING_RETIRING",
      "CREDENTIAL_BINDING_EXPIRED",
      "INVALID_ACCESS_TARGET",
      "GENERATION_MISMATCH",
      "DEPENDENCY_UNAVAILABLE",
      "RECOVERY_HOLD",
    ]);
    expect(new Set(ELIGIBILITY_REASON_CODES).size).toBe(ELIGIBILITY_REASON_CODES.length);
  });
});
