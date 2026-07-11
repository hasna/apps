import { describe, expect, test } from "bun:test";
import { canonicalDigest } from "../src/canonical.js";
import { SandboxError } from "../src/errors.js";
import { AesGcmProviderHandleSealerV1 } from "../src/handle-sealer.js";
import { AmbiguousProviderEffectError } from "../src/runner.js";
import { createRequestDigest, SandboxesReferenceServiceV1 } from "../src/service.js";
import type {
  BoundedOperationContextV1,
  CheckpointExportRequestV1,
  FileListPageV1,
  SandboxDataPlaneOperationV1,
  SandboxHandleRefV1,
  SandboxV1,
} from "../src/types.js";
import {
  activate,
  capabilityClaims,
  context,
  createInput,
  CLOCK,
  createInert,
  digest,
  fence,
  harness,
  oid,
  type Harness,
} from "./fixtures.js";

function restartedService(h: Harness): SandboxesReferenceServiceV1 {
  return new SandboxesReferenceServiceV1({
    repository: h.repository,
    runner: h.runner,
    handle_sealer: new AesGcmProviderHandleSealerV1(new Uint8Array(32).fill(17)),
    authority_verifier: h.verifier,
    physical_safety_controller: h.physicalSafety,
    provider_outcome_journal: h.outcomeJournal,
    provider_dispatch_journal: h.dispatchJournal,
    provider_read_probe_journal: h.readProbeJournal,
    provider_lifecycle_lock: h.lifecycleLock,
    provider_journal_recovery: h.journalRecovery,
  });
}

function handleRef(sandbox: SandboxV1): SandboxHandleRefV1 {
  if (
    sandbox.provider_handle_sha256 === undefined ||
    sandbox.provider_identity_sha256 === undefined ||
    sandbox.immutable_fingerprint_sha256 === undefined
  ) {
    throw new Error("fixture sandbox has no protected provider handle identity");
  }
  return {
    schema_version: "sandboxes.handle-ref/v1",
    resource_id: sandbox.id,
    resource_lease_id: sandbox.resource_lease_id,
    resource_lifecycle_generation: sandbox.resource_lifecycle_generation,
    provider_handle_sha256: sandbox.provider_handle_sha256,
    provider_identity_sha256: sandbox.provider_identity_sha256,
    immutable_fingerprint_sha256: sandbox.immutable_fingerprint_sha256,
  };
}

function boundedContext(
  sandbox: SandboxV1,
  operation: SandboxDataPlaneOperationV1,
  requestSha256: ReturnType<typeof canonicalDigest>,
  seed: number,
): BoundedOperationContextV1 {
  const operationId = oid("op", seed);
  const idempotencyKeySha256 = digest(`provider-review-idempotency-${seed}`);
  const operationFence = {
    ...fence(
      operationId,
      requestSha256,
      sandbox.resource_lifecycle_generation,
      sandbox.operation_execution_epoch,
      CLOCK,
    ),
    authority_epoch: sandbox.authority_epoch,
    route_lineage_id: sandbox.route_lineage_id,
    route_id: sandbox.route_id,
    route_epoch: sandbox.route_epoch,
    run_id: sandbox.run_id,
    attempt_id: sandbox.attempt_id,
    attempt_lease_id: sandbox.attempt_lease_id,
    lease_epoch: sandbox.lease_epoch,
    resource_lease_id: sandbox.resource_lease_id,
    actor_principal: sandbox.actor_principal,
    lease_holder_principal: sandbox.lease_holder_principal,
    operation_executor_principal: sandbox.operation_executor_principal,
  };
  return {
    operation_id: operationId,
    idempotency_key_sha256: idempotencyKeySha256,
    request_sha256: requestSha256,
    expected_revision: sandbox.revision,
    fence: operationFence,
    capability: capabilityClaims({
      operation,
      operation_id: operationId,
      operation_step_id: oid("step", seed),
      target_resource_id: sandbox.id,
      request_sha256: requestSha256,
      idempotency_key_sha256: idempotencyKeySha256,
      expected_revision: sandbox.revision,
      handle_sha256: canonicalDigest(handleRef(sandbox)),
      fence: operationFence,
      seed,
    }),
  };
}

