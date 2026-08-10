process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { DbAdapter } from "../storage.js";
import { getDatabase, resetDatabase } from "../db/database.js";
import { getProject, registerProject } from "../db/projects.js";
import { createSessionJob, getSessionJob } from "../db/session-jobs.js";
import {
  MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE,
  MementosProjectRegistrationError,
  createLocalMementosProjectRegistrationAuthority,
  deriveMementosProjectRegistrationIdempotencyKey,
  digestMementosProjectRegistrationValue,
  type MementosProjectGuardedUpdateResult,
  type MementosProjectRegistrationAuthority,
  type MementosProjectRegistrationFaultPoint,
  type MementosProjectRegistrationReceipt,
  type MementosProjectRegistrationRequest,
} from "./index.js";

const PROJECT_ID = "wks_fleetresourcesv1";
const PROJECT_SLUG = "fleet-resources";
const PROJECT_NAME = "Fleet Resources";
const PROJECT_PATH = "/tmp/fleet-resources";

class OwnedPathHandle {
  constructor(private readonly value: string) {}

  withOwnedPath<T>(consumer: (absolutePath: string) => T): T {
    return consumer(this.value);
  }
}

function acceptedGuardedResult(result: MementosProjectGuardedUpdateResult) {
  const { response_control: _responseControl, ...accepted } = result;
  return accepted;
}

function authority(
  db: DbAdapter,
  faultInjector?: (
    point: MementosProjectRegistrationFaultPoint,
    context: {
      operation_id: string;
      step_id: string;
      direction: "forward" | "inverse";
    },
  ) => void,
  now: () => string = () => "2026-08-07T12:00:00.000Z",
): MementosProjectRegistrationAuthority {
  return createLocalMementosProjectRegistrationAuthority(db, {
    packageVersion: "0.14.75-test",
    authorityId: "mementos-test-authority",
    tenantId: "tenant-test",
    corpusId: "corpus-test",
    now,
    faultInjector,
  });
}

async function forwardRequest(
  target: OwnedPathHandle = new OwnedPathHandle(PROJECT_PATH),
  operationId = "fleet-resources-registration-v1",
  db: DbAdapter = getDatabase(),
): Promise<{
  authority: MementosProjectRegistrationAuthority;
  request: MementosProjectRegistrationRequest;
}> {
  const registrationAuthority = authority(db);
  const capability = await registrationAuthority.capability();
  const desired = {
    source_project_id: PROJECT_ID,
    source_project_slug: PROJECT_SLUG,
    name: PROJECT_NAME,
    target_path_digest: createHash("sha256").update(PROJECT_PATH).digest("hex"),
  };
  const requestDigest = digestMementosProjectRegistrationValue(desired);
  const preconditionDigest = digestMementosProjectRegistrationValue({
    target_selector: PROJECT_ID,
    expected: "absent",
  });
  const request: MementosProjectRegistrationRequest = {
    operation_id: operationId,
    step_id: "mementos_project",
    resource_kind: "project",
    direction: "forward",
    authority_route: capability.route,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    target_selector: PROJECT_ID,
    idempotency_key: deriveMementosProjectRegistrationIdempotencyKey({
      operation_id: operationId,
      step_id: "mementos_project",
      direction: "forward",
      target_selector: PROJECT_ID,
      request_digest: requestDigest,
      precondition_digest: preconditionDigest,
    }),
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    project_id: PROJECT_ID,
    project_slug: PROJECT_SLUG,
    project_name: PROJECT_NAME,
    desired,
    target,
    response_byte_limit: 65_536,
    time_budget_ms: 5_000,
  };
  return { authority: registrationAuthority, request };
}

