import { describe, expect, test } from "bun:test";
import { SandboxError } from "../src/errors.js";
import { canonicalJson } from "../src/canonical.js";
import {
  EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
  EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
  RECONCILIATION_BLOCKED_MAPPING_FIXTURE,
} from "../src/effect-journal.js";
import { readFileSync } from "node:fs";
import { createRequestDigest } from "../src/service.js";
import {
  validateCleanupGrant,
  validateDispatchedJournalAnchor,
  validateFence,
  validateSandboxSpec,
} from "../src/validation.js";
import { cleanupGrant, context, createInput, digest, fence, oid, spec } from "./fixtures.js";

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

  test("exposes the exact authenticated reconciliation-blocked mapping fixture", () => {
    expect(RECONCILIATION_BLOCKED_MAPPING_FIXTURE).toEqual({
      mapping_schema_version: "infinity.effect-outcome-mapping/v1",
      source_outcome_schema_version: EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
      source_outcome_schema_digest: EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
      external_outcome_kind: "reconciliation_blocked",
      infinity_operation_state: "quarantined",
      infinity_resource_state: "quarantined",
    });
    expect(RECONCILIATION_BLOCKED_MAPPING_FIXTURE.external_outcome_kind)
      .not.toBe(RECONCILIATION_BLOCKED_MAPPING_FIXTURE.infinity_operation_state);
  });

  test("signed journal envelopes are closed and bind record plus frontier bytes", () => {
    const input = createInput();
    const anchor = context(
      "begin_create_inert",
      oid("op", 94),
      createRequestDigest(input),
      1n,
      0,
      1n,
      94,
    ).dispatch_journal;
    expect(validateDispatchedJournalAnchor(anchor)).toEqual(anchor);
    expect(() => validateDispatchedJournalAnchor({ ...anchor, unknown_alias: true }))
      .toThrow("unknown field");
    expect(() => validateDispatchedJournalAnchor({ ...anchor, signature: "short" }))
      .toThrow("Ed25519 base64url");
    expect(() => validateDispatchedJournalAnchor({ ...anchor, record_digest: digest("wrong-record") }))
      .toThrow("record digest");
    expect(() => validateDispatchedJournalAnchor({ ...anchor, frontier_digest: digest("wrong-frontier") }))
      .toThrow("frontier digest");
    expect(() => validateDispatchedJournalAnchor({
      ...anchor,
      record: { ...anchor.record, frontier_sha256: digest("forbidden-alias") },
    })).toThrow("unknown field");
  });

  test("all three signed journal wire schemas are closed JSON documents", () => {
    for (const path of [
      "schemas/dispatched-journal-anchor-v1.schema.json",
      "schemas/provider-outcome-anchor-v1.schema.json",
      "schemas/read-probe-anchor-v1.schema.json",
      "schemas/effect-journal-recovery-range-v1.schema.json",
    ]) {
      const schema = JSON.parse(readFileSync(path, "utf8")) as {
        additionalProperties?: boolean;
        required?: string[];
      };
      expect(schema.additionalProperties).toBe(false);
      if (path.includes("recovery-range")) {
        expect(schema.required).toContain("complete_operation_envelopes");
      } else {
        expect(schema.required).toContain("record");
      }
      expect(schema.required).toContain("signature");
    }
  });

  test("the exported provider boundary schema closes every PB-owned signed document", () => {
    const schema = JSON.parse(
      readFileSync("schemas/provider-boundary-v1.schema.json", "utf8"),
    ) as {
      $id: string;
      $defs: Record<string, { additionalProperties?: boolean; required?: string[] }>;
    };
    expect(schema.$id).toBe(
      "https://schemas.hasna.com/sandboxes/provider-boundary-v1.schema.json",
    );
    for (const definition of [
      "senderProof",
      "capabilityTarget",
      "capabilityConstraints",
      "authorizationConsumptionReceipt",
      "authorizationConsumptionSet",
      "capability",
      "readProbeNoEffectReceipt",
      "checkpointCaptureGrant",
      "sandboxHandleRef",
      "checkpointExportRequest",
      "checkpointQuiescenceReceipt",
      "checkpointSinkCommitReceipt",
      "checkpointExportHandoff",
    ]) {
      expect(schema.$defs[definition]?.additionalProperties).toBe(false);
      expect(schema.$defs[definition]?.required?.length).toBeGreaterThan(0);
    }
    expect(schema.$defs.authorizationConsumptionReceipt?.required)
      .toContain("commit_sequence");
    expect(schema.$defs.authorizationConsumptionReceipt?.required)
      .toContain("use_ordinal");
    expect(schema.$defs.checkpointExportHandoff?.required)
      .toContain("sink_commit_receipt");
  });

  test("canonical counters above 2^53 use exact decimal strings", () => {
    expect(canonicalJson({ journal_sequence: 9_007_199_254_740_993n }))
      .toBe('{"journal_sequence":"9007199254740993"}');
    expect(() => canonicalJson({ journal_sequence: 9_007_199_254_740_993 }))
      .toThrow("safe integers");
  });
});
