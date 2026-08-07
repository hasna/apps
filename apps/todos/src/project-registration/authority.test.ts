import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createPlan, getPlan } from "../db/plans.js";
import { createProject, getProject, updateProject } from "../db/projects.js";
import { createTaskList, getTaskList, updateTaskList } from "../db/task-lists.js";
import { createTask, getTask } from "../db/tasks.js";
import {
  TodosProjectRegistrationError,
  PostgresTodosProjectRegistrationBackend,
  canonicalProjectRegistrationJson,
  createLocalTodosProjectRegistrationAuthority,
  createTodosProjectRegistrationHttpClient,
  deriveTodosProjectRegistrationIdempotencyKey,
  digestProjectRegistrationValue,
  handleTodosProjectRegistrationHttpRequest,
  postgresTodosProjectRegistrationSchemaSql,
  type TodosProjectRegistrationAuthority,
  type TodosProjectRegistrationFaultPoint,
  type TodosProjectRegistrationRequest,
} from "./index.js";

const OPERATION_ID = "fleet-resources-registration-0001";
const BOUNDS = {
  response_byte_limit: 65_536,
  time_budget_ms: 5_000,
} as const;

let db: Database;
let authority: TodosProjectRegistrationAuthority;
let armedFault: TodosProjectRegistrationFaultPoint | null;

beforeEach(() => {
  resetDatabase();
  db = getDatabase(":memory:");
  armedFault = null;
  authority = createLocalTodosProjectRegistrationAuthority(db, {
    packageVersion: "0.15.6-test",
    authorityId: "todos-test-authority",
    tenantId: "tenant-test",
    corpusId: "corpus-test",
    faultInjector(point) {
      if (point !== armedFault) return;
      armedFault = null;
      throw new Error(`injected:${point}`);
    },
  });
});

afterEach(() => resetDatabase());

function projectRequest(
  overrides: Partial<TodosProjectRegistrationRequest> = {},
): TodosProjectRegistrationRequest {
  const desired = overrides.desired ?? {
    source_project_id: "wks_fleetresources01",
    source_project_slug: "fleet-resources",
    name: "Fleet Resources",
  };
  const operationId = overrides.operation_id ?? OPERATION_ID;
  const stepId = overrides.step_id ?? "todos_project";
  const direction = overrides.direction ?? "forward";
  const targetSelector = overrides.target_selector ?? "wks_fleetresources01";
  const requestDigest = overrides.request_digest
    ?? digestProjectRegistrationValue(desired);
  const preconditionDigest = overrides.precondition_digest
    ?? digestProjectRegistrationValue({
      target_selector: targetSelector,
      expected: "absent",
    });
  return {
    operation_id: operationId,
    step_id: stepId,
    resource_kind: "project",
    direction,
    authority_route: "todos.project-registration.v1",
    package_version: "0.15.6-test",
    authority_id: "todos-test-authority",
    tenant_id: "tenant-test",
    corpus_id: "corpus-test",
    target_selector: targetSelector,
    idempotency_key: overrides.idempotency_key
      ?? deriveTodosProjectRegistrationIdempotencyKey({
        operation_id: operationId,
        step_id: stepId,
        direction,
        target_selector: targetSelector,
        request_digest: requestDigest,
        precondition_digest: preconditionDigest,
      }),
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    project_id: overrides.project_id ?? "wks_fleetresources01",
    project_slug: overrides.project_slug ?? "fleet-resources",
    project_name: overrides.project_name ?? "Fleet Resources",
    desired,
    target: overrides.target ?? null,
    ...BOUNDS,
    ...overrides,
  };
}

function taskListRequest(
  todosProjectId: string,
  overrides: Partial<TodosProjectRegistrationRequest> = {},
): TodosProjectRegistrationRequest {
  const desired = overrides.desired ?? {
    todos_project_id: todosProjectId,
    source_project_id: "wks_fleetresources01",
    name: "Fleet Resources",
  };
  const operationId = overrides.operation_id ?? OPERATION_ID;
  const stepId = overrides.step_id ?? "todos_task_list";
  const direction = overrides.direction ?? "forward";
  const targetSelector = overrides.target_selector ?? `${todosProjectId}:default`;
  const requestDigest = overrides.request_digest
    ?? digestProjectRegistrationValue(desired);
  const preconditionDigest = overrides.precondition_digest
    ?? digestProjectRegistrationValue({
      target_selector: targetSelector,
      expected: "absent",
    });
  return {
    operation_id: operationId,
    step_id: stepId,
    resource_kind: "task_list",
    direction,
    authority_route: "todos.project-registration.v1",
    package_version: "0.15.6-test",
    authority_id: "todos-test-authority",
    tenant_id: "tenant-test",
    corpus_id: "corpus-test",
    target_selector: targetSelector,
    idempotency_key: overrides.idempotency_key
      ?? deriveTodosProjectRegistrationIdempotencyKey({
        operation_id: operationId,
        step_id: stepId,
        direction,
        target_selector: targetSelector,
        request_digest: requestDigest,
        precondition_digest: preconditionDigest,
      }),
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    project_id: overrides.project_id ?? "wks_fleetresources01",
    project_slug: overrides.project_slug ?? "fleet-resources",
    project_name: overrides.project_name ?? "Fleet Resources",
    desired,
    target: overrides.target ?? null,
    ...BOUNDS,
    ...overrides,
  };
}