function listRequest(active: SandboxV1) {
  return {
    schema_version: "sandboxes.file-list-request/v1" as const,
    handle: handleRef(active),
    root: "",
    recursive: true,
    cursor: null,
    limit: 100,
  };
}

function checkpointRequest(active: SandboxV1, seed: number): CheckpointExportRequestV1 {
  const handle = handleRef(active);
  const facts = {
    schema_version: "sandboxes.checkpoint-capture-grant/v1" as const,
    grant_id: oid("grant", seed),
    checkpoint_id: oid("checkpoint", seed),
    resource_id: active.id,
    resource_lifecycle_generation: active.resource_lifecycle_generation,
    operation_id: oid("op", seed),
    handle_sha256: canonicalDigest(handle),
    expected_workspace_revision: 1n,
    allowed_paths_sha256: canonicalDigest([]),
    maximum_bundle_bytes: 4096,
    sink_descriptor_sha256: digest(`durable-checkpoint-sink-${seed}`),
    not_before: "2029-12-31T23:59:00.000Z",
    expires_at: "2030-01-01T00:05:00.000Z",
    one_use_nonce_sha256: digest(`checkpoint-capture-nonce-${seed}`),
    issuer_principal: oid("principal", seed),
    signing_key_id: oid("key", seed),
  };
  return {
    schema_version: "sandboxes.checkpoint-export-request/v1",
    handle,
    checkpoint_id: facts.checkpoint_id,
    expected_workspace_revision: 1n,
    allowed_paths: [],
    maximum_bundle_bytes: facts.maximum_bundle_bytes,
    sink_descriptor_sha256: facts.sink_descriptor_sha256,
    capture_mode: "quiesced",
    capture_grant: {
      ...facts,
      grant_sha256: canonicalDigest(facts),
      signature: "A".repeat(86),
    },
  };
}