async function inverseRequest(
  registrationAuthority: MementosProjectRegistrationAuthority,
  accepted: MementosProjectRegistrationReceipt,
): Promise<MementosProjectRegistrationRequest> {
  const capability = await registrationAuthority.capability();
  const desired = {
    accepted_receipt_id: accepted.receipt_id,
    target_id: accepted.target_id,
  };
  const precondition = {
    expected_revision: accepted.result_revision,
    expected_digest: accepted.result_digest,
  };
  const requestDigest = digestMementosProjectRegistrationValue(desired);
  const preconditionDigest = digestMementosProjectRegistrationValue(precondition);
  return {
    operation_id: accepted.operation_id,
    step_id: accepted.step_id,
    resource_kind: "project",
    direction: "inverse",
    authority_route: capability.route,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    target_selector: accepted.target_id!,
    idempotency_key: deriveMementosProjectRegistrationIdempotencyKey({
      operation_id: accepted.operation_id,
      step_id: accepted.step_id,
      direction: "inverse",
      target_selector: accepted.target_id!,
      request_digest: requestDigest,
      precondition_digest: preconditionDigest,
    }),
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    project_id: PROJECT_ID,
    project_slug: PROJECT_SLUG,
    project_name: PROJECT_NAME,
    desired,
    target: new OwnedPathHandle(PROJECT_PATH),
    accepted_receipt: accepted,
    response_byte_limit: 65_536,
    time_budget_ms: 5_000,
  };
}

beforeEach(() => {
  resetDatabase();
});