function inverseRequest(
  accepted: Awaited<ReturnType<TodosProjectRegistrationAuthority["create"]>>,
  forward: TodosProjectRegistrationRequest,
): TodosProjectRegistrationRequest {
  const desired = {
    accepted_receipt_id: accepted.receipt_id,
    target_id: accepted.target_id,
  };
  const precondition = {
    expected_revision: accepted.result_revision,
    expected_digest: accepted.result_digest,
  };
  const requestDigest = digestProjectRegistrationValue(desired);
  const preconditionDigest = digestProjectRegistrationValue(precondition);
  return {
    ...forward,
    direction: "inverse",
    desired,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    target_selector: accepted.target_id!,
    idempotency_key: deriveTodosProjectRegistrationIdempotencyKey({
      operation_id: forward.operation_id,
      step_id: forward.step_id,
      direction: "inverse",
      target_selector: accepted.target_id!,
      request_digest: requestDigest,
      precondition_digest: preconditionDigest,
    }),
    accepted_receipt: accepted,
  };
}

async function exactLookup(request: TodosProjectRegistrationRequest) {
  const capability = await authority.capability();
  return authority.lookupReceipt({
    operation_id: request.operation_id,
    step_id: request.step_id,
    resource_kind: request.resource_kind,
    direction: request.direction,
    authority: "todos",
    authority_route: capability.route,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    target_selector: request.target_selector,
    idempotency_key: request.idempotency_key,
    max_items: 1,
    ...BOUNDS,
  });
}

