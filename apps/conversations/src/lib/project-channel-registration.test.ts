import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createChannel } from "./channels.js";
import { closeDb, getDb } from "./db.js";
import {
  createProjectChannelRegistrationAuthority,
  listProjectChannelMessagePage,
  listProjectChannelRegistrationPage,
  projectChannelRegistrationDigest,
  registerProjectChannel,
  type ProjectChannelRegistrationRequest,
  validateProjectChannelRegistrationLookup,
} from "./project-channel-registration.js";
import { sendMessage } from "./messages.js";
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

function createLocalProject(projectId = PROJECT_ID): void {
  getDb().prepare(
    "INSERT INTO projects (id, name, created_by) VALUES (?, ?, ?)",
  ).run(projectId, `Project ${projectId}`, "tester");
}

describe("project channel registration authority", () => {
  test("pages stable project channel ids without duplicates or unbound rows", () => {
    createLocalProject();
    const first = createChannel("alpha", "tester", { project_id: PROJECT_ID });
    const second = createChannel("bravo", "tester", { project_id: PROJECT_ID });
    const third = createChannel("charlie", "tester", { project_id: PROJECT_ID });
    createChannel("unbound", "tester");

    const expectedIds = [first.id, second.id, third.id].sort();
    const firstPage = listProjectChannelRegistrationPage({
      project_id: PROJECT_ID,
      max_items: 2,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    const secondPage = listProjectChannelRegistrationPage({
      project_id: PROJECT_ID,
      cursor: firstPage.next_cursor!,
      max_items: 2,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });

    expect(firstPage.items.map((item) => item.target_id)).toEqual(expectedIds.slice(0, 2));
    expect(firstPage).toMatchObject({
      authority: "conversations",
      resource_kind: "channel",
      scope: "collection",
      project_id: PROJECT_ID,
      cursor: null,
      cursor_semantics: "exclusive_stable_id",
      item_count: 2,
      has_more: true,
      complete: false,
      truncated: true,
    });
    expect(secondPage.items.map((item) => item.target_id)).toEqual(expectedIds.slice(2));
    expect(secondPage).toMatchObject({
      cursor: firstPage.next_cursor,
      next_cursor: null,
      item_count: 1,
      has_more: false,
      complete: true,
      truncated: false,
    });
    expect(firstPage.response_bytes).toBe(
      Buffer.byteLength(JSON.stringify(firstPage), "utf8"),
    );
    expect(secondPage.response_bytes).toBe(
      Buffer.byteLength(JSON.stringify(secondPage), "utf8"),
    );
    expect(new Set([...firstPage.items, ...secondPage.items].map((item) => item.target_id)).size).toBe(3);
    expect([...firstPage.items, ...secondPage.items].every((item) =>
      item.project_id === PROJECT_ID
      && item.scope === "collection"
      && item.target_id.startsWith("chn_")
      && item.revision
      && item.digest)).toBe(true);
  });

  test("pages immutable message uuids for one channel and continues to a later child", () => {
    createLocalProject();
    const channel = createChannel("project-feed", "tester", { project_id: PROJECT_ID });
    const parent = sendMessage({
      from: "alice",
      to: channel.name,
      channel: channel.name,
      content: "parent",
    });
    const reply = sendMessage({
      from: "bob",
      to: channel.name,
      channel: channel.name,
      content: "reply",
      reply_to: parent.id,
      reply_to_uuid: parent.uuid,
    });

    const firstPage = listProjectChannelMessagePage({
      project_id: PROJECT_ID,
      target_id: channel.id,
      max_items: 1,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    const secondPage = listProjectChannelMessagePage({
      project_id: PROJECT_ID,
      target_id: channel.id,
      cursor: firstPage.next_cursor!,
      max_items: 1,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });

    expect(firstPage.items).toEqual([expect.objectContaining({
      target_id: parent.uuid,
      local_id: parent.id,
      channel_id: channel.id,
      channel: channel.name,
      project_id: PROJECT_ID,
      reply_to_target_id: null,
    })]);
    expect(secondPage.items).toEqual([expect.objectContaining({
      target_id: reply.uuid,
      local_id: reply.id,
      channel_id: channel.id,
      channel: channel.name,
      project_id: PROJECT_ID,
      reply_to_target_id: parent.uuid,
    })]);
    expect(firstPage).toMatchObject({
      cursor: null,
      cursor_semantics: "exclusive_local_id",
      has_more: true,
      complete: false,
      truncated: true,
    });
    expect(secondPage).toMatchObject({
      cursor: parent.id,
      next_cursor: null,
      has_more: false,
      complete: true,
      truncated: false,
    });
    expect(firstPage.response_bytes).toBe(
      Buffer.byteLength(JSON.stringify(firstPage), "utf8"),
    );
    expect(secondPage.response_bytes).toBe(
      Buffer.byteLength(JSON.stringify(secondPage), "utf8"),
    );

    const later = sendMessage({
      from: "carol",
      to: channel.name,
      channel: channel.name,
      content: "later",
    });
    const laterPage = listProjectChannelMessagePage({
      project_id: PROJECT_ID,
      target_id: channel.id,
      cursor: reply.id,
      max_items: 2,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    expect(laterPage.items.map((item) => item.target_id)).toEqual([later.uuid]);
    expect(laterPage.next_cursor).toBeNull();
    expect(laterPage.complete).toBe(true);
  });

  test("refuses a message collection read through a conflicting project", () => {
    createLocalProject();
    const channel = createChannel("project-feed", "tester", { project_id: PROJECT_ID });
    expect(() => listProjectChannelMessagePage({
      project_id: "wks_otherProject12345678",
      target_id: channel.id,
      max_items: 10,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    })).toThrow("conflicts with channel project");
  });

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
      request_digest: request.request_digest,
      precondition_digest: request.precondition_digest,
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
    expect((await authority.lookupReceipt(lookupRequest)).receipt.receipt_id).toBe(duplicate.receipt_id);
    await expect(authority.lookupReceipt({
      ...lookupRequest,
      target_selector: "wrong-selector",
    })).rejects.toThrow("does not bind target_selector");
    expect(getDb().prepare("SELECT count(*) AS n FROM channels").get()).toEqual({ n: 1 });
  });

  test("finds an exact historical receipt after the advertised corpus identity changes", async () => {
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
      request_digest: request.request_digest,
      precondition_digest: request.precondition_digest,
      target_id: accepted.target_id!,
      max_items: 1 as const,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1 as const,
    };

    const nextCorpusId = "cor_22222222222222222222222222222222";
    getDb().prepare(
      "UPDATE project_channel_registration_identity SET corpus_id = ? WHERE singleton = 1",
    ).run(nextCorpusId);
    const upgradedCapability = {
      ...await authority.capability(),
      route: "/v2/project-registration/channels",
      package_version: "0.6.0",
      authority_id: "conversations-v2",
    };
    expect(upgradedCapability.corpus_id).toBe(nextCorpusId);
    expect(validateProjectChannelRegistrationLookup(
      lookupRequest,
      upgradedCapability,
    )).toBe(accepted.target_id!);

    const historical = await authority.lookupReceipt(lookupRequest);
    expect(historical.receipt).toEqual(accepted);
    expect({
      authority: historical.receipt.authority,
      authority_route: historical.receipt.route,
      package_version: historical.receipt.package_version,
      authority_id: historical.receipt.authority_id,
      tenant_id: historical.receipt.tenant_id,
      corpus_id: historical.receipt.corpus_id,
    }).toEqual({
      authority: lookupRequest.authority,
      authority_route: lookupRequest.authority_route,
      package_version: lookupRequest.package_version,
      authority_id: lookupRequest.authority_id,
      tenant_id: lookupRequest.tenant_id,
      corpus_id: lookupRequest.corpus_id,
    });
    expect(historical.response_control).toMatchObject({
      call_limit: 1,
      calls_used: 1,
      max_items: 1,
      items_returned: 1,
      complete: true,
      truncated: false,
    });
    expect(historical.response_control.response_bytes).toBeGreaterThan(0);
    expect(historical.response_control.response_bytes).toBeLessThanOrEqual(32_768);
    expect(historical.response_control.elapsed_ms).toBeLessThanOrEqual(5_000);

    await expect(authority.lookupReceipt({
      ...lookupRequest,
      tenant_id: "other-tenant",
    })).rejects.toThrow("authority identity mismatch");
    for (const forged of [
      { authority_route: "/v1/project-registration/forged" },
      { package_version: "999.0.0" },
      { authority_id: "forged-conversations" },
      { corpus_id: nextCorpusId },
      { operation_id: "other-operation" },
      { target_id: "chn_33333333333333333333333333333333" },
      { request_digest: "forged-request-digest" },
    ]) {
      await expect(authority.lookupReceipt({
        ...lookupRequest,
        ...forged,
      })).rejects.toThrow("terminal receipt not found");
    }
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

  test("validates the inverse envelope before persisting missing-receipt evidence", async () => {
    const authority = createProjectChannelRegistrationAuthority();
    const forward = await forwardRequest();

    await expect(authority.compensate({
      ...forward,
      accepted_receipt: undefined,
    })).rejects.toThrow("direction must be inverse");
    expect(getDb().prepare(
      "SELECT count(*) AS n FROM project_channel_registration_receipts",
    ).get()).toEqual({ n: 0 });
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
      request_digest: request.request_digest,
      precondition_digest: request.precondition_digest,
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