describe("package-owned Mementos project registration authority", () => {
  test("guarded path update is callable, bounded, replay-safe, stale-safe, private, and exactly reversible", async () => {
    const db = getDatabase();
    const registrationAuthority = createLocalMementosProjectRegistrationAuthority(db, {
      packageVersion: "0.14.81-guarded-test",
    });
    const capability = await registrationAuthority.capability();
    const originalPath = "/private/projects/guarded-original";
    const updatedPath = "/private/projects/guarded-updated";
    const original = registerProject(
      "Guarded original",
      originalPath,
      "must survive rollback",
      "guarded_original",
      db,
    );
    const guardedAuthority = registrationAuthority;

    expect(capability).toMatchObject({
      guarded_update: true,
      guarded_update_route: MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE,
      expected_revision_compare_and_swap: true,
      caller_idempotency: true,
      exact_inverse_rollback: true,
    });
    expect(typeof guardedAuthority.guardedUpdateProject).toBe("function");
    expect(typeof guardedAuthority.getGuardedProjectUpdateReceipt).toBe("function");
    expect(typeof guardedAuthority.rollbackGuardedProjectUpdate).toBe("function");

    const updateRequest = {
      authority: "mementos",
      authority_route: MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      operation_id: "registration-guarded-update-v1",
      step_id: "mementos_project_path_repair",
      idempotency_key: "registration-guarded-update-key-0001",
      expected_revision: original.updated_at,
      updates: { path: new OwnedPathHandle(updatedPath) },
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    };
    await expect(registrationAuthority.guardedUpdateProject(original.id, {
      ...updateRequest,
      time_budget_ms: 0,
    })).rejects.toMatchObject({
      code: "MEMENTOS_PROJECT_REGISTRATION_INVALID_BOUNDS",
    });
    expect(getProject(original.id, db)).toEqual(original);

    const accepted = await guardedAuthority.guardedUpdateProject(original.id, updateRequest);
    expect(accepted).toMatchObject({
      dry_run: false,
      applied: true,
      record: { target_id: original.id },
      receipt: {
        authority: "mementos",
        route: MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE,
        direction: "forward",
        operation_id: updateRequest.operation_id,
        step_id: updateRequest.step_id,
        idempotency_key: updateRequest.idempotency_key,
        target_id: original.id,
        expected_revision: original.updated_at,
      },
      response_control: {
        complete: true,
        truncated: false,
        response_byte_limit: 65_536,
        time_budget_ms: 5_000,
      },
    });
    expect(accepted.record.revision).toBe(accepted.receipt.result_revision);
    expect(accepted.response_control.response_bytes).toBe(
      Buffer.byteLength(JSON.stringify(accepted), "utf8"),
    );
    expect(accepted.response_control.elapsed_ms).toBeLessThanOrEqual(
      accepted.response_control.time_budget_ms,
    );
    expect(accepted.receipt).not.toHaveProperty("before_project");
    expect(accepted.receipt).not.toHaveProperty("after_project");
    expect(JSON.stringify({ capability, accepted })).not.toContain(originalPath);
    expect(JSON.stringify({ capability, accepted })).not.toContain(updatedPath);

    const readback = await registrationAuthority.readExact({
      resource_kind: "project",
      target_id: original.id,
      target: updateRequest.updates.path,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    });
    expect(readback).toEqual(accepted.record);

    const forwardReference = createSessionJob({
      session_id: "guarded-forward-replay-reference",
      transcript: "supported forward replay reference",
      project_id: original.id,
    }, db);
    expect(getSessionJob(forwardReference.id, db)?.project_id).toBe(original.id);
    expect(getProject(original.id, db)?.updated_at).toBe(accepted.record.revision);
    const duplicate = await guardedAuthority.guardedUpdateProject(original.id, updateRequest);

    const lookupRequest = {
      authority: "mementos",
      authority_route: MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    };
    const lookup = await guardedAuthority.getGuardedProjectUpdateReceipt(
      original.id,
      accepted.receipt.receipt_id,
      lookupRequest,
    );
    expect(lookup.receipt).toEqual(accepted.receipt);
    expect(lookup.response_control.response_bytes).toBe(
      Buffer.byteLength(JSON.stringify(lookup), "utf8"),
    );
    expect(JSON.stringify(lookup)).not.toContain(originalPath);
    expect(JSON.stringify(lookup)).not.toContain(updatedPath);

    await expect(guardedAuthority.guardedUpdateProject(original.id, {
      ...updateRequest,
      idempotency_key: "registration-guarded-stale-key-0001",
      updates: { path: new OwnedPathHandle("/private/projects/stale-clobber") },
    })).rejects.toMatchObject({
      code: "MEMENTOS_PROJECT_REGISTRATION_CONFLICT",
      details: { project_update_code: "PROJECT_UPDATE_STALE_REVISION" },
    });
    expect(getProject(original.id, db)?.path).toBe(updatedPath);

    await expect(guardedAuthority.getGuardedProjectUpdateReceipt(
      original.id,
      accepted.receipt.receipt_id,
      { ...lookupRequest, response_byte_limit: 1 },
    )).rejects.toMatchObject({
      code: "MEMENTOS_PROJECT_REGISTRATION_RESPONSE_TOO_LARGE",
    });

    const rollbackRequest = {
      ...lookupRequest,
      operation_id: "registration-guarded-update-v1",
      step_id: "mementos_project_path_rollback",
      idempotency_key: "registration-guarded-rollback-key-0001",
      expected_revision: accepted.receipt.result_revision,
      accepted_receipt: accepted.receipt,
    };
    const rolledBack = await guardedAuthority.rollbackGuardedProjectUpdate(
      original.id,
      rollbackRequest,
    );
    expect(rolledBack).toMatchObject({
      applied: true,
      record: { target_id: original.id, revision: original.updated_at },
      receipt: {
        direction: "rollback",
        accepted_receipt_id: accepted.receipt.receipt_id,
      },
    });
    expect(getProject(original.id, db)).toEqual(original);
    expect(JSON.stringify(rolledBack)).not.toContain(originalPath);
    expect(JSON.stringify(rolledBack)).not.toContain(updatedPath);
    const rollbackReadback = await registrationAuthority.readExact({
      resource_kind: "project",
      target_id: original.id,
      target: new OwnedPathHandle(originalPath),
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    });
    expect(rollbackReadback).toEqual(rolledBack.record);
    const rollbackReference = createSessionJob({
      session_id: "guarded-rollback-replay-reference",
      transcript: "supported rollback replay reference",
      project_id: original.id,
    }, db);
    expect(getSessionJob(rollbackReference.id, db)?.project_id).toBe(original.id);
    expect(getProject(original.id, db)?.updated_at).toBe(rolledBack.record.revision);
    const rollbackDuplicate = await guardedAuthority.rollbackGuardedProjectUpdate(
      original.id,
      rollbackRequest,
    );
    const replayedPublicResults = [
      acceptedGuardedResult(duplicate),
      acceptedGuardedResult(rollbackDuplicate),
    ];
    const acceptedPublicResults = [
      acceptedGuardedResult(accepted),
      acceptedGuardedResult(rolledBack),
    ];
    expect(replayedPublicResults).toEqual(acceptedPublicResults);
    expect(JSON.stringify(replayedPublicResults)).toBe(JSON.stringify(acceptedPublicResults));
    expect(JSON.stringify(replayedPublicResults)).not.toContain(originalPath);
    expect(JSON.stringify(replayedPublicResults)).not.toContain(updatedPath);
  });

  test("creates once, reads back by full id, and returns duplicate-of-accepted on byte-identical retry", async () => {
    const db = getDatabase();
    const { authority: registrationAuthority, request } = await forwardRequest(
      new OwnedPathHandle(PROJECT_PATH),
      undefined,
      db,
    );

    const accepted = await registrationAuthority.create(request);
    expect(accepted).toMatchObject({
      authority: "mementos",
      outcome: "accepted",
      created_by_operation: true,
      duplicate_of_receipt_id: null,
    });
    expect(accepted.target_id).toMatch(/^mm_project_[0-9a-f]{40}$/);
    expect(JSON.stringify(accepted)).not.toContain(PROJECT_PATH);

    const readback = await registrationAuthority.readExact({
      resource_kind: "project",
      target_id: accepted.target_id!,
      target: request.target,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    });
    expect(readback).toEqual({
      target_id: accepted.target_id,
      revision: accepted.result_revision,
      digest: accepted.result_digest,
    });

    const duplicate = await registrationAuthority.create(request);
    expect(duplicate).toMatchObject({
      outcome: "duplicate_of_accepted",
      target_id: accepted.target_id,
      result_revision: accepted.result_revision,
      result_digest: accepted.result_digest,
      duplicate_of_receipt_id: accepted.receipt_id,
      created_by_operation: false,
    });
    expect(getProject(accepted.target_id!, db)?.updated_at).toBe(accepted.result_revision);

    const lookup = await registrationAuthority.lookupReceipt({
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: request.direction,
      authority: "mementos",
      authority_route: request.authority_route,
      package_version: request.package_version,
      authority_id: request.authority_id,
      tenant_id: request.tenant_id,
      corpus_id: request.corpus_id,
      target_selector: request.target_selector,
      idempotency_key: request.idempotency_key,
      target_id: accepted.target_id!,
      max_items: 1,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    });
    expect(lookup.receipt.receipt_id).toBe(duplicate.receipt_id);
    expect(lookup.response_control).toMatchObject({
      complete: true,
      truncated: false,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    });
    expect(lookup.response_control.response_bytes).toBe(
      Buffer.byteLength(JSON.stringify(lookup), "utf8"),
    );
  });

  test("a pre-existing project at the canonical path is terminal nonacceptance with zero project mutation", async () => {
    const db = getDatabase();
    const existing = registerProject("existing", PROJECT_PATH, "keep-me", "keep", db);
    const before = db.query("SELECT * FROM projects WHERE id = ?").get(existing.id);
    const { authority: registrationAuthority, request } = await forwardRequest(
      new OwnedPathHandle(PROJECT_PATH),
      "fleet-resources-conflict-v1",
      db,
    );

    const receipt = await registrationAuthority.create(request);
    expect(receipt).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "target_preexists",
      target_id: existing.id,
      created_by_operation: false,
    });
    expect(db.query("SELECT * FROM projects WHERE id = ?").get(existing.id)).toEqual(before);
    expect(db.query("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 1 });
  });

  test("byte-identical retries reuse immutable duplicate evidence across clock ticks", async () => {
    const db = getDatabase();
    let tick = 0;
    const advancing = authority(
      db,
      undefined,
      () => new Date(Date.UTC(2026, 7, 7, 12, 0, tick++)).toISOString(),
    );
    const capability = await advancing.capability();
    const { request } = await forwardRequest(
      new OwnedPathHandle(PROJECT_PATH),
      "fleet-resources-advancing-clock-v1",
      db,
    );
    Object.assign(request, {
      authority_route: capability.route,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
    });
    request.idempotency_key = deriveMementosProjectRegistrationIdempotencyKey(request);

    const accepted = await advancing.create(request);
    const firstDuplicate = await advancing.create(request);
    const secondDuplicate = await advancing.create(request);

    expect(accepted.outcome).toBe("accepted");
    expect(firstDuplicate.outcome).toBe("duplicate_of_accepted");
    expect(secondDuplicate).toEqual(firstDuplicate);
  });

  test.each([
    "before_object_write",
    "after_object_write",
    "before_receipt_write",
    "after_receipt_write",
  ] as const)("%s rolls object and accepted receipt back before returning terminal evidence", async (point) => {
    const db = getDatabase();
    const throwingAuthority = authority(db, (current) => {
      if (current === point) throw new Error(`injected:${point}`);
    });
    const capability = await throwingAuthority.capability();
    const { request } = await forwardRequest(
      new OwnedPathHandle(PROJECT_PATH),
      `fleet-resources-${point}-v1`,
      db,
    );
    Object.assign(request, {
      authority_route: capability.route,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
    });
    request.idempotency_key = deriveMementosProjectRegistrationIdempotencyKey(request);

    const receipt = await throwingAuthority.create(request);
    expect(receipt).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: `write_failed:${point}`,
      target_id: null,
    });
    expect(db.query("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 0 });
  });

  test("after-commit disconnect is reconciled by exact immutable lookup and retry", async () => {
    const db = getDatabase();
    const disconnecting = authority(db, (point) => {
      if (point === "after_commit") throw new Error("simulated response disconnect");
    });
    const capability = await disconnecting.capability();
    const { request } = await forwardRequest(
      new OwnedPathHandle(PROJECT_PATH),
      "fleet-resources-disconnect-v1",
      db,
    );
    Object.assign(request, {
      authority_route: capability.route,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
    });
    request.idempotency_key = deriveMementosProjectRegistrationIdempotencyKey(request);

    await expect(disconnecting.create(request)).rejects.toThrow("simulated response disconnect");
    const lookup = await disconnecting.lookupReceipt({
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: request.direction,
      authority: "mementos",
      authority_route: request.authority_route,
      package_version: request.package_version,
      authority_id: request.authority_id,
      tenant_id: request.tenant_id,
      corpus_id: request.corpus_id,
      target_selector: request.target_selector,
      idempotency_key: request.idempotency_key,
      max_items: 1,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    });
    expect(lookup.receipt.outcome).toBe("accepted");
    await expect(disconnecting.create(request)).rejects.toThrow("simulated response disconnect");
    const reconciled = await disconnecting.lookupReceipt({
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: request.direction,
      authority: "mementos",
      authority_route: request.authority_route,
      package_version: request.package_version,
      authority_id: request.authority_id,
      tenant_id: request.tenant_id,
      corpus_id: request.corpus_id,
      target_selector: request.target_selector,
      idempotency_key: request.idempotency_key,
      max_items: 1,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    });
    expect(reconciled.receipt).toMatchObject({
      outcome: "duplicate_of_accepted",
      duplicate_of_receipt_id: lookup.receipt.receipt_id,
    });
  });

  test("receipt-scoped inverse deletes only the unchanged attempt-created project", async () => {
    const db = getDatabase();
    const { authority: registrationAuthority, request } = await forwardRequest(
      new OwnedPathHandle(PROJECT_PATH),
      "fleet-resources-inverse-v1",
      db,
    );
    const accepted = await registrationAuthority.create(request);
    const inverse = await inverseRequest(registrationAuthority, accepted);

    const receipt = await registrationAuthority.compensate(inverse);
    expect(receipt).toMatchObject({
      outcome: "accepted",
      direction: "inverse",
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
      result_revision: "absent",
    });
    expect(getProject(accepted.target_id!, db)).toBeNull();
    await expect(registrationAuthority.verifyInverse(inverse)).resolves.toMatchObject({
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
      absent: true,
    });

    const duplicate = await registrationAuthority.compensate(inverse);
    expect(duplicate).toMatchObject({
      outcome: "duplicate_of_accepted",
      duplicate_of_receipt_id: receipt.receipt_id,
      accepted_receipt_id: accepted.receipt_id,
    });
    await expect(registrationAuthority.verifyInverse(inverse)).resolves.toMatchObject({
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
      absent: true,
    });
  });

  test("a failed inverse is terminal and a byte-identical retry cannot delete later", async () => {
    const db = getDatabase();
    const { authority: registrationAuthority, request } = await forwardRequest(
      new OwnedPathHandle(PROJECT_PATH),
      "fleet-resources-inverse-terminal-v1",
      db,
    );
    const accepted = await registrationAuthority.create(request);
    const inverse = await inverseRequest(registrationAuthority, accepted);
    const failingInverse = authority(db, (point, context) => {
      if (context.direction === "inverse" && point === "after_object_write") {
        throw new Error("injected inverse failure");
      }
    });

    const failed = await failingInverse.compensate(inverse);
    expect(failed).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "write_failed:after_object_write",
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
    });
    expect(getProject(accepted.target_id!, db)).not.toBeNull();

    const retry = await registrationAuthority.compensate(inverse);
    expect(retry).toEqual(failed);
    expect(getProject(accepted.target_id!, db)).not.toBeNull();
  });

  test("receipt-scoped inverse preserves a project referenced by a supported session job", async () => {
    const db = getDatabase();
    const { authority: registrationAuthority, request } = await forwardRequest(
      new OwnedPathHandle(PROJECT_PATH),
      "fleet-resources-session-job-dependent-v1",
      db,
    );
    const accepted = await registrationAuthority.create(request);
    const job = createSessionJob({
      session_id: "session-job-dependent",
      transcript: "supported queued transcript",
      project_id: accepted.target_id!,
    }, db);
    expect(accepted.outcome).toBe("accepted");
    expect(getSessionJob(job.id, db)?.project_id).toBe(accepted.target_id);

    const inverse = await inverseRequest(registrationAuthority, accepted);
    const receipt = await registrationAuthority.compensate(inverse);

    expect(receipt).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "target_has_dependents",
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
    });
    expect(getProject(accepted.target_id!, db)).not.toBeNull();
    expect(getSessionJob(job.id, db)?.project_id).toBe(accepted.target_id);

    const retry = await registrationAuthority.compensate(inverse);
    expect(retry).toEqual(receipt);
    expect(getProject(accepted.target_id!, db)).not.toBeNull();
    expect(getSessionJob(job.id, db)?.project_id).toBe(accepted.target_id);
  });

  test("receipt-scoped inverse refuses a drifted project and preserves it", async () => {
    const db = getDatabase();
    const { authority: registrationAuthority, request } = await forwardRequest(
      new OwnedPathHandle(PROJECT_PATH),
      "fleet-resources-drift-v1",
      db,
    );
    const accepted = await registrationAuthority.create(request);
    db.run("UPDATE projects SET description = ?, updated_at = ? WHERE id = ?", [
      "concurrent owner update",
      "2026-08-07T12:01:00.000Z",
      accepted.target_id,
    ]);
    const inverse = await inverseRequest(registrationAuthority, accepted);

    const receipt = await registrationAuthority.compensate(inverse);
    expect(receipt).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "target_drifted",
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
    });
    expect(getProject(accepted.target_id!, db)?.description).toBe("concurrent owner update");
  });

  test("bounded lookup rejects anything except one exact terminal item", async () => {
    const db = getDatabase();
    const { authority: registrationAuthority, request } = await forwardRequest(
      new OwnedPathHandle(PROJECT_PATH),
      "fleet-resources-bounds-v1",
      db,
    );
    await registrationAuthority.create(request);

    await expect(registrationAuthority.lookupReceipt({
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: request.direction,
      authority: "mementos",
      authority_route: request.authority_route,
      package_version: request.package_version,
      authority_id: request.authority_id,
      tenant_id: request.tenant_id,
      corpus_id: request.corpus_id,
      target_selector: request.target_selector,
      idempotency_key: request.idempotency_key,
      max_items: 2 as 1,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    })).rejects.toMatchObject<MementosProjectRegistrationError>({
      code: "MEMENTOS_PROJECT_REGISTRATION_INVALID_BOUNDS",
    });
  });
});
