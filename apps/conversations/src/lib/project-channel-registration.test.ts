import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createChannel } from "./channels.js";
import { closeDb, getDb } from "./db.js";
import {
  createProjectChannelRegistrationAuthority,
  projectChannelRegistrationDigest,
  registerProjectChannel,
  type ProjectChannelRegistrationRequest,
} from "./project-channel-registration.js";
import { pinStoreToDb, restoreStoreEnv } from "./store/isolated-test-env.js";

const TEST_DB = join(tmpdir(), `conversations-project-channel-registration-${Date.now()}.db`);
const PROJECT_ID = "wks_ys8tzpsZJMNtx0ORZtLsA";

beforeEach(() => {
  pinStoreToDb(TEST_DB);
  closeDb();
});

afterEach(() => {
  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TEST_DB + suffix); } catch {}
  }
  restoreStoreEnv();
});

const targetHandle = {
  digest: "test-path-digest",
  withOwnedPath<T>(consumer: (path: string) => T): T {
    return consumer("/test/project");
  },
};

async function forwardRequest(
  overrides: Partial<ProjectChannelRegistrationRequest> = {},
): Promise<ProjectChannelRegistrationRequest> {
  const capability = await createProjectChannelRegistrationAuthority().capability();
  const projectSlug = String(overrides.project_slug ?? "fleet-resources");
  const projectId = String(overrides.project_id ?? PROJECT_ID);
  const desired = overrides.desired ?? {
    channel: projectSlug,
    project_id: projectId,
    project_slug: projectSlug,
    project_kind: "work",
  };
  const targetSelector = String(overrides.target_selector ?? projectSlug);
  return {
    operation_id: "operation-1",
    step_id: "conversations-channel",
    resource_kind: "channel",
    direction: "forward",
    authority_route: capability.route,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    target_selector: targetSelector,
    idempotency_key: "operation-1:conversations-channel:forward",
    request_digest: projectChannelRegistrationDigest(desired),
    precondition_digest: projectChannelRegistrationDigest({
      target_selector: targetSelector,
      expected: "absent",
    }),
    project_id: projectId,
    project_slug: projectSlug,
    project_name: "Fleet Resources",
    desired,
    target: targetHandle,
    response_byte_limit: 32_768,
    time_budget_ms: 5_000,
    call_limit: 1,
    ...overrides,
  };
}

function inverseRequest(
  forward: Awaited<ReturnType<typeof registerProjectChannel>>,
  overrides: Partial<ProjectChannelRegistrationRequest> = {},
): ProjectChannelRegistrationRequest {
  const desired = {
    accepted_receipt_id: forward.receipt_id,
    target_id: forward.target_id,
  };
  return {
    operation_id: forward.operation_id,
    step_id: forward.step_id,
    resource_kind: "channel",
    direction: "inverse",
    authority_route: forward.route,
    package_version: forward.package_version,
    authority_id: forward.authority_id,
    tenant_id: forward.tenant_id,
    corpus_id: forward.corpus_id,
    target_selector: forward.target_id!,
    idempotency_key: `${forward.operation_id}:${forward.step_id}:inverse`,
    request_digest: projectChannelRegistrationDigest(desired),
    precondition_digest: projectChannelRegistrationDigest({
      target_id: forward.target_id,
      expected_revision: forward.result_revision,
      expected_digest: forward.result_digest,
    }),
    project_id: PROJECT_ID,
    project_slug: "fleet-resources",
    project_name: "Fleet Resources",
    desired,
    target: targetHandle,
    accepted_receipt: forward,
    response_byte_limit: 32_768,
    time_budget_ms: 5_000,
    call_limit: 1,
    ...overrides,
  };
}

