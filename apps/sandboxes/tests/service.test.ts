import { describe, expect, test } from "bun:test";
import { SandboxError } from "../src/errors.js";
import { activationRequestDigest, quarantineRequestDigest } from "../src/service.js";
import {
  activate,
  activationGrant,
  checkpointReceipt,
  cleanupContext,
  cleanupGrant,
  context,
  createInert,
  digest,
  harness,
  oid,
} from "./fixtures.js";

describe("reference lifecycle and adversarial invariants", () => {
  test("create is inert until a separately fenced activation", async () => {
    const h = harness();
    const inert = await createInert(h);
    expect(inert.state).toBe("inert");
    expect(inert.resource_lifecycle_generation).toBe(2n);
    expect(h.runner.calls.create_inert).toBe(1);
    expect(h.runner.calls.activate).toBe(0);

    const active = await activate(h, inert);
    expect(active.state).toBe("active");
    expect(active.resource_lifecycle_generation).toBe(3n);
    expect(h.runner.calls.activate).toBe(1);
    expect(h.service.events(active.id).map((event) => event.state)).toEqual([
      "creating_inert",
      "inert",
      "activating",
      "active",
    ]);
  });

  test("an exact committed operation replay returns without a second provider call", async () => {
    const h = harness();
    const inert = await createInert(h);
    const grant = activationGrant(inert);
    const ctx = context(
      "activate",
      grant.operation_id,
      grant.operation_digest,
      inert.resource_lifecycle_generation,
      inert.revision,
      2n,
      21,
    );
    const first = await h.service.activate(inert.id, grant, ctx);
    const replay = await h.service.activate(inert.id, grant, ctx);
    expect(replay).toEqual(first);
    expect(h.runner.calls.activate).toBe(1);
  });

  test("rejects a stale resource fence before the runner call", async () => {
    const h = harness();
    const inert = await createInert(h);
    const grant = {
      ...activationGrant(inert),
      resource_lifecycle_generation: 1n,
      post_resource_lifecycle_generation: 2n,
    };
    const request = activationRequestDigest(inert.id, inert.spec.network_policy.policy_sha256);
    const stale = context("activate", grant.operation_id, request, 1n, inert.revision, 2n, 21);
    await expect(h.service.activate(inert.id, grant, stale)).rejects.toMatchObject({
      code: "stale_resource_lifecycle_generation",
    });
    expect(h.runner.calls.activate).toBe(0);
  });

  test("persists Infinity's exact post-generation without choosing the value locally", async () => {
    const h = harness();
    const inert = await createInert(h);
    const grant = {
      ...activationGrant(inert),
      post_resource_lifecycle_generation: 10n,
    };
    const request = activationRequestDigest(inert.id, inert.spec.network_policy.policy_sha256);
    const ctx = context(
      "activate",
      grant.operation_id,
      request,
      inert.resource_lifecycle_generation,
      inert.revision,
      2n,
      21,
    );
    ctx.transition.post_resource_lifecycle_generation = 10n;
    ctx.dispatch_journal.post_resource_lifecycle_generation = 10n;
    const { dispatchedJournalAnchorDigest } = await import("../src/service.js");
    ctx.dispatch_journal.anchor_sha256 = dispatchedJournalAnchorDigest(ctx.dispatch_journal);
    ctx.capability.dispatch_journal_anchor_sha256 = ctx.dispatch_journal.anchor_sha256;
    const active = await h.service.activate(inert.id, grant, ctx);
    expect(active.resource_lifecycle_generation).toBe(10n);
  });

  test("rejects a changed DISPATCHED journal anchor before any provider effect", async () => {
    const h = harness();
    const input = (await import("./fixtures.js")).createInput();
    const { createRequestDigest } = await import("../src/service.js");
    const request = createRequestDigest(input);
    const ctx = context("create_inert", oid("op", 61), request, 1n, 0, 1n, 61);
    ctx.dispatch_journal.post_resource_lifecycle_generation = 99n;
    await expect(h.service.create(input, ctx)).rejects.toMatchObject({ code: "integrity_failed" });
    expect(h.runner.calls.create_inert).toBe(0);
    expect(h.verifier.calls.dispatch_journal).toBe(0);
  });

  test("TTL expiry quarantines without granting destruction", async () => {
    const h = harness();
    const inert = await createInert(h, "2029-12-31T23:59:59.000Z");
    const active = await activate(h, inert);
    expect(h.service.expiredCandidates()).toHaveLength(1);
    const operationId = oid("op", 52);
    const request = quarantineRequestDigest(active.id, active.expires_at);
    const quarantineContext = context(
      "quarantine",
      operationId,
      request,
      active.resource_lifecycle_generation,
      active.revision,
      3n,
      52,
    );
    const finding = await h.service.reconcileExpired(active.id, quarantineContext);
    expect(finding.kind).toBe("ttl_expired");
    expect(h.service.get(active.id).state).toBe("quarantined");
    expect(h.runner.calls.destroy).toBe(0);
  });

  test("cleanup fails closed until the exact durable checkpoint receipt is attached", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const missingBasis = digest("missing-checkpoint-receipt");
    const denied = cleanupGrant(active, { kind: "checkpoint_durable", receipt_sha256: missingBasis });
    await expect(h.service.destroy(active.id, denied, cleanupContext(active, denied))).rejects.toMatchObject({
      code: "checkpoint_not_durable",
    });
    expect(h.runner.calls.destroy).toBe(0);

    const withReceipt = await h.service.recordCheckpointReceipt(active.id, checkpointReceipt(active));
    const allowed = cleanupGrant(withReceipt, {
      kind: "checkpoint_durable",
      receipt_sha256: checkpointReceipt(active).receipt_sha256,
    });
    const destroyed = await h.service.destroy(withReceipt.id, allowed, cleanupContext(withReceipt, allowed));
    expect(destroyed.state).toBe("destroyed");
    expect(destroyed.terminal_disposition).toBe("destroyed_after_checkpoint");
    expect(h.runner.calls.destroy).toBe(1);
  });

  test("uncheckpointed discard is only the exact Infinity passkey exception and remains permanent", async () => {
    const h = harness();
    const inert = await createInert(h);
    const grant = cleanupGrant(inert, {
      kind: "discard_uncheckpointed",
      receipt_sha256: digest("fresh-passkey-consequence-receipt"),
      recovery_checkpoint_attempted: true,
      promotion_grants_revoked: true,
      permanent_outcome: "discarded_uncheckpointed",
    });
    const destroyed = await h.service.destroy(inert.id, grant, cleanupContext(inert, grant));
    expect(destroyed.state).toBe("destroyed");
    expect(destroyed.terminal_disposition).toBe("discarded_uncheckpointed");
    expect(h.runner.calls.destroy).toBe(1);
  });

  test("ambiguous inert creation exact-adopts by operation token without duplicate creation", async () => {
    const h = harness(undefined, { ambiguous_create: "adoptable" });
    const inert = await createInert(h);
    expect(inert.state).toBe("inert");
    expect(h.runner.calls.create_inert).toBe(1);
    expect(h.runner.calls.lookup).toBe(1);
  });

  test("unresolved inert creation quarantines and is never blindly retried", async () => {
    const h = harness(undefined, { ambiguous_create: "unknown" });
    const quarantined = await createInert(h);
    expect(quarantined.state).toBe("quarantined");
    expect(quarantined.state_reason_code).toBe("ambiguous_provider_state");
    expect(h.runner.calls.create_inert).toBe(1);
    expect(h.service.resolveOperation(oid("op", 20)).state).toBe("unknown");
  });

  test("provider identity replacement quarantines before delete", async () => {
    const h = harness();
    const inert = await createInert(h);
    h.runner.replaceFingerprint(inert.id);
    const grant = cleanupGrant(inert, {
      kind: "discard_uncheckpointed",
      receipt_sha256: digest("passkey-exact"),
      recovery_checkpoint_attempted: true,
      promotion_grants_revoked: true,
      permanent_outcome: "discarded_uncheckpointed",
    });
    const result = await h.service.destroy(inert.id, grant, cleanupContext(inert, grant));
    expect(result.state).toBe("quarantined");
    expect(result.state_reason_code).toBe("provider_identity_mismatch");
    expect(h.runner.calls.destroy).toBe(0);
  });

  test("capability nonce replay across operations is rejected", async () => {
    const h = harness();
    const inert = await createInert(h);
    const grant = activationGrant(inert);
    const request = activationRequestDigest(inert.id, inert.spec.network_policy.policy_sha256);
    const ctx = context("activate", grant.operation_id, request, inert.resource_lifecycle_generation, inert.revision, 2n, 20);
    ctx.capability.capability_id = oid("cap", 20);
    ctx.capability.use_nonce_sha256 = digest("capability-nonce-20");
    await expect(h.service.activate(inert.id, grant, ctx)).rejects.toBeInstanceOf(SandboxError);
    expect(h.runner.calls.activate).toBe(0);
  });
});
