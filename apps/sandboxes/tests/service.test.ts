import { describe, expect, test } from "bun:test";
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
    expect(h.outcomeJournal.calls.map((call) => call.outcome)).toEqual(["succeeded", "succeeded"]);
    const activationOperation = h.repository.transaction((tx) =>
      tx.getOperation(active.activation_operation_id!),
    );
    expect(activationOperation?.effect_phase).toBe("succeeded");
    expect(activationOperation?.outcome_anchor_sha256).toMatch(/^sha256:/);
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
      inert.immutable_fingerprint_sha256!,
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
      successor_resource_lifecycle_generation: 2n,
    };
    const request = activationRequestDigest(inert.id, inert.spec.network_policy.policy_sha256);
    const stale = context("activate", grant.operation_id, request, 1n, inert.revision, 2n, 21);
    await expect(h.service.activate(inert.id, grant, stale)).rejects.toMatchObject({
      code: "stale_resource_lifecycle_generation",
    });
    expect(h.runner.calls.activate).toBe(0);
  });

  test("CASes Infinity's adjacent successor before the provider observes the effect", async () => {
    const h = harness();
    const inert = await createInert(h);
    const active = await activate(h, inert);
    expect(active.resource_lifecycle_generation).toBe(3n);
    expect(h.runner.observed_generations).toEqual([2n, 3n]);
  });

  test("rejects a non-adjacent Infinity successor before provider contact", async () => {
    const h = harness();
    const input = (await import("./fixtures.js")).createInput();
    const { createRequestDigest, dispatchedJournalAnchorDigest } = await import("../src/service.js");
    const request = createRequestDigest(input);
    const ctx = context("create_inert", oid("op", 60), request, 1n, 0, 1n, 60);
    ctx.transition.successor_resource_lifecycle_generation = 10n;
    ctx.dispatch_journal.successor_resource_lifecycle_generation = 10n;
    ctx.dispatch_journal.anchor_sha256 = dispatchedJournalAnchorDigest(ctx.dispatch_journal);
    ctx.capability.dispatch_journal_anchor_sha256 = ctx.dispatch_journal.anchor_sha256;
    await expect(h.service.create(input, ctx)).rejects.toThrow("exactly expected plus one");
    expect(h.runner.calls.create_inert).toBe(0);
  });

  test("rejects a changed DISPATCHED journal anchor before any provider effect", async () => {
    const h = harness();
    const input = (await import("./fixtures.js")).createInput();
    const { createRequestDigest } = await import("../src/service.js");
    const request = createRequestDigest(input);
    const ctx = context("create_inert", oid("op", 61), request, 1n, 0, 1n, 61);
    ctx.dispatch_journal.successor_resource_lifecycle_generation = 99n;
    await expect(h.service.create(input, ctx)).rejects.toMatchObject({ code: "validation_failed" });
    expect(h.runner.calls.create_inert).toBe(0);
    expect(h.verifier.calls.dispatch_journal).toBe(0);
  });

  test("TTL expiry quarantines without granting destruction", async () => {
    const h = harness();
    const inert = await createInert(h, "2029-12-31T23:59:59.000Z");
    const active = await activate(h, inert);
    expect(h.service.expiredCandidates()).toHaveLength(1);
    const observation = await h.service.observeExpired(active.id);
    expect(observation.disposition).toBe("operator_review");
    const physicallyFenced = h.service.get(active.id);
    expect(physicallyFenced.state).toBe("active");
    expect(physicallyFenced.resource_lifecycle_generation).toBe(active.resource_lifecycle_generation);
    expect(physicallyFenced.physical_safety_state).toBe("fenced");
    expect(h.physicalSafety.calls).toEqual([{ resource_id: active.id, reason: "ttl_expired" }]);
    expect(h.runner.calls.destroy).toBe(0);
    const operationId = oid("op", 52);
    const request = quarantineRequestDigest(active.id, active.expires_at);
    const quarantineContext = context(
      "quarantine",
      operationId,
      request,
      physicallyFenced.resource_lifecycle_generation,
      physicallyFenced.revision,
      3n,
      52,
      physicallyFenced.immutable_fingerprint_sha256!,
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

  test("unresolved inert creation safety-fences locally and is never blindly retried", async () => {
    const h = harness(undefined, { ambiguous_create: "unknown" });
    const fenced = await createInert(h);
    expect(fenced.state).toBe("creating_inert");
    expect(fenced.physical_safety_state).toBe("fenced");
    expect(fenced.physical_safety_reason).toBe("provider_ambiguous");
    expect(fenced.canonical_transition_required).toBe("quarantined");
    expect(h.physicalSafety.calls).toEqual([
      { resource_id: fenced.id, reason: "provider_ambiguous" },
    ]);
    expect(h.runner.calls.create_inert).toBe(1);
    expect(h.service.resolveOperation(oid("op", 20)).state).toBe("unknown");
  });

  test("restart replay reconciles a dispatched create by exact target without creating twice", async () => {
    const h = harness(undefined, { ambiguous_create: "delayed" });
    const first = await createInert(h);
    expect(first.physical_safety_state).toBe("fenced");
    const recovered = await createInert(h);
    expect(recovered.state).toBe("inert");
    expect(recovered.physical_safety_state).toBe("clear");
    expect(h.runner.calls.create_inert).toBe(1);
    expect(h.runner.calls.lookup).toBe(2);
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
    expect(result.state).toBe("destroying");
    expect(result.physical_safety_state).toBe("fenced");
    expect(result.physical_safety_reason).toBe("provider_identity_mismatch");
    expect(h.physicalSafety.calls).toEqual([
      { resource_id: inert.id, reason: "provider_identity_mismatch" },
    ]);
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
    const { canonicalDigest } = await import("../src/canonical.js");
    const { dispatchedJournalAnchorDigest } = await import("../src/service.js");
    ctx.dispatch_journal.authorization_consumption_receipt_sha256 = canonicalDigest({
      capability_id: ctx.capability.capability_id,
      nonce: ctx.capability.use_nonce_sha256,
    });
    ctx.dispatch_journal.anchor_sha256 = dispatchedJournalAnchorDigest(ctx.dispatch_journal);
    ctx.capability.dispatch_journal_anchor_sha256 = ctx.dispatch_journal.anchor_sha256;
    await expect(h.service.activate(inert.id, grant, ctx)).rejects.toMatchObject({
      code: "capability_replayed",
    });
    expect(h.runner.calls.activate).toBe(0);
  });
});