describe("project channel registration authority", () => {
  test("advertises the package-owned conditional authority with stable identity", async () => {
    const authority = createProjectChannelRegistrationAuthority();
    const first = await authority.capability();
    const second = await authority.capability();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      authority: "conversations" as const,
      route: "/v1/project-registration/channels",
      authority_id: "conversations",
      tenant_id: "default",
      supported_resources: ["channel"],
      conditional_create: true,
      immutable_receipts: true,
      exact_terminal_lookup: true,
      exact_readback: true,
      conditional_inverse: true,
      ambiguous_outcome_reconciliation: true,
    });
    expect(first.corpus_id).toMatch(/^cor_[0-9a-f]{32}$/);
  });

  test("atomically creates an absent channel and returns exact immutable readback", async () => {
    const authority = createProjectChannelRegistrationAuthority();
    const request = await forwardRequest();
    const receipt = await authority.create(request);

    expect(receipt).toMatchObject({
      outcome: "accepted",
      reason: null,
      authority: "conversations" as const,
      resource_kind: "channel",
      direction: "forward",
      created_by_operation: true,
      duplicate_of_receipt_id: null,
      accepted_receipt_id: null,
    });
    expect(receipt.target_id).toMatch(/^chn_[0-9a-f]{32}$/);
    expect(receipt.result_revision).toBeTruthy();
    expect(receipt.result_digest).toBeTruthy();

    const byId = await authority.readExact({
      resource_kind: "channel",
      target_id: receipt.target_id!,
      target_selector: "fleet-resources",
      target: targetHandle,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    expect(byId).toEqual({
      target_id: receipt.target_id!,
      revision: receipt.result_revision!,
      digest: receipt.result_digest!,
    });

    const channel = getDb().prepare("SELECT * FROM channels WHERE id = ?").get(receipt.target_id!) as Record<string, unknown>;
    expect(channel.name).toBe("fleet-resources");
    expect(channel.project_id).toBe(PROJECT_ID);
    expect(channel.created_by).toBe("project-registration");
    expect(() => getDb().prepare(
      "UPDATE project_channel_registration_receipts SET reason = 'changed' WHERE receipt_id = ?",
    ).run(receipt.receipt_id)).toThrow("immutable");
    expect(() => getDb().prepare(
      "DELETE FROM project_channel_registration_receipts WHERE receipt_id = ?",
    ).run(receipt.receipt_id)).toThrow("immutable");
  });

  test("returns one deterministic duplicate receipt and rejects changed step inputs without clobbering", async () => {
    const authority = createProjectChannelRegistrationAuthority();
    const request = await forwardRequest();
    const accepted = await authority.create(request);
    const lookupRequest = {
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: "channel" as const,
      direction: "forward" as const,
      authority: "conversations" as const,
      authority_route: request.authority_route,
      package_version: request.package_version,
      authority_id: request.authority_id,
      tenant_id: request.tenant_id,
      corpus_id: request.corpus_id,
      target_selector: request.target_selector,
      idempotency_key: request.idempotency_key,
      target_id: accepted.target_id!,
      max_items: 1 as const,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1 as const,
    };
    const acceptedLookup = await authority.lookupReceipt(lookupRequest);
    expect(acceptedLookup.receipt.receipt_id).toBe(accepted.receipt_id);

    const duplicate = await authority.create(request);
    const duplicateAgain = await authority.create(request);

    expect(duplicate.outcome).toBe("duplicate_of_accepted");
    expect(duplicate.duplicate_of_receipt_id).toBe(accepted.receipt_id);
    expect(duplicate.target_id).toBe(accepted.target_id);
    expect(duplicate.receipt_id).toBe(duplicateAgain.receipt_id);

    const lookup = await authority.lookupReceipt(lookupRequest);
    expect(lookup.receipt.receipt_id).toBe(duplicate.receipt_id);
    expect(lookup.response_control).toMatchObject({
      call_limit: 1,
      calls_used: 1,
      max_items: 1,
      items_returned: 1,
      complete: true,
      truncated: false,
    });
    expect(lookup.response_control.response_bytes).toBeGreaterThan(0);
    expect(lookup.response_control.response_bytes).toBeLessThanOrEqual(32_768);
    expect(lookup.response_control.elapsed_ms).toBeLessThanOrEqual(5_000);

    const changedDesired = { ...request.desired, project_name: "Changed" };
    const changed = await authority.create({
      ...request,
      request_digest: projectChannelRegistrationDigest(changedDesired),
      desired: changedDesired,
    });
    expect(changed.outcome).toBe("terminal_nonacceptance");
    expect(changed.reason).toBe("changed_request_or_precondition_for_step");
    expect(getDb().prepare("SELECT count(*) AS n FROM channels").get()).toEqual({ n: 1 });
  });

  test("records nonacceptance for preexisting equivalent/conflicting channels and retired prefixes only", async () => {
    createChannel("fleet-resources", "human");
    const equivalent = await registerProjectChannel(await forwardRequest());
    expect(equivalent).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "preexisting_equivalent",
      created_by_operation: false,
    });
    expect(equivalent.target_id).toMatch(/^chn_[0-9a-f]{32}$/);

    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(TEST_DB + suffix); } catch {}
    }
    const conflicting = createChannel("fleet-resources", "human", { description: "different" });
    const conflictReceipt = await registerProjectChannel(await forwardRequest());
    expect(conflictReceipt.reason).toBe("preexisting_conflict");
    expect(conflictReceipt.target_id).toBe(conflicting.id);

    for (const valid of ["fleet-resources", "iapp-sms"]) {
      closeDb();
      for (const suffix of ["", "-wal", "-shm"]) {
        try { unlinkSync(TEST_DB + suffix); } catch {}
      }
      const receipt = await registerProjectChannel(await forwardRequest({
        operation_id: `op-${valid}`,
        step_id: `step-${valid}`,
        idempotency_key: `key-${valid}`,
        project_slug: valid,
        target_selector: valid,
        desired: {
          channel: valid,
          project_id: PROJECT_ID,
          project_slug: valid,
          project_kind: "work",
        },
      }));
      expect(receipt.outcome).toBe("accepted");
    }

    for (const retired of ["iproj-fleet-resources", "internal-iproj-fleet-resources"]) {
      closeDb();
      for (const suffix of ["", "-wal", "-shm"]) {
        try { unlinkSync(TEST_DB + suffix); } catch {}
      }
      const desired = {
        channel: retired,
        project_id: PROJECT_ID,
        project_slug: retired,
        project_kind: "work",
      };
      const receipt = await registerProjectChannel(await forwardRequest({
        operation_id: `op-${retired}`,
        step_id: `step-${retired}`,
        idempotency_key: `key-${retired}`,
        project_slug: retired,
        target_selector: retired,
        desired,
        request_digest: projectChannelRegistrationDigest(desired),
        precondition_digest: projectChannelRegistrationDigest({
          target_selector: retired,
          expected: "absent",
        }),
      }));
      expect(receipt).toMatchObject({
        outcome: "terminal_nonacceptance",
        reason: "retired_project_prefix",
      });
      expect(getDb().prepare("SELECT count(*) AS n FROM channels").get()).toEqual({ n: 0 });
    }
  }, 15_000);

  test("rolls back an injected failure without leaving a channel or receipt", async () => {
    const request = await forwardRequest();
    expect(() => registerProjectChannel(request, {
      faultInjector(point) {
        if (point === "after_channel_insert") throw new Error("injected");
      },
    })).toThrow("injected");

    expect(getDb().prepare("SELECT count(*) AS n FROM channels").get()).toEqual({ n: 0 });
    expect(getDb().prepare("SELECT count(*) AS n FROM project_channel_registration_receipts").get()).toEqual({ n: 0 });
  });

  test("conditionally inverses only the accepted attempt-created channel", async () => {
    const authority = createProjectChannelRegistrationAuthority();
    const accepted = await authority.create(await forwardRequest());
    const inverse = inverseRequest(accepted);
    const removed = await authority.compensate(inverse);

    expect(removed).toMatchObject({
      outcome: "accepted",
      direction: "inverse",
      accepted_receipt_id: accepted.receipt_id,
      target_id: accepted.target_id,
      created_by_operation: true,
    });
    expect(getDb().prepare("SELECT * FROM channels WHERE id = ?").get(accepted.target_id!)).toBeNull();
    expect(await authority.verifyInverse(inverse)).toEqual({
      target_id: accepted.target_id!,
      accepted_receipt_id: accepted.receipt_id,
      absent: true,
      digest: projectChannelRegistrationDigest({
        target_id: accepted.target_id,
        absent: true,
      }),
    });

    const duplicate = await authority.compensate(inverse);
    expect(duplicate.outcome).toBe("duplicate_of_accepted");
    expect(duplicate.duplicate_of_receipt_id).toBe(removed.receipt_id);
    expect(duplicate.receipt_id).toBe((await authority.compensate(inverse)).receipt_id);
  });

  test("refuses inverse for drifted, referenced, or preexisting channels", async () => {
    const authority = createProjectChannelRegistrationAuthority();
    const drifted = await authority.create(await forwardRequest());
    getDb().prepare("UPDATE channels SET topic = 'changed' WHERE id = ?").run(drifted.target_id!);
    const driftReceipt = await authority.compensate(inverseRequest(drifted));
    expect(driftReceipt).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "target_drifted",
    });
    expect(getDb().prepare("SELECT id FROM channels WHERE id = ?").get(drifted.target_id!)).not.toBeNull();

    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(TEST_DB + suffix); } catch {}
    }
    const referenced = await authority.create(await forwardRequest({ operation_id: "operation-2", idempotency_key: "operation-2:key" }));
    getDb().prepare(
      "INSERT INTO messages (session_id, from_agent, to_agent, channel, content) VALUES (?, ?, ?, ?, ?)",
    ).run("channel:fleet-resources", "human", "fleet-resources", "fleet-resources", "reference");
    const referencedReceipt = await authority.compensate(inverseRequest(referenced, {
      operation_id: "operation-2",
      idempotency_key: "operation-2:inverse",
    }));
    expect(referencedReceipt).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "target_referenced",
    });

    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(TEST_DB + suffix); } catch {}
    }
    createChannel("fleet-resources", "human");
    const preexisting = await authority.create(await forwardRequest({ operation_id: "operation-3", idempotency_key: "operation-3:key" }));
    expect(preexisting.reason).toBe("preexisting_equivalent");
    const refused = await authority.compensate(inverseRequest(preexisting, {
      operation_id: "operation-3",
      idempotency_key: "operation-3:inverse",
    }));
    expect(refused).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "accepted_receipt_required",
    });
    expect(getDb().prepare("SELECT count(*) AS n FROM channels").get()).toEqual({ n: 1 });
  });

  test("rejects ambiguous exact receipt populations and preserves ordinary create compatibility", async () => {
    const authority = createProjectChannelRegistrationAuthority();
    const request = await forwardRequest();
    const accepted = await authority.create(request);
    getDb().exec("DROP TRIGGER project_channel_registration_receipts_no_update");
    getDb().exec("DROP TRIGGER project_channel_registration_receipts_no_delete");
    getDb().prepare(`
      INSERT INTO project_channel_registration_receipts (
        receipt_id, authority, route, package_version, authority_id, tenant_id,
        corpus_id, operation_id, step_id, resource_kind, direction,
        idempotency_key, request_digest, precondition_digest, outcome, reason,
        target_id, result_revision, result_digest, duplicate_of_receipt_id,
        accepted_receipt_id, created_by_operation, created_at
      )
      SELECT
        receipt_id || '-ambiguous', authority, route, package_version,
        authority_id, tenant_id, corpus_id, operation_id, step_id, resource_kind,
        direction, idempotency_key, request_digest, precondition_digest,
        'accepted', reason, target_id, result_revision, result_digest,
        duplicate_of_receipt_id, accepted_receipt_id, created_by_operation,
        created_at
      FROM project_channel_registration_receipts
      WHERE receipt_id = ?
    `).run(accepted.receipt_id);

    await expect(authority.lookupReceipt({
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: "channel",
      direction: "forward",
      authority: "conversations",
      authority_route: request.authority_route,
      package_version: request.package_version,
      authority_id: request.authority_id,
      tenant_id: request.tenant_id,
      corpus_id: request.corpus_id,
      target_selector: request.target_selector,
      idempotency_key: request.idempotency_key,
      target_id: accepted.target_id!,
      max_items: 1,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    })).rejects.toThrow("ambiguous");

    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(TEST_DB + suffix); } catch {}
    }
    expect(() => createChannel("ordinary", "human", { project_id: PROJECT_ID })).toThrow("Project not found");
    expect(createChannel("ordinary", "human").id).toMatch(/^chn_[0-9a-f]{32}$/);
  });
});