describe("Todos package-owned project registration authority", () => {
  test("advertises the exact conditional registration capabilities", async () => {
    expect(await authority.capability()).toEqual({
      authority: "todos",
      route: "todos.project-registration.v1",
      package_version: "0.15.6-test",
      authority_id: "todos-test-authority",
      tenant_id: "tenant-test",
      corpus_id: "corpus-test",
      supported_resources: ["project", "task_list"],
      conditional_create: true,
      immutable_receipts: true,
      exact_terminal_lookup: true,
      exact_readback: true,
      conditional_inverse: true,
      ambiguous_outcome_reconciliation: true,
    });
  });

  test("normalizes digests and derives the Projects operation/step/direction key deterministically", () => {
    expect(canonicalProjectRegistrationJson({ z: 1, a: { d: 2, b: 3 } }))
      .toBe('{"a":{"b":3,"d":2},"z":1}');
    const request = projectRequest();
    expect(request.idempotency_key).toBe(
      deriveTodosProjectRegistrationIdempotencyKey({
        operation_id: request.operation_id,
        step_id: request.step_id,
        direction: request.direction,
        target_selector: request.target_selector,
        request_digest: request.request_digest,
        precondition_digest: request.precondition_digest,
      }),
    );
    expect(request.idempotency_key).toMatch(/^prk_[0-9a-f]{48}$/);
  });

  test("conditionally creates a generic Fleet Resources project and exact project-owned task list", async () => {
    const projectCall = projectRequest();
    const projectReceipt = await authority.create(projectCall);
    expect(projectReceipt).toMatchObject({
      outcome: "accepted",
      resource_kind: "project",
      direction: "forward",
      created_by_operation: true,
      duplicate_of_receipt_id: null,
    });
    expect(projectReceipt.target_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(getProject(projectReceipt.target_id!, db)).toMatchObject({
      id: projectReceipt.target_id,
      name: "Fleet Resources",
      task_list_id: "todos-fleet-resources",
    });
    expect(await authority.readExact({
      resource_kind: "project",
      target_id: projectReceipt.target_id!,
      target: null,
      ...BOUNDS,
    })).toEqual({
      target_id: projectReceipt.target_id,
      revision: projectReceipt.result_revision,
      digest: projectReceipt.result_digest,
    });

    const listCall = taskListRequest(projectReceipt.target_id!);
    const listReceipt = await authority.create(listCall);
    expect(listReceipt).toMatchObject({
      outcome: "accepted",
      resource_kind: "task_list",
      created_by_operation: true,
    });
    const list = getTaskList(listReceipt.target_id!, db);
    expect(list).toMatchObject({
      id: listReceipt.target_id,
      project_id: projectReceipt.target_id,
      slug: "todos-fleet-resources",
      name: "Fleet Resources",
    });
    expect(list!.project_id).toBe(projectReceipt.target_id);
    expect(await authority.readExact({
      resource_kind: "task_list",
      target_id: listReceipt.target_id!,
      target: null,
      ...BOUNDS,
    })).toEqual({
      target_id: listReceipt.target_id,
      revision: listReceipt.result_revision,
      digest: listReceipt.result_digest,
    });
  });

  test("uses the authenticated HTTP adapter without serializing the opaque target handle", async () => {
    const client = createTodosProjectRegistrationHttpClient({
      baseUrl: "https://todos.test",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const response = await handleTodosProjectRegistrationHttpRequest(
          request,
          new URL(request.url),
          authority,
        );
        return response ?? new Response("not found", { status: 404 });
      },
    });
    expect(await client.capability()).toEqual(await authority.capability());
    const request = projectRequest({
      operation_id: "fleet-resources-http-client-0001",
      project_id: "wks_fleethttpclient01",
      target_selector: "wks_fleethttpclient01",
      project_slug: "fleet-resources-http",
      project_name: "Fleet Resources HTTP",
      desired: {
        source_project_id: "wks_fleethttpclient01",
        source_project_slug: "fleet-resources-http",
        name: "Fleet Resources HTTP",
      },
      target: {
        toJSON() {
          throw new Error("opaque target must never be serialized");
        },
      },
    });
    const receipt = await client.create(request);
    expect(receipt).toMatchObject({
      outcome: "accepted",
      resource_kind: "project",
      created_by_operation: true,
    });
    expect(await client.readExact({
      resource_kind: "project",
      target_id: receipt.target_id!,
      target: request.target,
      ...BOUNDS,
    })).toEqual({
      target_id: receipt.target_id,
      revision: receipt.result_revision,
      digest: receipt.result_digest,
    });
    const plan = createPlan({
      name: "HTTP foreign plan",
      project_id: receipt.target_id!,
    }, db);
    const rejected = await client.compensate(inverseRequest(receipt, request));
    expect(rejected).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "target_has_dependents",
      target_id: receipt.target_id,
      accepted_receipt_id: receipt.receipt_id,
    });
    expect(getPlan(plan.id, db)?.project_id).toBe(receipt.target_id);
  });

  test("accepts iapp-* project slugs without legacy iproj prefix logic", async () => {
    const request = projectRequest({
      operation_id: "iapp-emails-registration-0001",
      project_id: "wks_iappemails000001",
      project_slug: "iapp-emails",
      project_name: "iapp Emails",
      target_selector: "wks_iappemails000001",
      desired: {
        source_project_id: "wks_iappemails000001",
        source_project_slug: "iapp-emails",
        name: "iapp Emails",
      },
    });
    const normalized = projectRequest(request);
    const receipt = await authority.create(normalized);
    expect(receipt.outcome).toBe("accepted");
    expect(getProject(receipt.target_id!, db)?.task_list_id).toBe("todos-iapp-emails");
  });

  test("returns one bounded immutable terminal receipt from exact lookup", async () => {
    const request = projectRequest();
    const accepted = await authority.create(request);
    const lookup = await exactLookup(request);
    expect(lookup.receipt).toEqual(accepted);
    expect(lookup.response_control).toMatchObject({
      response_byte_limit: BOUNDS.response_byte_limit,
      time_budget_ms: BOUNDS.time_budget_ms,
      complete: true,
      truncated: false,
    });
    expect(lookup.response_control.response_bytes).toBeGreaterThan(0);
    expect(lookup.response_control.response_bytes).toBeLessThanOrEqual(BOUNDS.response_byte_limit);
    expect(lookup.response_control.response_bytes)
      .toBe(Buffer.byteLength(JSON.stringify(lookup), "utf8"));
    expect(lookup.response_control.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(lookup.response_control.elapsed_ms).toBeLessThanOrEqual(BOUNDS.time_budget_ms);

    expect(() => db.run(
      "UPDATE todos_project_registration_receipts SET reason = 'changed' WHERE receipt_id = ?",
      [accepted.receipt_id],
    )).toThrow(/immutable/i);
    expect(() => db.run(
      "DELETE FROM todos_project_registration_receipts WHERE receipt_id = ?",
      [accepted.receipt_id],
    )).toThrow(/immutable/i);
  });

  test("enforces positive byte/time bounds and max_items exactly one at the producer", async () => {
    const request = projectRequest();
    await authority.create(request);
    const capability = await authority.capability();
    const baseLookup = {
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: request.direction,
      authority: "todos" as const,
      authority_route: capability.route,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      target_selector: request.target_selector,
      idempotency_key: request.idempotency_key,
      response_byte_limit: BOUNDS.response_byte_limit,
      time_budget_ms: BOUNDS.time_budget_ms,
    };
    await expect(authority.lookupReceipt({ ...baseLookup, max_items: 2 as 1 }))
      .rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_INVALID_BOUNDS" });
    await expect(authority.lookupReceipt({
      ...baseLookup,
      max_items: 1,
      response_byte_limit: 0,
    })).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_INVALID_BOUNDS" });
    await expect(authority.lookupReceipt({
      ...baseLookup,
      max_items: 1,
      time_budget_ms: 0,
    })).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_INVALID_BOUNDS" });
    await expect(authority.lookupReceipt({
      ...baseLookup,
      max_items: 1,
      response_byte_limit: 1,
    })).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_RESPONSE_TOO_LARGE" });

    const boundedCreate = projectRequest({
      operation_id: "fleet-resources-response-bound-0001",
      project_id: "wks_fleetbytebound01",
      target_selector: "wks_fleetbytebound01",
      project_slug: "fleet-resources-byte",
      project_name: "Fleet Resources Byte",
      desired: {
        source_project_id: "wks_fleetbytebound01",
        source_project_slug: "fleet-resources-byte",
        name: "Fleet Resources Byte",
      },
      response_byte_limit: 1,
    });
    await expect(authority.create(boundedCreate))
      .rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_RESPONSE_TOO_LARGE" });
    expect((await exactLookup(boundedCreate)).receipt).toMatchObject({
      outcome: "accepted",
      created_by_operation: true,
    });

    const slowAuthority = createLocalTodosProjectRegistrationAuthority(db, {
      packageVersion: "0.15.6-test",
      authorityId: "todos-test-authority",
      tenantId: "tenant-test",
      corpusId: "corpus-test",
      async faultInjector(point) {
        if (point === "after_commit") await Bun.sleep(15);
      },
    });
    const boundedTime = projectRequest({
      operation_id: "fleet-resources-time-bound-0001",
      project_id: "wks_fleettimebound01",
      target_selector: "wks_fleettimebound01",
      desired: {
        source_project_id: "wks_fleettimebound01",
        source_project_slug: "fleet-resources-time",
        name: "Fleet Resources Time",
      },
      project_slug: "fleet-resources-time",
      project_name: "Fleet Resources Time",
      time_budget_ms: 1,
    });
    await expect(slowAuthority.create(boundedTime))
      .rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_TIME_BUDGET_EXCEEDED" });
    const slowCapability = await slowAuthority.capability();
    expect((await slowAuthority.lookupReceipt({
      operation_id: boundedTime.operation_id,
      step_id: boundedTime.step_id,
      resource_kind: boundedTime.resource_kind,
      direction: boundedTime.direction,
      authority: "todos",
      authority_route: slowCapability.route,
      package_version: slowCapability.package_version,
      authority_id: slowCapability.authority_id,
      tenant_id: slowCapability.tenant_id,
      corpus_id: slowCapability.corpus_id,
      target_selector: boundedTime.target_selector,
      idempotency_key: boundedTime.idempotency_key,
      max_items: 1,
      ...BOUNDS,
    })).receipt).toMatchObject({
      outcome: "accepted",
      created_by_operation: true,
    });
  });

  test("scopes operation-step receipts and singleton bindings to the hosted authority identity", async () => {
    const first = await authority.create(projectRequest());
    const otherAuthority = createLocalTodosProjectRegistrationAuthority(db, {
      packageVersion: "0.15.6-test",
      authorityId: "todos-test-authority",
      tenantId: "tenant-other",
      corpusId: "corpus-other",
    });
    const otherRequest = projectRequest({
      authority_id: "todos-test-authority",
      tenant_id: "tenant-other",
      corpus_id: "corpus-other",
      project_id: "wks_fleettenant002",
      target_selector: "wks_fleettenant002",
      project_slug: "fleet-resources-other",
      project_name: "Fleet Resources Other",
      desired: {
        source_project_id: "wks_fleettenant002",
        source_project_slug: "fleet-resources-other",
        name: "Fleet Resources Other",
      },
    });
    const second = await otherAuthority.create(otherRequest);
    expect(first.outcome).toBe("accepted");
    expect(second).toMatchObject({
      outcome: "accepted",
      tenant_id: "tenant-other",
      corpus_id: "corpus-other",
      created_by_operation: true,
    });
    expect(second.target_id).not.toBe(first.target_id);
  });

  test("returns a deterministic duplicate-of-accepted receipt without creating a second object", async () => {
    const request = projectRequest();
    const accepted = await authority.create(request);
    const duplicate = await authority.create(structuredClone(request));
    expect(duplicate).toMatchObject({
      outcome: "duplicate_of_accepted",
      target_id: accepted.target_id,
      result_revision: accepted.result_revision,
      result_digest: accepted.result_digest,
      duplicate_of_receipt_id: accepted.receipt_id,
      created_by_operation: false,
    });
    expect((await authority.create(structuredClone(request))).receipt_id).toBe(duplicate.receipt_id);
    expect(db.query("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 1 });
    expect((await exactLookup(request)).receipt).toEqual(duplicate);
  });

  test("terminally rejects changed request or precondition semantics for an accepted operation step", async () => {
    const request = projectRequest();
    const accepted = await authority.create(request);
    const changedDesired = {
      ...request.desired,
      name: "Fleet Resources Changed",
    };
    const changedRequestDigest = digestProjectRegistrationValue(changedDesired);
    const changed = projectRequest({
      ...request,
      desired: changedDesired,
      request_digest: changedRequestDigest,
      project_name: "Fleet Resources Changed",
      idempotency_key: deriveTodosProjectRegistrationIdempotencyKey({
        operation_id: request.operation_id,
        step_id: request.step_id,
        direction: request.direction,
        target_selector: request.target_selector,
        request_digest: changedRequestDigest,
        precondition_digest: request.precondition_digest,
      }),
    });
    const rejected = await authority.create(changed);
    expect(rejected).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "operation_step_semantics_changed",
      target_id: accepted.target_id,
      created_by_operation: false,
    });
    expect(getProject(accepted.target_id!, db)?.name).toBe("Fleet Resources");

    const changedPreconditionDigest = digestProjectRegistrationValue({
      target_selector: request.target_selector,
      expected: "present",
    });
    const changedPrecondition = projectRequest({
      ...request,
      precondition_digest: changedPreconditionDigest,
      idempotency_key: deriveTodosProjectRegistrationIdempotencyKey({
        operation_id: request.operation_id,
        step_id: request.step_id,
        direction: request.direction,
        target_selector: request.target_selector,
        request_digest: request.request_digest,
        precondition_digest: changedPreconditionDigest,
      }),
    });
    await expect(authority.create(changedPrecondition))
      .rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_DIGEST_MISMATCH" });
  });

  test("does not clobber a pre-existing ordinary project or task list", async () => {
    const existingProject = createProject({
      name: "Fleet Resources",
      path: "hasna-project://wks_fleetresources01",
      task_list_id: "todos-fleet-resources",
    }, db);
    const projectReceipt = await authority.create(projectRequest());
    expect(projectReceipt).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "target_already_exists",
      created_by_operation: false,
    });
    expect(getProject(existingProject.id, db)?.name).toBe("Fleet Resources");
    expect(db.query("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 1 });

    const listProjectCall = projectRequest({
      operation_id: "fleet-list-conflict-registration-0001",
      project_id: "wks_fleetlistconflict01",
      project_slug: "fleet-list-conflict",
      project_name: "Fleet List Conflict",
      target_selector: "wks_fleetlistconflict01",
      desired: {
        source_project_id: "wks_fleetlistconflict01",
        source_project_slug: "fleet-list-conflict",
        name: "Fleet List Conflict",
      },
    });
    const registeredProject = await authority.create(projectRequest(listProjectCall));
    const existingList = createTaskList({
      name: "Existing Queue",
      slug: "todos-fleet-list-conflict",
      project_id: registeredProject.target_id!,
    }, db);
    const listRequest = taskListRequest(registeredProject.target_id!, {
      operation_id: "fleet-list-conflict-registration-0001",
      project_id: "wks_fleetlistconflict01",
      project_slug: "fleet-list-conflict",
      project_name: "Fleet List Conflict",
      desired: {
        todos_project_id: registeredProject.target_id,
        source_project_id: "wks_fleetlistconflict01",
        name: "Fleet List Conflict",
      },
    });
    const beforeListCount = db.query(
      "SELECT COUNT(*) AS count FROM task_lists",
    ).get() as { count: number };
    const listReceipt = await authority.create(taskListRequest(
      registeredProject.target_id!,
      listRequest,
    ));
    expect(listReceipt).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "target_already_exists",
      created_by_operation: false,
    });
    expect(getTaskList(existingList.id, db)?.name).toBe("Existing Queue");
    expect(db.query("SELECT COUNT(*) AS count FROM task_lists").get())
      .toEqual({ count: beforeListCount.count });
  });

  for (const point of [
    "before_object_write",
    "after_object_write",
    "before_receipt_write",
    "after_receipt_write",
  ] as const) {
    test(`rolls back both writes and records a terminal receipt on ${point}`, async () => {
      const request = projectRequest({
        operation_id: `fleet-resources-${point}-0001`,
      });
      const normalized = projectRequest(request);
      armedFault = point;
      const terminal = await authority.create(normalized);
      expect(terminal).toMatchObject({
        outcome: "terminal_nonacceptance",
        reason: `write_failed:${point}`,
        target_id: null,
        created_by_operation: false,
      });
      expect(db.query("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 0 });
      expect((await exactLookup(normalized)).receipt).toEqual(terminal);
    });
  }

  test("reconciles an ambiguous post-commit failure through exact terminal lookup", async () => {
    const request = projectRequest({
      operation_id: "fleet-resources-after-commit-0001",
    });
    const normalized = projectRequest(request);
    armedFault = "after_commit";
    await expect(authority.create(normalized)).rejects.toThrow("injected:after_commit");
    const lookup = await exactLookup(normalized);
    expect(lookup.receipt).toMatchObject({
      outcome: "accepted",
      target_id: expect.any(String),
      created_by_operation: true,
    });
    expect(db.query("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 1 });
  });

  test("requires the exact full Todos project id for task-list creation", async () => {
    const projectReceipt = await authority.create(projectRequest());
    const exact = projectReceipt.target_id!;
    const partial = exact.slice(0, 8);
    const request = taskListRequest(partial, {
      target_selector: `${partial}:default`,
      desired: {
        todos_project_id: partial,
        source_project_id: "wks_fleetresources01",
        name: "Fleet Resources",
      },
    });
    const normalized = taskListRequest(partial, request);
    await expect(authority.create(normalized))
      .rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_EXACT_ID_REQUIRED" });
    expect(db.query("SELECT COUNT(*) AS count FROM task_lists").get()).toEqual({ count: 0 });
  });

  test("compensates only the unchanged object created by the accepted receipt", async () => {
    const forward = projectRequest();
    const accepted = await authority.create(forward);
    const inverse = inverseRequest(accepted, forward);
    const removed = await authority.compensate(inverse);
    expect(removed).toMatchObject({
      outcome: "accepted",
      direction: "inverse",
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
      result_revision: "absent",
    });
    expect(getProject(accepted.target_id!, db)).toBeNull();
    expect(await authority.verifyInverse(inverse)).toEqual({
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
      absent: true,
      digest: removed.result_digest,
    });
    expect(await authority.compensate(structuredClone(inverse))).toEqual(removed);
  });

  test("refuses project compensation when later project records would be cascaded or detached", async () => {
    const forward = projectRequest({
      operation_id: "fleet-resources-project-dependents-0001",
    });
    const accepted = await authority.create(forward);
    const plan = createPlan({
      name: "Foreign plan",
      project_id: accepted.target_id!,
    }, db);
    const task = createTask({
      title: "Foreign task",
      project_id: accepted.target_id!,
    }, db);

    const rejected = await authority.compensate(inverseRequest(accepted, forward));

    expect(rejected).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "target_has_dependents",
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
    });
    expect(getProject(accepted.target_id!, db)).not.toBeNull();
    expect(getPlan(plan.id, db)?.project_id).toBe(accepted.target_id);
    expect(getTask(task.id, db)?.project_id).toBe(accepted.target_id);
  });

  test("refuses task-list compensation when later tasks would be detached", async () => {
    const projectForward = projectRequest({
      operation_id: "fleet-resources-list-dependents-0001",
    });
    const projectAccepted = await authority.create(projectForward);
    const listForward = taskListRequest(projectAccepted.target_id!, {
      operation_id: projectForward.operation_id,
    });
    const listAccepted = await authority.create(listForward);
    const task = createTask({
      title: "Foreign list task",
      project_id: projectAccepted.target_id!,
      task_list_id: listAccepted.target_id!,
    }, db);

    const rejected = await authority.compensate(inverseRequest(listAccepted, listForward));

    expect(rejected).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "target_has_dependents",
      target_id: listAccepted.target_id,
      accepted_receipt_id: listAccepted.receipt_id,
    });
    expect(getTaskList(listAccepted.target_id!, db)).not.toBeNull();
    expect(getTask(task.id, db)?.task_list_id).toBe(listAccepted.target_id);
  });

  test("still compensates an untouched receipt-owned empty task list", async () => {
    const projectForward = projectRequest({
      operation_id: "fleet-resources-empty-list-inverse-0001",
    });
    const projectAccepted = await authority.create(projectForward);
    const listForward = taskListRequest(projectAccepted.target_id!, {
      operation_id: projectForward.operation_id,
    });
    const listAccepted = await authority.create(listForward);

    const removed = await authority.compensate(inverseRequest(listAccepted, listForward));

    expect(removed).toMatchObject({
      outcome: "accepted",
      direction: "inverse",
      target_id: listAccepted.target_id,
      accepted_receipt_id: listAccepted.receipt_id,
      result_revision: "absent",
    });
    expect(getTaskList(listAccepted.target_id!, db)).toBeNull();
    expect(getProject(projectAccepted.target_id!, db)).not.toBeNull();
  });

  for (const point of [
    "before_object_write",
    "after_object_write",
    "before_receipt_write",
    "after_receipt_write",
  ] as const) {
    test(`rolls back inverse writes and preserves the accepted object on ${point}`, async () => {
      const forward = projectRequest({
        operation_id: `fleet-resources-inverse-${point}-0001`,
      });
      const accepted = await authority.create(forward);
      const inverse = inverseRequest(accepted, forward);
      armedFault = point;
      const terminal = await authority.compensate(inverse);
      expect(terminal).toMatchObject({
        outcome: "terminal_nonacceptance",
        reason: `write_failed:${point}`,
        target_id: accepted.target_id,
        accepted_receipt_id: accepted.receipt_id,
      });
      expect(getProject(accepted.target_id!, db)).not.toBeNull();
      expect((await exactLookup(inverse)).receipt).toEqual(terminal);
    });
  }

  test("reconciles an ambiguous inverse post-commit failure through exact lookup", async () => {
    const forward = projectRequest({
      operation_id: "fleet-resources-inverse-after-commit-0001",
    });
    const accepted = await authority.create(forward);
    const inverse = inverseRequest(accepted, forward);
    armedFault = "after_commit";
    await expect(authority.compensate(inverse)).rejects.toThrow("injected:after_commit");
    const lookup = await exactLookup(inverse);
    expect(lookup.receipt).toMatchObject({
      outcome: "accepted",
      direction: "inverse",
      accepted_receipt_id: accepted.receipt_id,
      result_revision: "absent",
    });
    expect(getProject(accepted.target_id!, db)).toBeNull();
    expect(await authority.verifyInverse(inverse)).toMatchObject({
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
      absent: true,
    });
  });

  test("rejects compensation when the accepted object drifted", async () => {
    const forward = projectRequest();
    const accepted = await authority.create(forward);
    updateProject(accepted.target_id!, { description: "ordinary CRUD drift" }, db);
    const inverse = inverseRequest(accepted, forward);
    const rejected = await authority.compensate(inverse);
    expect(rejected).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "target_drifted",
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
    });
    expect(getProject(accepted.target_id!, db)?.description).toBe("ordinary CRUD drift");
  });

  test("rejects compensation of pre-existing or foreign objects", async () => {
    const existing = createProject({
      name: "Foreign",
      path: "/tmp/foreign-project-registration-test",
    }, db);
    const fakeAccepted = {
      ...(await authority.create(projectRequest())),
      receipt_id: "tpr_foreign_receipt",
      target_id: existing.id,
      result_revision: existing.updated_at,
      result_digest: digestProjectRegistrationValue(existing),
    };
    const inverse = inverseRequest(fakeAccepted, projectRequest());
    await expect(authority.compensate(inverse))
      .rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_ACCEPTED_RECEIPT_NOT_FOUND" });
    expect(getProject(existing.id, db)).not.toBeNull();
  });

  test("task-list compensation preserves its exact parent and rejects drift", async () => {
    const projectForward = projectRequest();
    const projectAccepted = await authority.create(projectForward);
    const listForward = taskListRequest(projectAccepted.target_id!);
    const listAccepted = await authority.create(listForward);
    updateTaskList(listAccepted.target_id!, { name: "Drifted Queue" }, db);
    const rejected = await authority.compensate(inverseRequest(listAccepted, listForward));
    expect(rejected).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "target_drifted",
    });
    expect(getTaskList(listAccepted.target_id!, db)).toMatchObject({
      project_id: projectAccepted.target_id,
      name: "Drifted Queue",
    });
  });

  test("ships PostgreSQL receipt/binding schema with immutable receipt guards", () => {
    const sql = postgresTodosProjectRegistrationSchemaSql().join("\n");
    expect(sql).toContain("todos_project_registration_receipts");
    expect(sql).toContain("todos_project_registration_bindings");
    expect(sql).toContain("todos_project_registration_receipts_immutable");
    expect(sql).toContain("BEFORE UPDATE OR DELETE");
    expect(sql).toContain("RAISE EXCEPTION");
    expect(sql).toContain("UNIQUE");
  });

  test("bootstraps the hosted PostgreSQL schema and requires real transactions", async () => {
    const statements: string[] = [];
    const query = async (text: string) => {
      statements.push(text);
      return { rows: [] };
    };
    const client = {
      query,
      async transaction<T>(fn: (transaction: { query: typeof query }) => Promise<T>) {
        return await fn({ query });
      },
    };
    const backend = new PostgresTodosProjectRegistrationBackend(client, {
      service: "todos_registration_test",
      tableName: "todos_sync_records_registration_test",
      cursorTableName: "todos_sync_cursors_registration_test",
    });
    await backend.ensureSchema();
    const sql = statements.join("\n");
    expect(sql).toContain("todos_sync_records_registration_test");
    expect(sql).toContain("todos_sync_cursors_registration_test");
    expect(sql).toContain("todos_project_registration_receipts");
    expect(sql).toContain("todos_project_registration_bindings");
    expect(sql).toContain("todos_project_registration_receipts_immutable");
    expect(sql).toContain("todos_project_registration_receipts_accepted_step_uidx");

    await backend.transaction(async (transaction) => {
      await transaction.lockStep({
        authority_id: "todos-test-authority",
        tenant_id: "tenant-test",
        corpus_id: "corpus-test",
        operation_id: OPERATION_ID,
        step_id: "todos_project",
        resource_kind: "project",
        direction: "forward",
      });
    });
    expect(statements.join("\n")).toContain("pg_advisory_xact_lock");

    const noTransactionBackend = new PostgresTodosProjectRegistrationBackend({
      query,
    } as ConstructorParameters<typeof PostgresTodosProjectRegistrationBackend>[0]);
    await expect(noTransactionBackend.transaction(async () => null))
      .rejects.toMatchObject({
        code: "TODOS_PROJECT_REGISTRATION_ATOMICITY_UNAVAILABLE",
      });
  });

  test("checks hosted PostgreSQL dependents through every canonical project and task-list reference", async () => {
    const statements: Array<{ text: string; params: unknown[] | undefined }> = [];
    const query = async (text: string, params?: unknown[]) => {
      statements.push({ text, params });
      if (text.includes("SELECT EXISTS")) return { rows: [{ exists: true }] };
      return { rows: [] };
    };
    const client = {
      query,
      async transaction<T>(fn: (transaction: { query: typeof query }) => Promise<T>) {
        return await fn({ query });
      },
    };
    const backend = new PostgresTodosProjectRegistrationBackend(client, {
      service: "todos_registration_test",
      tableName: "todos_sync_records_registration_test",
      cursorTableName: "todos_sync_cursors_registration_test",
    });

    await backend.transaction(async (transaction) => {
      await transaction.lockCompensationWrites();
      expect(await transaction.hasDependents(
        "project",
        "11111111-1111-4111-8111-111111111111",
      )).toBe(true);
      await transaction.lockCompensationWrites();
      expect(await transaction.hasDependents(
        "task_list",
        "22222222-2222-4222-8222-222222222222",
      )).toBe(true);
    });

    const dependentQueries = statements.filter(({ text }) => text.includes("SELECT EXISTS"));
    const lockQueries = statements.filter(({ text }) => text.includes("LOCK TABLE"));
    expect(lockQueries).toHaveLength(2);
    expect(lockQueries[0]!.text).toContain(
      "LOCK TABLE todos_sync_records_registration_test IN SHARE ROW EXCLUSIVE MODE",
    );
    expect(dependentQueries).toHaveLength(2);
    expect(dependentQueries[0]!.text).toContain("payload->>'project_id'");
    expect(dependentQueries[0]!.text).toContain("payload->>'active_project_id'");
    expect(dependentQueries[0]!.text).toContain("payload->>'assigned_from_project'");
    expect(dependentQueries[0]!.text).toContain("payload->>'external_project_id'");
    expect(dependentQueries[1]!.text).toContain("payload->>'task_list_id'");
  });

  test("uses typed authority errors for unsupported or malformed calls", async () => {
    const request = projectRequest({
      authority_route: "wrong.route",
    });
    await expect(authority.create(request)).rejects.toBeInstanceOf(TodosProjectRegistrationError);
    await expect(authority.create(request))
      .rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH" });
  });
});
