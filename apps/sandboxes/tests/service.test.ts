import { describe, expect, test } from "bun:test";
import { canonicalDigest } from "../src/canonical.js";
import { AesGcmProviderHandleSealerV1 } from "../src/handle-sealer.js";
import {
  adapterDescriptorDigest,
  providerHandleBindingDigest,
} from "../src/provider-identity.js";
import { InMemorySandboxRepositoryV1 } from "../src/repository-memory.js";
import type { SandboxRepositoryTxV1 } from "../src/repository.js";
import type { SandboxRunnerV1 } from "../src/runner.js";
import {
  activationRequestDigest,
  createRequestDigest,
  dispatchedJournalAnchorDigest,
  effectJournalFrontierDigest,
  effectJournalRecordDigest,
  lifecycleRecordRequestDigest,
  providerIdempotencyTokenDigest,
  quarantineRequestDigest,
  SandboxesReferenceServiceV1,
} from "../src/service.js";
import type { ProviderHandleBindingV1 } from "../src/types.js";
import {
  activate,
  activationGrant,
  CLOCK,
  checkpointReceipt,
  cleanupContext,
  cleanupGrant,
  context,
  createInput,
  createInert,
  digest,
  expireContext,
  harness,
  lifecycleContext,
  oid,
  recordDestroyed,
  retryContext,
} from "./fixtures.js";

class CrashBeforeProviderProjectionRepositoryV1 extends InMemorySandboxRepositoryV1 {
  #transactionsUntilCrash: number | undefined;

  armAfterOutcomeAppend(): void {
    // The first transaction persists the authenticated external OUTCOME anchor;
    // the second is the local success projection that this fixture crashes.
    this.#transactionsUntilCrash = 2;
  }

  override async transaction<T>(fn: (tx: SandboxRepositoryTxV1) => T): Promise<T> {
    if (this.#transactionsUntilCrash !== undefined) {
      this.#transactionsUntilCrash -= 1;
      if (this.#transactionsUntilCrash === 0) {
        this.#transactionsUntilCrash = undefined;
        throw new Error("simulated crash after signed outcome before local projection");
      }
    }
    return await super.transaction(fn);
  }
}

