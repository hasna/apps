import { describe, expect, test } from "bun:test";
import { SandboxError } from "../src/errors.js";
import { validateCleanupGrant, validateFence, validateSandboxSpec } from "../src/validation.js";
import { cleanupGrant, createInput, digest, fence, oid, spec } from "./fixtures.js";

describe("closed V1 validation", () => {
  test("accepts the canonical complete fence", () => {
    const value = fence(oid("op", 90), digest("operation"), 1n, 1n);
    expect(validateFence(value)).toEqual(value);
  });

  test.each(["attempt_lease_epoch", "allocation_generation", "lifecycle_revision"])(
    "rejects competing fence alias %s",
    (alias) => {
      const value = { ...fence(oid("op", 91), digest("operation"), 1n, 1n), [alias]: "1" };
      expect(() => validateFence(value)).toThrow(SandboxError);
    },
  );

  test("rejects missing full-fence members", () => {
    const value = { ...fence(oid("op", 92), digest("operation"), 1n, 1n) } as Record<string, unknown>;
    delete value.operation_executor_principal;
    expect(() => validateFence(value)).toThrow("missing a required field");
  });

  test("rejects short and fuzzy IDs", () => {
    const value = { ...fence(oid("op", 93), digest("operation"), 1n, 1n), resource_id: "sbx_123" };
    expect(() => validateFence(value)).toThrow("full opaque ID");
  });

  test("rejects provider choice, host paths, mutable images, and environment maps", () => {
    for (const field of ["provider", "host_path", "env", "image_tag", "config"]) {
      expect(() => validateSandboxSpec({ ...spec(), [field]: field })).toThrow("unknown field");
    }
  });

  test("requires strong VM, fixed workspace, digest-pinned environment, and concurrency one", () => {
    expect(() => validateSandboxSpec({ ...spec(), runtime_class: "container" })).toThrow();
    expect(() => validateSandboxSpec({ ...spec(), workspace_root: "/tmp" })).toThrow();
    expect(() => validateSandboxSpec({ ...spec(), exec_concurrency: 2 })).toThrow();
  });

  test("accepts only the exact recovery-first permanent discard basis", () => {
    const input = createInput();
    const fakeSandbox = {
      ...input,
      id: input.resource_id,
      provider_handle_sha256: digest("handle"),
      resource_lifecycle_generation: 2n,
    } as never;
    const valid = cleanupGrant(fakeSandbox, {
      kind: "discard_uncheckpointed",
      receipt_sha256: digest("passkey-receipt"),
      recovery_checkpoint_attempted: true,
      promotion_grants_revoked: true,
      permanent_outcome: "discarded_uncheckpointed",
    });
    expect(validateCleanupGrant(valid).basis.kind).toBe("discard_uncheckpointed");
    const invalid = structuredClone(valid) as unknown as Record<string, unknown>;
    invalid.basis = { kind: "discard_uncheckpointed", receipt_sha256: digest("generic") };
    expect(() => validateCleanupGrant(invalid)).toThrow("recovery-first");
  });
});