describe("provider review regressions", () => {
  test("signed capability sender, target, constraints, use bound and consumption set are closed", async () => {
    for (const corruption of ["sender", "target", "uses", "ordinal"] as const) {
      const h = harness();
      const active = await activate(h, await createInert(h));
      const request = listRequest(active);
      const ctx = boundedContext(active, "file.list", canonicalDigest(request), 590 + ["sender", "target", "uses", "ordinal"].indexOf(corruption));
      if (corruption === "sender") ctx.capability.sender_proof.signature = `${ctx.capability.sender_proof.signature}=`;
      if (corruption === "target") ctx.capability.target.resource_id = oid("sbx", 999);
      if (corruption === "uses") ctx.capability.max_uses = 2 as 1;
      if (corruption === "ordinal") {
        ctx.capability.authorization_consumption_set.receipts[0].use_ordinal = 2 as 1;
      }
      await expect(h.service.listFiles(request, ctx)).rejects.toMatchObject({
        code: expect.stringMatching(/^(?:capability_denied|integrity_failed|validation_failed)$/),
      });
      expect(h.runner.calls.list_files).toBe(0);
    }
  });

  test("trusted verifier must attest all three capability signatures", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const request = listRequest(active);
    const original = h.verifier.verifyCapability.bind(h.verifier);
    h.verifier.verifyCapability = async (claims) => ({
      ...(await original(claims)),
      sender_proof_verified: false as true,
    });
    await expect(h.service.listFiles(
      request,
      boundedContext(active, "file.list", canonicalDigest(request), 599),
    )).rejects.toMatchObject({ code: "capability_denied" });
    expect(h.runner.calls.list_files).toBe(0);
  });

  test("unknown or recomputation-invalid runner DTO fields fail closed", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const request = listRequest(active);
    const original = h.runner.listFiles.bind(h.runner);
    h.runner.listFiles = async (...args) => ({
      ...(await original(...args)),
      malicious_provider_field: true,
    }) as FileListPageV1;

    await expect(h.service.listFiles(
      request,
      boundedContext(active, "file.list", canonicalDigest(request), 601),
    )).rejects.toMatchObject({ code: expect.stringMatching(/^(?:integrity_failed|validation_failed)$/) });
  });

  test("authorization is rechecked immediately before the runner effect", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const request = listRequest(active);
    const original = h.verifier.verifyCurrentEffectAuthorization.bind(h.verifier);
    let checks = 0;
    h.verifier.verifyCurrentEffectAuthorization = async (...args) => {
      checks += 1;
      if (checks === 2) throw new SandboxError("capability_denied", "revoked at final provider barrier");
      return await original(...args);
    };

    await expect(h.service.listFiles(
      request,
      boundedContext(active, "file.list", canonicalDigest(request), 602),
    )).rejects.toMatchObject({ code: "capability_denied" });
    expect(h.runner.calls.list_files).toBe(0);
    expect(checks).toBe(2);
  });

  test("bounded operation reservation and outcome survive process restart", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const request = listRequest(active);
    const ctx = boundedContext(active, "file.list", canonicalDigest(request), 603);
    const first = await h.service.listFiles(request, ctx);
    const durable = await h.repository.transaction((tx) => tx.getOperation(ctx.operation_id));
    expect(durable?.effect_phase).toBe("succeeded");
    expect(durable?.result_sha256).toBe(canonicalDigest(first));
    expect(durable?.authorization_consumption_set_sha256).toMatch(/^sha256:/);

    const replay = await restartedService(h).listFiles(request, ctx);
    expect(replay).toEqual(first);
    expect(h.runner.calls.list_files).toBe(1);
  });

  test("crash after a provider file effect reconciles instead of duplicating the effect", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const request = {
      schema_version: "sandboxes.file-write-request/v1" as const,
      handle: handleRef(active),
      path: "crash-safe.txt",
      expected_prior_sha256: null,
      content_base64url: Buffer.from("one effect", "utf8").toString("base64url"),
      content_sha256: digest("one effect"),
      max_bytes: 1024,
    };
    const ctx = boundedContext(active, "file.write", canonicalDigest(request), 604);
    const original = h.runner.writeFile.bind(h.runner);
    let injected = false;
    h.runner.writeFile = async (...args) => {
      const receipt = await original(...args);
      if (!injected) {
        injected = true;
        throw new AmbiguousProviderEffectError();
      }
      return receipt;
    };

    await expect(h.service.writeFile(request, ctx)).rejects.toBeInstanceOf(AmbiguousProviderEffectError);
    const replay = await restartedService(h).writeFile(request, ctx);
    expect(replay.content_sha256).toBe(request.content_sha256);
    expect(h.runner.calls.write_file).toBe(1);
  });

  test("malicious frame bytes, lengths, hashes, cursors, and gap claims are rejected", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const handle = handleRef(active);
    const start = {
      schema_version: "sandboxes.exec-start-request/v1" as const,
      handle,
      exec_id: oid("exec", 605),
      executable: "/usr/bin/printf",
      argv: ["%s", "bounded"],
      cwd: "/workspace" as const,
      environment_profile_id: "minimal-v1" as const,
      timeout_ms: 5_000,
      max_output_bytes: 1024,
      tty: false as const,
    };
    const started = await h.service.startExec(
      start,
      boundedContext(active, "exec.start", canonicalDigest(start), 605),
    );
    const read = {
      schema_version: "sandboxes.exec-frame-read-request/v1" as const,
      handle,
      exec_id: start.exec_id,
      cursor: started.initial_cursor,
      max_frames: 100,
      max_bytes: 1024,
      wait_ms: 0,
    };
    const original = h.runner.readExecFrames.bind(h.runner);
    h.runner.readExecFrames = async (...args) => {
      const page = await original(...args);
      return {
        ...page,
        gap_detected: true,
        returned_bytes: page.returned_bytes + 1,
      } as unknown as typeof page;
    };

    await expect(h.service.readExecFrames(
      read,
      boundedContext(active, "exec.frames.read", canonicalDigest(read), 606),
    )).rejects.toMatchObject({ code: "integrity_failed" });
  });

  test("checkpoint capture requires grant, barrier, quiescence, manifest/blob and sink durability", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const handle = handleRef(active);
    const operationId = oid("op", 607);
    const grantFacts = {
      schema_version: "sandboxes.checkpoint-capture-grant/v1" as const,
      grant_id: oid("grant", 607),
      checkpoint_id: oid("checkpoint", 607),
      resource_id: active.id,
      resource_lifecycle_generation: active.resource_lifecycle_generation,
      operation_id: operationId,
      handle_sha256: canonicalDigest(handle),
      expected_workspace_revision: 1n,
      allowed_paths_sha256: canonicalDigest([]),
      maximum_bundle_bytes: 4096,
      sink_descriptor_sha256: digest("durable-checkpoint-sink"),
      not_before: "2029-12-31T23:59:00.000Z",
      expires_at: "2030-01-01T00:05:00.000Z",
      one_use_nonce_sha256: digest("checkpoint-capture-nonce"),
      issuer_principal: oid("principal", 607),
      signing_key_id: oid("key", 607),
    };
    const captureGrant = {
      ...grantFacts,
      grant_sha256: canonicalDigest(grantFacts),
      signature: "A".repeat(86),
    };
    const request = {
      schema_version: "sandboxes.checkpoint-export-request/v1" as const,
      handle,
      checkpoint_id: captureGrant.checkpoint_id,
      expected_workspace_revision: 1n,
      allowed_paths: [],
      maximum_bundle_bytes: 4096,
      sink_descriptor_sha256: captureGrant.sink_descriptor_sha256,
      capture_mode: "quiesced" as const,
      capture_grant: captureGrant,
    } as unknown as CheckpointExportRequestV1;
    const handoff = await h.service.exportCheckpoint(
      request,
      boundedContext(active, "checkpoint.export_bundle", canonicalDigest(request), 607),
    );
    expect(handoff.capture_grant_sha256).toBe(captureGrant.grant_sha256);
    expect(handoff.quiescence_receipt_sha256).toMatch(/^sha256:/);
    expect(handoff.manifest_blob_sha256).toBe(handoff.manifest_sha256);
    expect(handoff.sink_commit_receipt_sha256).toMatch(/^sha256:/);
    expect(handoff.durability_state).toBe("durable");
    expect(h.verifier.calls.checkpoint_capture).toBe(2);
    expect(h.verifier.calls.checkpoint_sink_commit).toBe(1);
  });

  test("provider reconciliation consumes an independently signed read-only no-effect receipt", async () => {
    const h = harness(undefined, { ambiguous_create: "adoptable" });
    const input = createInput();
    const requestSha256 = createRequestDigest(input);
    await h.service.create(input, context(
      "begin_create_inert",
      oid("op", 608),
      requestSha256,
      1n,
      0,
      1n,
      608,
      undefined,
      undefined,
      CLOCK,
      input,
    ));
    expect(h.verifier.calls.read_probe_no_effect).toBeGreaterThan(0);
    expect(h.runner.observed_read_probe_no_effect_receipts.length).toBeGreaterThan(0);
    expect(h.runner.observed_read_probe_no_effect_receipts.every((value) => /^sha256:/.test(value)))
      .toBe(true);
  });

  test("partial checkpoint upload ambiguity reconciles the durable sink commit after restart", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const request = checkpointRequest(active, 609);
    const ctx = boundedContext(active, "checkpoint.export_bundle", canonicalDigest(request), 609);
    const original = h.runner.exportCheckpoint.bind(h.runner);
    let injected = false;
    h.runner.exportCheckpoint = async (...args) => {
      const result = await original(...args);
      if (!injected) {
        injected = true;
        throw new AmbiguousProviderEffectError();
      }
      return result;
    };
    await expect(h.service.exportCheckpoint(request, ctx))
      .rejects.toBeInstanceOf(AmbiguousProviderEffectError);
    const recovered = await restartedService(h).exportCheckpoint(request, ctx);
    expect(recovered.durability_state).toBe("durable");
    expect(recovered.sink_commit_receipt.receipt_sha256)
      .toBe(recovered.sink_commit_receipt_sha256);
    expect(h.runner.calls.export_checkpoint).toBe(1);
  });
});