describe("reference lifecycle and adversarial invariants", () => {
  test("provider outcomes remain non-canonical until a separate Infinity record command", async () => {
    const h = harness();
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 160), request, 1n, 0, 1n, 160);
    let observedDispatchPhase = false;
    h.dispatchJournal.onAppend = async () => {
      const operation = await h.repository.transaction((tx) => tx.getOperation(begin.operation_id));
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
    expect(await h.repository.transaction((tx) => tx.listExternalAnchors(begin.operation_id).map((row) =>
      "record_kind" in row ? row.record_kind : row.anchor_kind
    )))
      .toEqual(["DISPATCHED", "READ_PROBE", "OUTCOME"]);

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
    expect((await h.repository.transaction((tx) => tx.getOperation(begin.operation_id)))?.effect_phase)
      .toBe("dispatched");
  });

  test("signed head/range non-inclusion recovers a DB-dispatched crash before external append", async () => {
    const h = harness();
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 227), request, 1n, 0, 1n, 227);
    h.dispatchJournal.failure = new Error("crash before external append commit");
    await expect(h.service.create(input, begin)).rejects.toThrow("crash before external append commit");
    expect(h.runner.calls.create_inert).toBe(0);
    h.dispatchJournal.failure = undefined;
    const recovered = await h.service.create(input, begin);
    expect(recovered.pending_provider_outcome?.target_state).toBe("inert");
    expect(h.runner.calls.create_inert).toBe(1);
  });

  test("a stale signed empty-range replay cannot reopen a DB-dispatched operation", async () => {
    const h = harness();
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 239), request, 1n, 0, 1n, 239);
    h.dispatchJournal.failure = new Error("crash before authoritative append");
    await expect(h.service.create(input, begin)).rejects.toThrow("crash before authoritative append");
    const staleRange = await h.journalRecovery.readOperationStepRange({
      operation_id: begin.operation_id,
      operation_step_id: begin.dispatch_journal.record.operation_step_id,
      requested_from_sequence: begin.dispatch_journal.journal_sequence,
    });
    const unrelated = context(
      "begin_create_inert",
      oid("op", 240),
      request,
      1n,
      0,
      1n,
      240,
    ).dispatch_journal;
    h.journalRecovery.ledger.record(unrelated);
    h.journalRecovery.readOperationStepRange = async () => structuredClone(staleRange);
    h.dispatchJournal.failure = undefined;

    await expect(h.service.create(input, begin)).rejects.toMatchObject({ code: "integrity_failed" });
    expect(h.runner.calls.create_inert).toBe(0);
    expect((await h.repository.transaction((tx) => tx.getOperation(begin.operation_id)))?.effect_phase)
      .toBe("dispatched");
  });

  test("untrusted or non-member signed frontier blocks provider reachability", async () => {
    const h = harness();
    h.verifier.stored_frontier_membership_valid = false;
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 225), request, 1n, 0, 1n, 225);
    await expect(h.service.create(input, begin)).rejects.toMatchObject({ code: "integrity_failed" });
    expect(h.runner.calls.create_inert).toBe(0);
  });

  test("resource revision changed while DISPATCHED is appended blocks provider reachability", async () => {
    const h = harness();
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 216), request, 1n, 0, 1n, 216);
    h.dispatchJournal.onAppend = async () => {
      await h.repository.transaction((tx) => {
        const current = tx.getSandbox(input.resource_id)!;
        tx.putSandbox({
          ...current,
          revision: current.revision + 1,
          physical_safety_state: "fenced",
          physical_safety_reason: "provider_ambiguous",
        }, current.revision);
      });
    };

    await expect(h.service.create(input, begin)).rejects.toMatchObject({ code: "stale_revision" });
    expect(h.runner.calls.create_inert).toBe(0);
    expect((await h.repository.transaction((tx) => tx.getOperation(begin.operation_id)))?.effect_phase)
      .toBe("dispatched");
  });

  test("physical safety gate closed after DISPATCHED append blocks provider reachability", async () => {
    const h = harness();
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 217), request, 1n, 0, 1n, 217);
    h.dispatchJournal.onAppend = () => {
      void h.physicalSafety.fenceResource({
        resource_id: input.resource_id,
        resource_lifecycle_generation: 2n,
        reason: "deadline",
        observed_at: "2030-01-01T00:00:00.000Z",
      });
    };

    await expect(h.service.create(input, begin)).rejects.toThrow("physical safety dispatch gate is closed");
    expect(h.runner.calls.create_inert).toBe(0);
  });

  test("failed_no_effect alone permits the same semantic step at exactly epoch N plus one", async () => {
    const h = harness(undefined, { verified_reject_create_no_effect_attempts: 1 });
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 218), request, 1n, 0, 1n, 218);

    await expect(h.service.create(input, begin)).rejects.toMatchObject({ code: "provider_unavailable" });
    const failed = await h.service.get(input.resource_id);
    expect(failed.pending_provider_outcome?.target_state).toBe("failed");
    expect((await h.repository.transaction((tx) => tx.getOperation(begin.operation_id)))?.effect_phase)
      .toBe("failed_no_effect");
    expect(
      h.outcomeJournal.calls.find((call) => call.outcome_kind === "failed_no_effect")
        ?.provider_no_effect_verification_receipt_sha256,
    ).toMatch(/^sha256:/);

    const retry = retryContext(begin, failed.revision, 2n, 219);
    const creating = await h.service.create(input, retry);
    expect(creating.pending_provider_outcome?.target_state).toBe("inert");
    expect(h.runner.calls.create_inert).toBe(2);
    expect(h.dispatchJournal.calls.map((anchor) => anchor.record.operation_execution_epoch))
      .toEqual([1n, 2n]);
    expect(h.dispatchJournal.calls[1]?.record.operation_step_id)
      .toBe(h.dispatchJournal.calls[0]?.record.operation_step_id);
    expect(h.dispatchJournal.calls[1]?.record.provider_idempotency_token_sha256)
      .toBe(h.dispatchJournal.calls[0]?.record.provider_idempotency_token_sha256);
    expect(h.dispatchJournal.calls[1]?.record.authorization_consumption_receipt_sha256)
      .toBe(h.dispatchJournal.calls[0]?.record.authorization_consumption_receipt_sha256);
    expect(await h.repository.transaction((tx) => tx.listExternalAnchors(begin.operation_id).map((record) =>
      `${"record_kind" in record ? record.record_kind : record.anchor_kind}:${record.operation_execution_epoch}`
    ))).toEqual(["DISPATCHED:1", "OUTCOME:1", "DISPATCHED:2", "READ_PROBE:2", "OUTCOME:2"]);
  });

  test("an adapter-labelled rejection without trusted non-acceptance proof remains unresolved", async () => {
    const h = harness(undefined, { reject_create_no_effect_attempts: 1 });
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 233), request, 1n, 0, 1n, 233);

    const unresolved = await h.service.create(input, begin);
    expect(unresolved.physical_safety_state).toBe("fenced");
    expect(unresolved.pending_provider_outcome).toBeUndefined();
    expect((await h.repository.transaction((tx) => tx.getOperation(begin.operation_id)))?.effect_phase)
      .toBe("unknown");
    expect(h.outcomeJournal.calls.some((call) => call.outcome_kind === "failed_no_effect"))
      .toBe(false);
  });

  test("failed_no_effect retry rejects a changed immutable provider target", async () => {
    const h = harness(undefined, { verified_reject_create_no_effect_attempts: 1 });
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 220), request, 1n, 0, 1n, 220);
    await expect(h.service.create(input, begin)).rejects.toMatchObject({ code: "provider_unavailable" });
    const failed = await h.service.get(input.resource_id);
    const retry = retryContext(begin, failed.revision, 2n, 221);
    const changedRecord = {
      ...retry.dispatch_journal.record,
      provider_idempotency_token_sha256: digest("changed-provider-token"),
    };
    const changedCore = {
      ...retry.dispatch_journal,
      record_digest: effectJournalRecordDigest(changedRecord),
      record: changedRecord,
    };
    const changedAnchor = {
      ...changedCore,
      frontier_digest: effectJournalFrontierDigest(changedCore),
      signature: "E".repeat(86),
    };
    const changed = {
      ...retry,
      dispatch_journal: changedAnchor,
      capability: {
        ...retry.capability,
        dispatch_journal_anchor_sha256: dispatchedJournalAnchorDigest(changedAnchor),
      },
    };

    await expect(h.service.create(input, changed)).rejects.toMatchObject({ code: "integrity_failed" });
    expect(h.runner.calls.create_inert).toBe(1);
    expect(h.dispatchJournal.calls).toHaveLength(1);
  });

  test("failed_no_effect retry requires an online full signed OUTCOME envelope", async () => {
    const h = harness(undefined, { verified_reject_create_no_effect_attempts: 1 });
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 223), request, 1n, 0, 1n, 223);
    await expect(h.service.create(input, begin)).rejects.toMatchObject({ code: "provider_unavailable" });
    const prior = await h.repository.transaction((tx) => tx.getOperation(begin.operation_id));
    expect(prior?.outcome_anchor_sha256).toMatch(/^sha256:/);
    h.outcomeJournal.forgetOutcome(prior!.outcome_anchor_sha256!);
    const failed = await h.service.get(input.resource_id);
    const retry = retryContext(begin, failed.revision, 2n, 224);
    await expect(h.service.create(input, retry)).rejects.toMatchObject({ code: "provider_state_unknown" });
    expect(h.runner.calls.create_inert).toBe(1);
    expect(h.dispatchJournal.calls).toHaveLength(1);
  });

  test("failed_no_effect retry rejects a member without signed head/range completeness", async () => {
    const h = harness(undefined, { verified_reject_create_no_effect_attempts: 1 });
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 229), request, 1n, 0, 1n, 229);
    await expect(h.service.create(input, begin)).rejects.toMatchObject({ code: "provider_unavailable" });
    const failed = await h.service.get(input.resource_id);
    h.verifier.journal_range_completeness_valid = false;
    await expect(h.service.create(input, retryContext(begin, failed.revision, 2n, 230)))
      .rejects.toMatchObject({ code: "integrity_failed" });
    expect(h.runner.calls.create_inert).toBe(1);
  });

  test("effect journal outcome schema mismatch fails before durable intent or provider contact", async () => {
    const h = harness();
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 222), request, 1n, 0, 1n, 222);
    const changedRecord = {
      ...begin.dispatch_journal.record,
      outcome_schema_digest: digest("foreign-outcome-schema"),
    };
    const changedCore = {
      ...begin.dispatch_journal,
      record_digest: effectJournalRecordDigest(changedRecord),
      record: changedRecord,
    };
    const changedAnchor = {
      ...changedCore,
      frontier_digest: effectJournalFrontierDigest(changedCore),
      signature: "F".repeat(86),
    };
    const changed = {
      ...begin,
      dispatch_journal: changedAnchor,
      capability: {
        ...begin.capability,
        dispatch_journal_anchor_sha256: dispatchedJournalAnchorDigest(changedAnchor),
      },
    };
    await expect(h.service.create(input, changed)).rejects.toMatchObject({ code: "protocol_incompatible" });
    expect(h.runner.calls.create_inert).toBe(0);
    expect(await h.repository.transaction((tx) => tx.getOperation(begin.operation_id))).toBeUndefined();
  });

  test("a future TTL is rejected before any physical safety action", async () => {
    const h = harness();
    const inert = await createInert(h);
    const before = h.physicalSafety.calls.length;
    await expect(h.service.observeExpired(inert.id)).rejects.toMatchObject({ code: "policy_denied" });
    expect(h.physicalSafety.calls).toHaveLength(before);
    expect((await h.service.get(inert.id)).physical_safety_state).toBe("clear");
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

  test("create rejects a self-consistent handle from a foreign resource kind", async () => {
    const h = harness(undefined, { resource_kind_override: "container" });
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 245), request, 1n, 0, 1n, 245);

    const result = await h.service.create(input, begin);
    expect(result.physical_safety_state).toBe("fenced");
    expect(result.pending_provider_outcome).toBeUndefined();
    expect(h.outcomeJournal.calls).toHaveLength(0);
  });

  test("create rejects a self-consistent journal token not derived from the actual allocation and spec", async () => {
    const h = harness();
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 226), request, 1n, 0, 1n, 226);
    const changedCreationToken = digest("foreign-allocation-derived-creation-token");
    const changedRecordBase = {
      ...begin.dispatch_journal.record,
      provider_creation_token_sha256: changedCreationToken,
    };
    const changedRecord = {
      ...changedRecordBase,
      provider_idempotency_token_sha256: providerIdempotencyTokenDigest({
        operation_id: changedRecordBase.operation_id,
        operation_step_id: changedRecordBase.operation_step_id,
        operation_digest: changedRecordBase.operation_digest,
        resource_id: changedRecordBase.resource_id,
        provider_creation_token_sha256: changedCreationToken,
      }),
    };
    const changedCore = {
      ...begin.dispatch_journal,
      record_digest: effectJournalRecordDigest(changedRecord),
      record: changedRecord,
    };
    const changedAnchor = {
      ...changedCore,
      frontier_digest: effectJournalFrontierDigest(changedCore),
      signature: "G".repeat(86),
    };
    await expect(h.service.create(input, {
      ...begin,
      dispatch_journal: changedAnchor,
      capability: {
        ...begin.capability,
        dispatch_journal_anchor_sha256: dispatchedJournalAnchorDigest(changedAnchor),
      },
    })).rejects.toMatchObject({ code: "request_digest_mismatch" });
    expect(h.runner.calls.create_inert).toBe(0);
    expect(await h.repository.transaction((tx) => tx.getOperation(begin.operation_id))).toBeUndefined();
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
    expect(h.outcomeJournal.calls.map((call) => call.outcome_kind)).toEqual(["succeeded", "succeeded"]);
    expect(h.lifecycleLock.bindings).toHaveLength(4);
    expect(new Set(h.lifecycleLock.bindings.map((binding) => binding.lock_key_sha256)).size).toBe(1);
    expect(h.lifecycleLock.bindings[0]?.bound_provider_identity).toBeUndefined();
    expect(h.lifecycleLock.bindings.find((binding) => binding.bound_provider_identity !== undefined)
      ?.bound_provider_identity?.opaque_resource_id).toMatch(/^native-/);
    expect(h.dispatchJournal.calls[0]?.record.provider_idempotency_token_sha256)
      .not.toBe(h.dispatchJournal.calls[1]?.record.provider_idempotency_token_sha256);
    expect(h.runner.observed_final_barrier_receipts.length).toBeGreaterThan(0);
    expect(h.runner.observed_final_barrier_receipts.every((value) => /^sha256:/.test(value)))
      .toBe(true);
    expect(new Set(h.runner.observed_adapter_descriptor_receipts)).toEqual(
      new Set([active.adapter_descriptor_sha256]),
    );
    expect(new Set(h.runner.observed_adapter_admission_receipts)).toEqual(
      new Set([active.adapter_admission_receipt_sha256]),
    );
    const activationOperation = await h.repository.transaction((tx) =>
      tx.getOperation(active.activation_operation_id!),
    );
    expect(activationOperation?.effect_phase).toBe("succeeded");
    expect(activationOperation?.outcome_anchor_sha256).toMatch(/^sha256:/);
    expect((await h.service.events(active.id)).map((event) => event.state)).toEqual([
      "creating_inert",
      "creating_inert",
      "inert",
      "activating",
      "activating",
      "active",
    ]);
  });

  test("sealed provider handles use the frozen outer schema and complete binding as AEAD AAD", async () => {
    const h = harness();
    const input = createInput();
    const request = createRequestDigest(input);
    const creating = await h.service.create(
      input,
      context("begin_create_inert", oid("op", 249), request, 1n, 0, 1n, 249),
    );
    const sealed = await h.repository.transaction((tx) => tx.getHandle(creating.id));
    expect(sealed?.schema_version).toBe("sandboxes.sealed-provider-handle/v1");
    const binding: ProviderHandleBindingV1 = {
      adapter_id: creating.adapter_descriptor.adapter_id,
      adapter_version: creating.adapter_descriptor.adapter_version,
      installation_id: creating.adapter_descriptor.installation_id,
      provider_scope_ref: creating.adapter_descriptor.provider_scope_ref,
      resource_id: creating.id,
      resource_lease_id: creating.resource_lease_id,
      resource_lifecycle_generation: creating.resource_lifecycle_generation,
      provider_creation_token_sha256: creating.provider_creation_token_sha256,
      immutable_fingerprint_sha256: creating.immutable_fingerprint_sha256!,
      provider_identity_sha256: creating.provider_identity_sha256!,
      spec_sha256: creating.spec_sha256,
    };
    const sealer = new AesGcmProviderHandleSealerV1(new Uint8Array(32).fill(17));
    expect(sealer.open(sealed!, binding).provider_identity_sha256)
      .toBe(creating.provider_identity_sha256!);

    const changedBinding = { ...binding, adapter_version: "different-adapter-version" };
    const reboundEnvelope = {
      ...sealed!,
      binding_sha256: providerHandleBindingDigest(changedBinding),
    };
    expect(() => sealer.open(reboundEnvelope, changedBinding)).toThrow(
      "Provider handle authentication failed",
    );
  });

  test("an unbranded fake runner cannot enable the test-only adapter through public configuration", async () => {
    const h = harness();
    const source = h.runner;
    const unbrandedRunner: SandboxRunnerV1 = {
      descriptor: source.descriptor.bind(source),
      createInert: source.createInert.bind(source),
      activate: source.activate.bind(source),
      inspect: source.inspect.bind(source),
      expire: source.expire.bind(source),
      destroy: source.destroy.bind(source),
      lookupOperation: source.lookupOperation.bind(source),
      listOwnedResources: source.listOwnedResources.bind(source),
    };
    const service = new SandboxesReferenceServiceV1({
      repository: h.repository,
      runner: unbrandedRunner,
      handle_sealer: new AesGcmProviderHandleSealerV1(new Uint8Array(32).fill(17)),
      authority_verifier: h.verifier,
      physical_safety_controller: h.physicalSafety,
      provider_outcome_journal: h.outcomeJournal,
      provider_dispatch_journal: h.dispatchJournal,
      provider_read_probe_journal: h.readProbeJournal,
      provider_lifecycle_lock: h.lifecycleLock,
      provider_journal_recovery: h.journalRecovery,
    });
    const input = createInput();
    const request = createRequestDigest(input);
    const ctx = context("begin_create_inert", oid("op", 250), request, 1n, 0, 1n, 250);

    await expect(service.create(input, ctx)).rejects.toMatchObject({
      code: "unsupported_runtime_feature",
    });
    expect(await h.repository.transaction((tx) => tx.getOperation(ctx.operation_id)))
      .toBeUndefined();
    expect(h.runner.calls.create_inert).toBe(0);
  });

  test("descriptor behavior or provider identity cannot drift behind a reused digest", async () => {
    const h = harness();
    const inert = await createInert(h);
    const originalDescriptor = await h.runner.descriptor();
    h.runner.descriptor = async () => ({
      ...originalDescriptor,
      provider_scope_ref: "drifted-provider-scope",
      atomic_incarnation_bound_delete: !originalDescriptor.atomic_incarnation_bound_delete,
      descriptor_sha256: originalDescriptor.descriptor_sha256,
    });
    const grant = activationGrant(inert, oid("op", 234));
    const ctx = context(
      "begin_activate",
      grant.operation_id,
      grant.operation_digest,
      inert.resource_lifecycle_generation,
      inert.revision,
      4n,
      234,
      inert.immutable_fingerprint_sha256!,
      canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }),
    );

    await expect(h.service.activate(inert.id, grant, ctx))
      .rejects.toMatchObject({ code: "integrity_failed" });
    expect(await h.repository.transaction((tx) => tx.getOperation(grant.operation_id)))
      .toBeUndefined();
    expect(h.runner.calls.activate).toBe(0);
  });

  test("adapter descriptor and admission are revalidated after provider preflight", async () => {
    const h = harness();
    const inert = await createInert(h);
    const originalDescriptor = h.runner.descriptor.bind(h.runner);
    const originalList = h.runner.listOwnedResources.bind(h.runner);
    let admissionChanged = false;
    h.runner.descriptor = async () => {
      const current = await originalDescriptor();
      if (!admissionChanged) return current;
      const {
        descriptor_sha256: _descriptorSha256,
        ...changedProtectedDescriptor
      } = {
        ...current,
        isolation_evidence_sha256: digest("revoked-adapter-isolation-evidence"),
      };
      return {
        ...changedProtectedDescriptor,
        descriptor_sha256: adapterDescriptorDigest(changedProtectedDescriptor),
      };
    };
    h.runner.listOwnedResources = async (...args) => {
      const page = await originalList(...args);
      admissionChanged = true;
      return page;
    };
    const grant = activationGrant(inert, oid("op", 251));
    const ctx = context(
      "begin_activate",
      grant.operation_id,
      grant.operation_digest,
      inert.resource_lifecycle_generation,
      inert.revision,
      4n,
      251,
      inert.immutable_fingerprint_sha256!,
      canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }),
    );

    const result = await h.service.activate(inert.id, grant, ctx);
    expect(result.physical_safety_state).toBe("fenced");
    expect(result.pending_provider_outcome).toBeUndefined();
    expect(h.runner.calls.activate).toBe(0);
  });

  test("revocation after the final ownership page blocks the provider mutation", async () => {
    const h = harness();
    const inert = await createInert(h);
    const originalList = h.runner.listOwnedResources.bind(h.runner);
    const originalVerify = h.verifier.verifyCurrentEffectAuthorization.bind(h.verifier);
    let revoked = false;
    h.runner.listOwnedResources = async (...args) => {
      const page = await originalList(...args);
      revoked = true;
      return page;
    };
    h.verifier.verifyCurrentEffectAuthorization = async (...args) => {
      const authenticated = await originalVerify(...args);
      return revoked
        ? { ...authenticated, actor_principal: oid("principal", 235) }
        : authenticated;
    };
    const grant = activationGrant(inert, oid("op", 235));
    const ctx = context(
      "begin_activate",
      grant.operation_id,
      grant.operation_digest,
      inert.resource_lifecycle_generation,
      inert.revision,
      4n,
      235,
      inert.immutable_fingerprint_sha256!,
      canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }),
    );

    const result = await h.service.activate(inert.id, grant, ctx);
    expect(result.physical_safety_state).toBe("fenced");
    expect(result.pending_provider_outcome).toBeUndefined();
    expect(h.runner.calls.activate).toBe(0);
  });

  test("a grant that expires during slow provider preflight is rejected at the final DB-time barrier", async () => {
    let databaseNow = new Date(CLOCK);
    const repository = new InMemorySandboxRepositoryV1(() => databaseNow);
    const h = harness(repository, { clock: () => databaseNow });
    const inert = await createInert(h);
    const originalList = h.runner.listOwnedResources.bind(h.runner);
    h.runner.listOwnedResources = async (...args) => {
      const page = await originalList(...args);
      databaseNow = new Date("2030-01-01T00:02:00.000Z");
      return page;
    };
    const grant = {
      ...activationGrant(inert, oid("op", 241)),
      expires_at: "2030-01-01T00:01:00.000Z",
    };
    const ctx = context(
      "begin_activate",
      grant.operation_id,
      grant.operation_digest,
      inert.resource_lifecycle_generation,
      inert.revision,
      4n,
      241,
      inert.immutable_fingerprint_sha256!,
      canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }),
    );

    const result = await h.service.activate(inert.id, grant, ctx);
    expect(result.physical_safety_state).toBe("fenced");
    expect(result.pending_provider_outcome).toBeUndefined();
    expect(h.runner.calls.activate).toBe(0);
  });

  test("the final mutation barrier rejects a handle replay installed during provider preflight", async () => {
    const h = harness();
    const inert = await createInert(h);
    const staleSealed = await h.repository.transaction((tx) => tx.getHandle(inert.id));
    expect(staleSealed).toBeDefined();
    const originalList = h.runner.listOwnedResources.bind(h.runner);
    h.runner.listOwnedResources = async (...args) => {
      const page = await originalList(...args);
      await h.repository.transaction((tx) => tx.putHandle(staleSealed!));
      return page;
    };
    const grant = activationGrant(inert, oid("op", 242));
    const ctx = context(
      "begin_activate",
      grant.operation_id,
      grant.operation_digest,
      inert.resource_lifecycle_generation,
      inert.revision,
      4n,
      242,
      inert.immutable_fingerprint_sha256!,
      canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }),
    );

    const result = await h.service.activate(inert.id, grant, ctx);
    expect(result.physical_safety_state).toBe("fenced");
    expect(result.pending_provider_outcome).toBeUndefined();
    expect(h.runner.calls.activate).toBe(0);
  });

  test("the final mutation barrier observes cancellation and physical safety after preflight", async () => {
    for (const closeKind of ["cancel", "physical_safety"] as const) {
      const h = harness();
      const inert = await createInert(h);
      const grant = activationGrant(inert, oid("op", closeKind === "cancel" ? 243 : 244));
      const originalList = h.runner.listOwnedResources.bind(h.runner);
      h.runner.listOwnedResources = async (...args) => {
        const page = await originalList(...args);
        if (closeKind === "cancel") {
          await h.repository.transaction((tx) => {
            const operation = tx.getOperation(grant.operation_id)!;
            tx.updateOperation({ ...operation, cancellation_state: "suppressed" });
          });
        } else {
          await h.physicalSafety.fenceResource({
            resource_id: inert.id,
            resource_lifecycle_generation: inert.resource_lifecycle_generation + 1n,
            reason: "provider_ambiguous",
            observed_at: CLOCK.toISOString(),
          });
        }
        return page;
      };
      const ctx = context(
        "begin_activate",
        grant.operation_id,
        grant.operation_digest,
        inert.resource_lifecycle_generation,
        inert.revision,
        4n,
        closeKind === "cancel" ? 243 : 244,
        inert.immutable_fingerprint_sha256!,
        canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }),
      );

      const result = await h.service.activate(inert.id, grant, ctx);
      expect(result.physical_safety_state).toBe("fenced");
      expect(h.runner.calls.activate).toBe(0);
    }
  });

  test("canonical lifecycle transitions cannot commit while provider mutation owns the lifecycle gate", async () => {
    const h = harness();
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 236), request, 1n, 0, 1n, 236);
    const originalSafety = h.physicalSafety.assertProviderDispatchAllowed.bind(h.physicalSafety);
    let enteredSafety = (): void => {};
    const safetyEntered = new Promise<void>((resolve) => { enteredSafety = resolve; });
    let releaseSafety = (): void => {};
    const safetyReleased = new Promise<void>((resolve) => { releaseSafety = resolve; });
    h.physicalSafety.assertProviderDispatchAllowed = async (value) => {
      await originalSafety(value);
      enteredSafety();
      await safetyReleased;
    };

    const createPromise = h.service.create(input, begin);
    await safetyEntered;
    const reserved = await h.service.get(input.resource_id);
    const evidence = digest("paused-create-authoritative-lost-evidence");
    const lostRequest = lifecycleRecordRequestDigest("record_lost", reserved.id, evidence);
    let transitionSettled = false;
    const transitionPromise = h.service.recordLost(reserved.id, evidence, lifecycleContext(
      "record_lost",
      oid("op", 237),
      lostRequest,
      reserved.resource_lifecycle_generation,
      reserved.revision,
      2n,
      237,
    )).finally(() => { transitionSettled = true; });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(transitionSettled).toBe(false);
    releaseSafety();
    await createPromise;
    await expect(transitionPromise).rejects.toMatchObject({ code: "stale_revision" });
    expect(h.runner.calls.create_inert).toBe(1);
  });

  test("the provider success projection commits before the lifecycle gate releases", async () => {
    const h = harness();
    const input = createInput();
    const request = createRequestDigest(input);
    const begin = context("begin_create_inert", oid("op", 246), request, 1n, 0, 1n, 246);
    const originalSafety = h.physicalSafety.assertProviderDispatchAllowed.bind(h.physicalSafety);
    let enteredSafety = (): void => {};
    const safetyEntered = new Promise<void>((resolve) => { enteredSafety = resolve; });
    let releaseSafety = (): void => {};
    const safetyReleased = new Promise<void>((resolve) => { releaseSafety = resolve; });
    h.physicalSafety.assertProviderDispatchAllowed = async (value) => {
      await originalSafety(value);
      enteredSafety();
      await safetyReleased;
    };

    const createPromise = h.service.create(input, begin);
    await safetyEntered;
    const reserved = await h.service.get(input.resource_id);
    const evidence = digest("success-handoff-record-lost-evidence");
    const lostRequest = lifecycleRecordRequestDigest("record_lost", reserved.id, evidence);
    const transitionPromise = h.service.recordLost(reserved.id, evidence, lifecycleContext(
      "record_lost",
      oid("op", 247),
      lostRequest,
      reserved.resource_lifecycle_generation,
      reserved.revision,
      2n,
      247,
    ));
    let firstRelease = true;
    h.lifecycleLock.after_release = async () => {
      if (!firstRelease) return;
      firstRelease = false;
      await transitionPromise.catch(() => undefined);
    };
    releaseSafety();

    const creating = await createPromise;
    await expect(transitionPromise).rejects.toMatchObject({ code: "stale_revision" });
    expect(creating.pending_provider_outcome?.target_state).toBe("inert");
    expect((await h.service.resolveOperation(begin.operation_id)).state).toBe("committed");
  });

  test("activation success projects before a queued canonical transition acquires the lifecycle gate", async () => {
    const h = harness();
    const inert = await createInert(h);
    const grant = activationGrant(inert, oid("op", 252));
    const ctx = context(
      "begin_activate",
      grant.operation_id,
      grant.operation_digest,
      inert.resource_lifecycle_generation,
      inert.revision,
      4n,
      252,
      inert.immutable_fingerprint_sha256!,
      canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }),
    );
    const originalSafety = h.physicalSafety.assertProviderDispatchAllowed.bind(h.physicalSafety);
    let enteredSafety = (): void => {};
    const safetyEntered = new Promise<void>((resolve) => { enteredSafety = resolve; });
    let releaseSafety = (): void => {};
    const safetyReleased = new Promise<void>((resolve) => { releaseSafety = resolve; });
    h.physicalSafety.assertProviderDispatchAllowed = async (value) => {
      await originalSafety(value);
      enteredSafety();
      await safetyReleased;
    };

    const activationPromise = h.service.activate(inert.id, grant, ctx);
    await safetyEntered;
    const reserved = await h.service.get(inert.id);
    const evidence = digest("activation-success-handoff-lost-evidence");
    const request = lifecycleRecordRequestDigest("record_lost", reserved.id, evidence);
    const transitionPromise = h.service.recordLost(reserved.id, evidence, lifecycleContext(
      "record_lost",
      oid("op", 253),
      request,
      reserved.resource_lifecycle_generation,
      reserved.revision,
      5n,
      253,
    ));
    let firstRelease = true;
    h.lifecycleLock.after_release = async () => {
      if (!firstRelease) return;
      firstRelease = false;
      await transitionPromise.catch(() => undefined);
    };
    releaseSafety();

    const activating = await activationPromise;
    await expect(transitionPromise).rejects.toMatchObject({ code: "stale_revision" });
    expect(activating.pending_provider_outcome?.target_state).toBe("active");
    expect((await h.service.resolveOperation(ctx.operation_id)).state).toBe("committed");
  });

  test("expiry operation commits before a queued canonical transition acquires the lifecycle gate", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const ctx = expireContext(active);
    const originalSafety = h.physicalSafety.assertProviderDispatchAllowed.bind(h.physicalSafety);
    let enteredSafety = (): void => {};
    const safetyEntered = new Promise<void>((resolve) => { enteredSafety = resolve; });
    let releaseSafety = (): void => {};
    const safetyReleased = new Promise<void>((resolve) => { releaseSafety = resolve; });
    h.physicalSafety.assertProviderDispatchAllowed = async (value) => {
      await originalSafety(value);
      enteredSafety();
      await safetyReleased;
    };

    const expirePromise = h.service.expire(active.id, ctx);
    await safetyEntered;
    const reserved = await h.service.get(active.id);
    const evidence = digest("expiry-success-handoff-lost-evidence");
    const request = lifecycleRecordRequestDigest("record_lost", reserved.id, evidence);
    const transitionPromise = h.service.recordLost(reserved.id, evidence, lifecycleContext(
      "record_lost",
      oid("op", 254),
      request,
      reserved.resource_lifecycle_generation,
      reserved.revision,
      4n,
      254,
    ));
    let firstRelease = true;
    h.lifecycleLock.after_release = async () => {
      if (!firstRelease) return;
      firstRelease = false;
      await transitionPromise.catch(() => undefined);
    };
    releaseSafety();

    await expirePromise;
    const lost = await transitionPromise;
    expect(lost.state).toBe("lost");
    expect((await h.service.resolveOperation(ctx.operation_id)).state).toBe("committed");
  });

  test("destroy success projects before a queued terminal transition acquires the lifecycle gate", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const grant = cleanupGrant(active, {
      kind: "discard_uncheckpointed",
      receipt_sha256: digest("destroy-success-handoff-passkey"),
      recovery_checkpoint_attempted: true,
      promotion_grants_revoked: true,
      permanent_outcome: "discarded_uncheckpointed",
    }, oid("op", 255));
    const ctx = cleanupContext(active, grant);
    let transitionPromise: ReturnType<typeof h.service.recordDestroyed> | undefined;
    h.outcomeJournal.onAppend = async (anchor) => {
      if (anchor.record.operation_id !== ctx.operation_id) return;
      const reserved = await h.service.get(active.id);
      const evidence = canonicalDigest(anchor);
      const request = lifecycleRecordRequestDigest("record_destroyed", reserved.id, evidence);
      transitionPromise = h.service.recordDestroyed(reserved.id, evidence, lifecycleContext(
        "record_destroyed",
        oid("op", 256),
        request,
        reserved.resource_lifecycle_generation,
        reserved.revision,
        5n,
        256,
      ));
    };
    let firstRelease = true;
    h.lifecycleLock.after_release = async () => {
      if (!firstRelease || transitionPromise === undefined) return;
      firstRelease = false;
      await transitionPromise.catch(() => undefined);
    };

    const destroying = await h.service.destroy(active.id, grant, ctx);
    expect(transitionPromise).toBeDefined();
    await expect(transitionPromise!).rejects.toMatchObject({ code: "stale_revision" });
    expect(destroying.pending_provider_outcome?.target_state).toBe("destroyed");
    expect((await h.service.resolveOperation(ctx.operation_id)).state).toBe("committed");
  });

  test("a stale sealed handle cannot be opened and upgraded by a later lifecycle generation", async () => {
    const h = harness();
    const inert = await createInert(h);
    const staleSealed = await h.repository.transaction((tx) => tx.getHandle(inert.id));
    expect(staleSealed).toBeDefined();
    const active = await activate(h, inert);
    await h.repository.transaction((tx) => tx.putHandle(staleSealed!));
    const evidence = digest("stale-sealed-handle-lost-evidence");
    const request = lifecycleRecordRequestDigest("record_lost", active.id, evidence);

    await expect(h.service.recordLost(active.id, evidence, lifecycleContext(
      "record_lost",
      oid("op", 238),
      request,
      active.resource_lifecycle_generation,
      active.revision,
      5n,
      238,
    ))).rejects.toMatchObject({ code: "integrity_failed" });
    expect((await h.service.get(active.id)).state).toBe("active");
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

  test("create replay adopts a signed successful outcome after a crash before local projection", async () => {
    const repository = new CrashBeforeProviderProjectionRepositoryV1(() => CLOCK);
    const h = harness(repository);
    const input = createInput();
    const request = createRequestDigest(input);
    const ctx = context("begin_create_inert", oid("op", 248), request, 1n, 0, 1n, 248);
    h.outcomeJournal.onAppend = () => repository.armAfterOutcomeAppend();

    await expect(h.service.create(input, ctx)).rejects.toThrow(
      "simulated crash after signed outcome before local projection",
    );
    expect(h.runner.calls.create_inert).toBe(1);
    expect((await h.service.resolveOperation(ctx.operation_id)).state).toBe("in_flight");

    h.outcomeJournal.onAppend = undefined;
    const recovered = await h.service.create(input, ctx);
    expect(recovered.pending_provider_outcome?.target_state).toBe("inert");
    expect((await h.service.resolveOperation(ctx.operation_id)).state).toBe("committed");
    expect(h.runner.calls.create_inert).toBe(1);
    expect(h.outcomeJournal.calls).toHaveLength(1);
  });

  test("activation replay adopts a signed successful outcome after a crash before local projection", async () => {
    const repository = new CrashBeforeProviderProjectionRepositoryV1(() => CLOCK);
    const h = harness(repository);
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
      canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }),
    );
    const priorOutcomeCount = h.outcomeJournal.calls.length;
    h.outcomeJournal.onAppend = () => repository.armAfterOutcomeAppend();

    await expect(h.service.activate(inert.id, grant, ctx)).rejects.toThrow(
      "simulated crash after signed outcome before local projection",
    );
    expect(h.runner.calls.activate).toBe(1);

    h.outcomeJournal.onAppend = undefined;
    const recovered = await h.service.activate(inert.id, grant, ctx);
    expect(recovered.pending_provider_outcome?.target_state).toBe("active");
    expect((await h.service.resolveOperation(ctx.operation_id)).state).toBe("committed");
    expect(h.runner.calls.activate).toBe(1);
    expect(h.outcomeJournal.calls).toHaveLength(priorOutcomeCount + 1);
  });

  test("expiry replay adopts a signed successful outcome after a crash before local projection", async () => {
    const repository = new CrashBeforeProviderProjectionRepositoryV1(() => CLOCK);
    const h = harness(repository);
    const active = await activate(h, await createInert(h));
    const ctx = expireContext(active);
    const priorOutcomeCount = h.outcomeJournal.calls.length;
    h.outcomeJournal.onAppend = () => repository.armAfterOutcomeAppend();

    await expect(h.service.expire(active.id, ctx)).rejects.toThrow(
      "simulated crash after signed outcome before local projection",
    );
    expect(h.runner.calls.expire).toBe(1);

    h.outcomeJournal.onAppend = undefined;
    const recovered = await h.service.expire(active.id, ctx);
    expect(recovered.state).toBe("expiring");
    expect((await h.service.resolveOperation(ctx.operation_id)).state).toBe("committed");
    expect(h.runner.calls.expire).toBe(1);
    expect(h.outcomeJournal.calls).toHaveLength(priorOutcomeCount + 1);
  });

  test("destroy replay adopts a signed successful outcome after a crash before local projection", async () => {
    const repository = new CrashBeforeProviderProjectionRepositoryV1(() => CLOCK);
    const h = harness(repository);
    const active = await activate(h, await createInert(h));
    const grant = cleanupGrant(active, {
      kind: "discard_uncheckpointed",
      receipt_sha256: digest("signed-destroy-replay-passkey"),
      recovery_checkpoint_attempted: true,
      promotion_grants_revoked: true,
      permanent_outcome: "discarded_uncheckpointed",
    });
    const ctx = cleanupContext(active, grant);
    const priorOutcomeCount = h.outcomeJournal.calls.length;
    h.outcomeJournal.onAppend = () => repository.armAfterOutcomeAppend();

    await expect(h.service.destroy(active.id, grant, ctx)).rejects.toThrow(
      "simulated crash after signed outcome before local projection",
    );
    expect(h.runner.calls.destroy).toBe(1);

    h.outcomeJournal.onAppend = undefined;
    const recovered = await h.service.destroy(active.id, grant, ctx);
    expect(recovered.pending_provider_outcome?.target_state).toBe("destroyed");
    expect((await h.service.resolveOperation(ctx.operation_id)).state).toBe("committed");
    expect(h.runner.calls.destroy).toBe(1);
    expect(h.outcomeJournal.calls).toHaveLength(priorOutcomeCount + 1);
  });

  test("consumed activation grant recovers only after signed head/range proves dispatch absent", async () => {
    const h = harness();
    const inert = await createInert(h);
    const grant = activationGrant(inert, oid("op", 228));
    const ctx = context(
      "begin_activate",
      grant.operation_id,
      grant.operation_digest,
      inert.resource_lifecycle_generation,
      inert.revision,
      2n,
      228,
      inert.immutable_fingerprint_sha256!,
      canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }),
    );
    h.dispatchJournal.failure = new Error("crash after grant consumption before journal append");
    await expect(h.service.activate(inert.id, grant, ctx)).rejects.toThrow("crash after grant consumption");
    expect(h.runner.calls.activate).toBe(0);
    h.dispatchJournal.failure = undefined;
    const recovered = await h.service.activate(inert.id, grant, ctx);
    expect(recovered.pending_provider_outcome?.target_state).toBe("active");
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
    ctx.dispatch_journal.record.successor_resource_lifecycle_generation = 10n;
    await expect(h.service.create(input, ctx)).rejects.toThrow("exactly expected plus one");
    expect(h.runner.calls.create_inert).toBe(0);
  });

  test("rejects a changed DISPATCHED journal anchor before any provider effect", async () => {
    const h = harness();
    const input = (await import("./fixtures.js")).createInput();
    const { createRequestDigest } = await import("../src/service.js");
    const request = createRequestDigest(input);
    const ctx = context("begin_create_inert", oid("op", 61), request, 1n, 0, 1n, 61);
    ctx.dispatch_journal.record.successor_resource_lifecycle_generation = 99n;
    await expect(h.service.create(input, ctx)).rejects.toMatchObject({ code: "validation_failed" });
    expect(h.runner.calls.create_inert).toBe(0);
    expect(h.verifier.calls.dispatch_journal).toBe(0);
  });

  test("TTL expiry quarantines without granting destruction", async () => {
    let databaseNow = CLOCK;
    const h = harness(new InMemorySandboxRepositoryV1(() => databaseNow));
    const inert = await createInert(h, "2030-01-01T00:01:00.000Z");
    const active = await activate(h, inert);
    databaseNow = new Date("2030-01-01T00:02:00.000Z");
    expect(await h.service.expiredCandidates()).toHaveLength(1);
    const observation = await h.service.observeExpired(active.id);
    expect(observation.disposition).toBe("operator_review");
    const physicallyFenced = await h.service.get(active.id);
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
    const storedSafety = await h.repository.transaction((tx) =>
      tx.listSafetyFenceObservations(active.id)
    );
    expect(storedSafety).toHaveLength(1);
    expect(storedSafety[0]?.observation_sha256)
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
    expect((await h.service.get(active.id)).state).toBe("quarantined");
    expect(h.runner.calls.destroy).toBe(0);
  });

  test("a recovered lost record has one closed Infinity path to quarantine before cleanup", async () => {
    const h = harness();
    const inert = await createInert(h);
    const lostEvidence = digest("authoritative-provider-lost-evidence");
    const lostRequest = lifecycleRecordRequestDigest("record_lost", inert.id, lostEvidence);
    const lost = await h.service.recordLost(inert.id, lostEvidence, lifecycleContext(
      "record_lost",
      oid("op", 231),
      lostRequest,
      inert.resource_lifecycle_generation,
      inert.revision,
      3n,
      231,
    ));
    expect(lost.state).toBe("lost");
    const quarantineEvidence = digest("lost-recovery-quarantine-evidence");
    const quarantineRequest = lifecycleRecordRequestDigest("quarantine", lost.id, quarantineEvidence);
    const quarantined = await h.service.quarantine(lost.id, quarantineEvidence, lifecycleContext(
      "quarantine",
      oid("op", 232),
      quarantineRequest,
      lost.resource_lifecycle_generation,
      lost.revision,
      4n,
      232,
    ));
    expect(quarantined.state).toBe("quarantined");
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

  test("cleanup is unsupported without atomic incarnation-bound conditional delete", async () => {
    const h = harness(undefined, { atomic_delete_unsupported: true });
    const active = await activate(h, await createInert(h));
    const grant = cleanupGrant(active, {
      kind: "discard_uncheckpointed",
      receipt_sha256: digest("conditional-delete-required-passkey"),
      recovery_checkpoint_attempted: true,
      promotion_grants_revoked: true,
      permanent_outcome: "discarded_uncheckpointed",
    });
    await expect(h.service.destroy(active.id, grant, cleanupContext(active, grant)))
      .rejects.toMatchObject({ code: "unsupported_runtime_feature" });
    expect(h.runner.calls.destroy).toBe(0);
    expect(await h.repository.transaction((tx) => tx.getOperation(grant.operation_id))).toBeUndefined();
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
    const tombstone = await h.repository.transaction((tx) => tx.getDestroyTombstone(active.id));
    expect(tombstone).toMatchObject({
      schema_version: "sandboxes.destroy-tombstone/v1",
      resource_id: active.id,
      terminal_disposition: "discarded_uncheckpointed",
      cleanup_basis_kind: "discard_uncheckpointed",
    });
    expect(tombstone?.tombstone_sha256).toMatch(/^sha256:/);
  });

  test("ambiguous inert creation exact-adopts by operation token without duplicate creation", async () => {
    const h = harness(undefined, { ambiguous_create: "adoptable" });
    const inert = await createInert(h);
    expect(inert.state).toBe("inert");
    expect(h.runner.calls.create_inert).toBe(1);
    expect(h.runner.calls.lookup).toBe(1);
    expect(h.readProbeJournal.calls).toHaveLength(1);
    expect(await h.repository.transaction((tx) => tx.listExternalAnchors(oid("op", 20)).map((row) =>
      "record_kind" in row ? row.record_kind : row.anchor_kind
    )))
      .toContain("READ_PROBE");
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
    expect((await h.service.resolveOperation(oid("op", 20))).state).toBe("unknown");
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
