import { describe, expect, test } from "bun:test";
import { canonicalDigest } from "../src/canonical.js";
import type {
  BoundedOperationContextV1,
  SandboxDataPlaneOperationV1,
  SandboxHandleRefV1,
  SandboxV1,
} from "../src/types.js";
import {
  activate,
  capabilityClaims,
  CLOCK,
  createInert,
  digest,
  fence,
  harness,
  oid,
} from "./fixtures.js";

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
  const idempotencyKeySha256 = digest(`bounded-idempotency-${seed}`);
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

describe("bounded public sandbox operations", () => {
  test("file, exec, frame/result/cancel, and checkpoint handoff are callable under the exact current handle and fence", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const handle = handleRef(active);

    const write = {
      schema_version: "sandboxes.file-write-request/v1" as const,
      handle,
      path: "result.txt",
      expected_prior_sha256: null,
      content_base64url: Buffer.from("verified output", "utf8").toString("base64url"),
      content_sha256: digest("verified output"),
      max_bytes: 1024,
    };
    const writeReceipt = await h.service.writeFile(
      write,
      boundedContext(active, "file.write", canonicalDigest(write), 201),
    );
    expect(writeReceipt.content_sha256).toBe(digest("verified output"));

    const read = {
      schema_version: "sandboxes.file-read-request/v1" as const,
      handle,
      path: "result.txt",
      offset_bytes: 0,
      length_bytes: 1024,
      expected_file_sha256: digest("verified output"),
    };
    const readReceipt = await h.service.readFile(
      read,
      boundedContext(active, "file.read", canonicalDigest(read), 202),
    );
    expect(Buffer.from(readReceipt.content_base64url, "base64url").toString("utf8"))
      .toBe("verified output");

    const list = {
      schema_version: "sandboxes.file-list-request/v1" as const,
      handle,
      root: "",
      recursive: true,
      cursor: null,
      limit: 100,
    };
    const listPage = await h.service.listFiles(
      list,
      boundedContext(active, "file.list", canonicalDigest(list), 203),
    );
    expect(listPage.entries.map((entry) => entry.path)).toEqual(["result.txt"]);

    const start = {
      schema_version: "sandboxes.exec-start-request/v1" as const,
      handle,
      exec_id: oid("exec", 204),
      executable: "/usr/bin/printf",
      argv: ["%s", "ok"],
      cwd: "/workspace" as const,
      environment_profile_id: "minimal-v1" as const,
      timeout_ms: 5_000,
      max_output_bytes: 1024,
      tty: false as const,
    };
    const started = await h.service.startExec(
      start,
      boundedContext(active, "exec.start", canonicalDigest(start), 204),
    );
    expect(started.state).toBe("running");

    const frames = {
      schema_version: "sandboxes.exec-frame-read-request/v1" as const,
      handle,
      exec_id: start.exec_id,
      cursor: started.initial_cursor,
      prior_stream_root_sha256: started.stream_root_sha256,
      resume_token: started.initial_resume_token,
      resume_token_sha256: started.initial_resume_token_sha256,
      next_expected_sequence: started.next_expected_sequence,
      max_frames: 100,
      max_bytes: 1024,
      wait_ms: 0,
    };
    const framePage = await h.service.readExecFrames(
      frames,
      boundedContext(active, "exec.frames.read", canonicalDigest(frames), 205),
    );
    expect(framePage.terminal).toBe(true);
    expect(framePage.frames.at(-1)?.kind).toBe("terminal");
    const durableStart = await h.repository.transaction((tx) => tx.getOperation(oid("op", 204)));
    const durableFrames = await h.repository.transaction((tx) => tx.getOperation(oid("op", 205)));
    expect(durableStart?.bounded_result?.result_document).toMatchObject({
      stream_root_sha256: started.stream_root_sha256,
      initial_cursor_sha256: started.initial_cursor_sha256,
    });
    expect(durableFrames?.bounded_result?.result_document).toMatchObject({
      next_resume_token_sha256: framePage.next_resume_token_sha256,
      next_stream_root_sha256: framePage.next_stream_root_sha256,
      gap_detected: false,
      gap_proof_sha256: framePage.gap_proof_sha256,
    });

    const result = {
      schema_version: "sandboxes.exec-result-request/v1" as const,
      handle,
      exec_id: start.exec_id,
      prior_stream_root_sha256: framePage.next_stream_root_sha256,
      resume_token: framePage.next_resume_token,
      resume_token_sha256: framePage.next_resume_token_sha256,
      next_expected_sequence: framePage.next_expected_sequence,
    };
    const execResult = await h.service.readExecResult(
      result,
      boundedContext(active, "exec.result.read", canonicalDigest(result), 206),
    );
    expect(execResult.state).toBe("succeeded");
    expect(execResult.exit_code).toBe(0);

    const cancelStart = { ...start, exec_id: oid("exec", 207), argv: ["long-running"] };
    const cancelStarted = await h.service.startExec(
      cancelStart,
      boundedContext(active, "exec.start", canonicalDigest(cancelStart), 207),
    );
    const cancel = {
      schema_version: "sandboxes.exec-cancel-request/v1" as const,
      handle,
      exec_id: cancelStarted.exec_id,
      reason: "explicit" as const,
      grace_ms: 100,
    };
    const canceled = await h.service.cancelExec(
      cancel,
      boundedContext(active, "exec.cancel", canonicalDigest(cancel), 208),
    );
    expect(canceled.state).toBe("canceled");
    expect(canceled.whole_scope_terminated).toBe(true);

    const checkpointGrantFacts = {
      schema_version: "sandboxes.checkpoint-capture-grant/v1" as const,
      grant_id: oid("grant", 209),
      checkpoint_id: oid("checkpoint", 209),
      resource_id: active.id,
      resource_lifecycle_generation: active.resource_lifecycle_generation,
      operation_id: oid("op", 209),
      handle_sha256: canonicalDigest(handle),
      expected_workspace_revision: writeReceipt.workspace_revision_after,
      allowed_paths_sha256: canonicalDigest(["result.txt"]),
      maximum_bundle_bytes: 4096,
      sink_descriptor_sha256: digest("checkpoint-sink"),
      not_before: "2029-12-31T23:59:00.000Z",
      expires_at: "2030-01-01T00:05:00.000Z",
      one_use_nonce_sha256: digest("checkpoint-capture-209"),
      issuer_principal: oid("principal", 209),
      signing_key_id: oid("key", 209),
    };
    const checkpoint = {
      schema_version: "sandboxes.checkpoint-export-request/v1" as const,
      handle,
      checkpoint_id: oid("checkpoint", 209),
      expected_workspace_revision: writeReceipt.workspace_revision_after,
      allowed_paths: ["result.txt"],
      maximum_bundle_bytes: 4096,
      sink_descriptor_sha256: digest("checkpoint-sink"),
      capture_mode: "quiesced" as const,
      capture_grant: {
        ...checkpointGrantFacts,
        grant_sha256: canonicalDigest(checkpointGrantFacts),
        signature: "A".repeat(86),
      },
    };
    const handoff = await h.service.exportCheckpoint(
      checkpoint,
      boundedContext(active, "checkpoint.export_bundle", canonicalDigest(checkpoint), 209),
    );
    expect(handoff.checkpoint_id).toBe(checkpoint.checkpoint_id);
    expect(handoff.file_count).toBe(1);
    expect(handoff.fence_sha256).toBe(canonicalDigest(
      boundedContext(active, "checkpoint.export_bundle", canonicalDigest(checkpoint), 209).fence,
    ));
  });

  test("a stale handle never reaches the adapter and an exact replay returns the durable outcome", async () => {
    const h = harness();
    const active = await activate(h, await createInert(h));
    const request = {
      schema_version: "sandboxes.file-list-request/v1" as const,
      handle: handleRef(active),
      root: "",
      recursive: true,
      cursor: null,
      limit: 100,
    };

    const changedRevision = boundedContext(active, "file.list", canonicalDigest(request), 217);
    changedRevision.expected_revision += 1;
    await expect(h.service.listFiles(request, changedRevision)).rejects.toMatchObject({
      code: "capability_denied",
    });

    const changedIdempotency = boundedContext(active, "file.list", canonicalDigest(request), 218);
    changedIdempotency.idempotency_key_sha256 = digest("caller-replaced-idempotency");
    await expect(h.service.listFiles(request, changedIdempotency)).rejects.toMatchObject({
      code: "capability_denied",
    });

    const changedHandleBinding = boundedContext(active, "file.list", canonicalDigest(request), 219);
    changedHandleBinding.capability.handle_sha256 = digest("different-handle-ref");
    await expect(h.service.listFiles(request, changedHandleBinding)).rejects.toMatchObject({
      code: "integrity_failed",
    });

    const ctx = boundedContext(active, "file.list", canonicalDigest(request), 220);
    const first = await h.service.listFiles(request, ctx);
    expect(await h.service.listFiles(request, ctx)).toEqual(first);

    const stale = {
      ...request,
      handle: {
        ...request.handle,
        resource_lifecycle_generation: request.handle.resource_lifecycle_generation - 1n,
      },
    };
    const staleContext = boundedContext(active, "file.list", canonicalDigest(stale), 221);
    staleContext.capability.handle_sha256 = canonicalDigest(stale.handle);
    await expect(h.service.listFiles(stale, staleContext)).rejects.toMatchObject({
      code: "integrity_failed",
    });

    const wrongLease = boundedContext(active, "file.list", canonicalDigest(request), 222);
    wrongLease.fence.resource_lease_id = oid("resource_lease", 222);
    wrongLease.capability.fence.resource_lease_id = wrongLease.fence.resource_lease_id;
    await expect(h.service.listFiles(request, wrongLease)).rejects.toMatchObject({
      code: "integrity_failed",
    });

    await expect(h.service.listFiles(
      { ...request, unexpected_provider_option: true } as typeof request,
      boundedContext(active, "file.list", canonicalDigest(request), 223),
    )).rejects.toMatchObject({ code: "validation_failed" });
    expect(h.runner.calls.list_files).toBe(1);
  });
});
