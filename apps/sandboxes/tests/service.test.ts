import { describe, expect, test } from "bun:test";
import { canonicalDigest } from "../src/canonical.js";
import {
  activationRequestDigest,
  createRequestDigest,
  lifecycleRecordRequestDigest,
  quarantineRequestDigest,
} from "../src/service.js";
import {
  activate,
  activationGrant,
  checkpointReceipt,
  cleanupContext,
  cleanupGrant,
  context,
  createInput,
  createInert,
  digest,
  harness,
  lifecycleContext,
  oid,
  recordDestroyed,
} from "./fixtures.js";

describe("reference lifecycle and adversarial invariants", () => {
  test("provider outcomes remain non-canonical until a separate Infinity record command", async () => {
    const h = harness();
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 160), request, 1n, 0, 1n, 160);
    let observedDispatchPhase = false;
    h.dispatchJournal.onAppend = () => {
      const operation = h.repository.transaction((tx) => tx.getOperation(begin.operation_id));
      expect(operation?.effect_phase).toBe("dispatched");
      expect(h.runner.calls.create_inert).toBe(0);
      expect(h.verifier.calls.dispatch_journal).toBe(0);
      observedDispatchPhase = true;
    };

    const creating = await h.service.create(input, begin);
    expect(observedDispatchPhase).toBe(true);
    expect(creating.state).toBe("creating_inert");
    expect(creating.resource_lifecycle_generation).toBe(2n);
    expect(creating.pending_provider_outcome?.target_state).toBe("inert");
    expect(h.dispatchJournal.calls).toHaveLength(1);
    expect(h.repository.transaction((tx) => tx.listExternalAnchors(begin.operation_id).map((row) => row.kind)))
      .toEqual(["dispatched", "outcome"]);

    const evidence = creating.pending_provider_outcome!.evidence_sha256;
    const recordRequest = lifecycleRecordRequestDigest("record_inert", creating.id, evidence);
    const record = lifecycleContext(
      "record_inert",
      oid("op", 161),
      recordRequest,
      creating.resource_lifecycle_generation,
      creating.revision,
      2n,
      161,
    );
    const inert = await h.service.recordInert(creating.id, evidence, record);
    expect(inert.state).toBe("inert");
    expect(inert.resource_lifecycle_generation).toBe(3n);
    expect(inert.pending_provider_outcome).toBeUndefined();
    expect(h.dispatchJournal.calls).toHaveLength(1);
  });

  test("external DISPATCHED append failure makes the provider structurally unreachable", async () => {
    const h = harness();
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 162), request, 1n, 0, 1n, 162);
    h.dispatchJournal.failure = new Error("journal unavailable");
    await expect(h.service.create(input, begin)).rejects.toThrow("journal unavailable");
    expect(h.runner.calls.create_inert).toBe(0);
    expect(h.runner.calls.lookup).toBe(0);
    expect(h.repository.transaction((tx) => tx.getOperation(begin.operation_id))?.effect_phase)
      .toBe("dispatched");
  });

  test("a future TTL is rejected before any physical safety action", async () => {
    const h = harness();
    const inert = await createInert(h);
    const before = h.physicalSafety.calls.length;
    await expect(h.service.observeExpired(inert.id)).rejects.toMatchObject({ code: "policy_denied" });
    expect(h.physicalSafety.calls).toHaveLength(before);
    expect(h.service.get(inert.id).physical_safety_state).toBe("clear");
  });

  test("create exact-adoption rejects a mismatched provider creation token", async () => {
    const h = harness(undefined, { creation_token_mismatch: true });
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 163), request, 1n, 0, 1n, 163);
    const fenced = await h.service.create(input, begin);
    expect(fenced.state).toBe("creating_inert");
    expect(fenced.pending_provider_outcome).toBeUndefined();
    expect(fenced.physical_safety_state).toBe("fenced");
    expect(fenced.physical_safety_reason).toBe("provider_identity_mismatch");
  });

  test("activation receipts bind both native fingerprint and network policy", async () => {
    for (const runnerOptions of [
      { activation_fingerprint_mismatch: true },
      { activation_policy_mismatch: true },
    ]) {
      const h = harness(undefined, runnerOptions);
      const inert = await createInert(h);
      const grant = activationGrant(inert, oid("op", runnerOptions.activation_policy_mismatch ? 165 : 164));
      const grantUse = canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 });
      const begin = context(
        "begin_activate",
        grant.operation_id,
        grant.operation_digest,
        inert.resource_lifecycle_generation,
        inert.revision,
        4n,
        runnerOptions.activation_policy_mismatch ? 165 : 164,
        inert.immutable_fingerprint_sha256!,
        grantUse,
      );
      const fenced = await h.service.activate(inert.id, grant, begin);
      expect(fenced.state).toBe("activating");
      expect(fenced.pending_provider_outcome).toBeUndefined();
      expect(fenced.physical_safety_state).toBe("fenced");
      expect(h.runner.observed_authorization_receipts.at(-1)).toBe(grantUse);
    }
  });

  test("create is inert until a separately fenced activation", async () => {
    const h = harness();
    const inert = await createInert(h);
    expect(inert.state).toBe("inert");
    expect(inert.resource_lifecycle_generation).toBe(3n);
    expect(h.runner.calls.create_inert).toBe(1);
    expect(h.runner.calls.activate).toBe(0);

    const active = await activate(h, inert);
    expect(active.state).toBe("active");
    expect(active.resource_lifecycle_generation).toBe(5n);
    expect(h.runner.calls.activate).toBe(1);
    expect(h.outcomeJournal.calls.map((call) => call.outcome)).toEqual(["succeeded", "succeeded"]);
    const activationOperation = h.repository.transaction((tx) =>
      tx.getOperation(active.activation_operation_id!),
    );
    expect(activationOperation?.effect_phase).toBe("succeeded");
    expect(activationOperation?.outcome_anchor_sha256).toMatch(/^sha256:/);
    expect(h.service.events(active.id).map((event) => event.state)).toEqual([
      "creating_inert",
      "creating_inert",
      "inert",
      "activating",
      "activating",
      "active",
    ]);
  });

  test("an exact committed operation replay returns without a second provider call", async () => {
    const h = harness();
    const inert = await createInert(h);
    const grant = activationGrant(inert);
    const ctx = context(
      "begin_activate",
      grant.operation_id,
      grant.operation_digest,
      inert.resource_lifecycle_generation,
      inert.revision,
      2n,
      21,
      inert.immutable_fingerprint_sha256!,
      (await import("../src/canonical.js")).canonicalDigest({
        id: grant.grant_id,
        nonce: grant.one_use_nonce_sha256,
      }),
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
    const stale = context(
      "begin_activate",
      grant.operation_id,
      request,
      1n,
      inert.revision,
      2n,
      21,
      digest("target-fingerprint-21"),
      (await import("../src/canonical.js")).canonicalDigest({
        id: grant.grant_id,
        nonce: grant.one_use_nonce_sha256,
      }),
    );
    await expect(h.service.activate(inert.id, grant, stale)).rejects.toMatchObject({
      code: "stale_resource_lifecycle_generation",
    });
    expect(h.runner.calls.activate).toBe(0);
  });

  test("CASes Infinity's adjacent successor before the provider observes the effect", async () => {
    const h = harness();
    const inert = await createInert(h);
    const active = await activate(h, inert);
    expect(active.resource_lifecycle_generation).toBe(5n);
    expect(h.runner.observed_generations).toEqual([2n, 4n]);
  });

  test("rejects a non-adjacent Infinity successor before provider contact", async () => {
    const h = harness();
    const input = (await import("./fixtures.js")).createInput();
    const { createRequestDigest, dispatchedJournalAnchorDigest } = await import("../src/service.js");
    const request = createRequestDigest(input);
    const ctx = context("begin_create_inert", oid("op", 60), request, 1n, 0, 1n, 60);
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
    const ctx = context("begin_create_inert", oid("op", 61), request, 1n, 0, 1n, 61);
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
    expect(h.physicalSafety.calls).toEqual([{ resource_id: active.id, reason: "deadline" }]);
    expect(h.physicalSafety.observations[0]).toMatchObject({
      schema_version: "sandboxes.safety-fence/v1",
      resource_id: active.id,
      resource_lifecycle_generation: active.resource_lifecycle_generation,
      reason: "deadline",
    });
    expect(physicallyFenced.safety_fence_receipt_sha256)
      .toBe(canonicalDigest(h.physicalSafety.observations[0]!));
    expect(h.runner.calls.destroy).toBe(0);
    const operationId = oid("op", 52);
    const request = quarantineRequestDigest(active.id, active.expires_at);
    const quarantineContext = lifecycleContext(
      "quarantine",
      operationId,
      request,
      physicallyFenced.resource_lifecycle_generation,
      physicallyFenced.revision,
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
    const destroying = await h.service.destroy(withReceipt.id, allowed, cleanupContext(withReceipt, allowed));
    expect(destroying.state).toBe("destroying");
    const destroyed = await recordDestroyed(h, destroying);
    expect(destroyed.state).toBe("destroyed");
    expect(destroyed.terminal_disposition).toBe("destroyed_after_checkpoint");
    expect(h.runner.calls.destroy).toBe(1);
  });

  test("checkpoint and promotion receipts bind the full current resource fence", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const checkpoint = checkpointReceipt(active);
    await expect(h.service.recordCheckpointReceipt(active.id, {
      ...checkpoint,
      fence: { ...checkpoint.fence, route_id: oid("route", 999) },
    })).rejects.toMatchObject({ code: "cleanup_receipt_mismatch" });

    const attached = await h.service.recordCheckpointReceipt(active.id, checkpoint);
    const promotion = {
      schema_version: attached.schema_version,
      receipt_id: oid("receipt", 171),
      resource_id: attached.id,
      run_id: attached.run_id,
      attempt_id: attached.attempt_id,
      resource_lifecycle_generation: attached.resource_lifecycle_generation,
      fence: checkpoint.fence,
      receipt_sha256: digest("promotion-receipt-171"),
      checkpoint_root_sha256: checkpoint.checkpoint_root_sha256,
      expected_base_sha256: digest("promotion-base-171"),
      promoted_at: "2030-01-01T00:02:00.000Z",
    };
    await expect(h.service.recordGitPromotionReceipt(attached.id, {
      ...promotion,
      resource_id: oid("sbx", 999),
    })).rejects.toMatchObject({ code: "cleanup_receipt_mismatch" });
    const promoted = await h.service.recordGitPromotionReceipt(attached.id, promotion);
    expect(promoted.git_promotion_receipt_sha256).toContain(promotion.receipt_sha256);
  });

  test("uncheckpointed discard is only the exact Infinity passkey exception and remains permanent", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const grant = cleanupGrant(active, {
      kind: "discard_uncheckpointed",
      receipt_sha256: digest("fresh-passkey-consequence-receipt"),
      recovery_checkpoint_attempted: true,
      promotion_grants_revoked: true,
      permanent_outcome: "discarded_uncheckpointed",
    });
    const destroying = await h.service.destroy(active.id, grant, cleanupContext(active, grant));
    expect(destroying.state).toBe("destroying");
    const destroyed = await recordDestroyed(h, destroying);
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
    expect(h.readProbeJournal.calls).toHaveLength(1);
    expect(h.repository.transaction((tx) => tx.listExternalAnchors(oid("op", 20)).map((row) => row.kind)))
      .toContain("read_probe");
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
    expect(recovered.physical_safety_state).toBe("fenced");
    expect(h.runner.calls.create_inert).toBe(1);
    expect(h.runner.calls.lookup).toBe(2);
  });

  test("provider identity replacement quarantines before delete", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    h.runner.replaceFingerprint(active.id);
    const grant = cleanupGrant(active, {
      kind: "discard_uncheckpointed",
      receipt_sha256: digest("passkey-exact"),
      recovery_checkpoint_attempted: true,
      promotion_grants_revoked: true,
      permanent_outcome: "discarded_uncheckpointed",
    });
    const result = await h.service.destroy(active.id, grant, cleanupContext(active, grant));
    expect(result.state).toBe("destroying");
    expect(result.physical_safety_state).toBe("fenced");
    expect(result.physical_safety_reason).toBe("provider_identity_mismatch");
    expect(h.physicalSafety.calls).toEqual([
      { resource_id: active.id, reason: "provider_ambiguous" },
    ]);
    expect(h.runner.calls.destroy).toBe(0);
  });

  test("capability nonce replay across operations is rejected", async () => {
    const h = harness();
    const inert = await createInert(h);
    const grant = activationGrant(inert);
    const request = activationRequestDigest(inert.id, inert.spec.network_policy.policy_sha256);
    const ctx = context(
      "begin_activate",
      grant.operation_id,
      request,
      inert.resource_lifecycle_generation,
      inert.revision,
      2n,
      20,
      inert.immutable_fingerprint_sha256!,
      (await import("../src/canonical.js")).canonicalDigest({
        id: grant.grant_id,
        nonce: grant.one_use_nonce_sha256,
      }),
    );
    ctx.capability.capability_id = oid("cap", 20);
    ctx.capability.use_nonce_sha256 = digest("capability-nonce-20");
    const { canonicalDigest } = await import("../src/canonical.js");
    const { dispatchedJournalAnchorDigest } = await import("../src/service.js");
    await expect(h.service.activate(inert.id, grant, ctx)).rejects.toMatchObject({
      code: "capability_replayed",
    });
    expect(h.runner.calls.activate).toBe(0);
  });
});
