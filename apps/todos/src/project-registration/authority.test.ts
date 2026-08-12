import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createPlan, getPlan } from "../db/plans.js";
import { createProject, getProject, updateProject } from "../db/projects.js";
import { createTaskList, getTaskList, updateTaskList } from "../db/task-lists.js";
import { createTask, getTask } from "../db/tasks.js";
import {
  TodosProjectRegistrationError,
  PackageOwnedTodosProjectRegistrationAuthority,
  PostgresTodosProjectRegistrationBackend,
  SqliteTodosProjectRegistrationBackend,
  canonicalProjectRegistrationJson,
  createLocalTodosProjectRegistrationAuthority,
  createTodosProjectRegistrationHttpClient,
  deriveTodosProjectRegistrationIdempotencyKey,
  digestProjectRegistrationValue,
  handleTodosProjectRegistrationHttpRequest,
  postgresTodosProjectRegistrationSchemaSql,
  type TodosProjectRegistrationAuthority,
  type TodosProjectRegistrationFaultPoint,
  type TodosProjectRegistrationLookupRequest,
  type TodosProjectRegistrationRequest,
} from "./index.js";
import type { TodosProjectRegistrationBackend } from "./backend.js";

const OPERATION_ID = "fleet-resources-registration-0001";
const HISTORICAL_OPERATION_ID = "fleet-resources-historical-registration-0001";
const HISTORICAL_ROUTE = "todos.project-registration.v1";
const HISTORICAL_PACKAGE_VERSION = "1.0.0-rc.3";
const FABRICATED_PACKAGE_VERSION = "1.0.0-rc.7";
const HISTORICAL_PROJECT_RECEIPT_ID =
  "tpr_f3f2fdc82fc4a7a4f4ffb97c42e90ada20cff6b5";
const HISTORICAL_LIST_RECEIPT_ID =
  "tpr_a7e555c2c1f2ad855bca2cfcdde67ff2b6149cf7";
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
      expected: overrides.bind_existing === true
        ? "absent_or_matching_existing"
        : "absent",
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
      expected: overrides.bind_existing === true
        ? "absent_or_matching_existing"
        : "absent",
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

function legacyNormalizedCallDigest(
  request: TodosProjectRegistrationRequest,
): string {
  return digestProjectRegistrationValue({
    authority_route: request.authority_route,
    package_version: request.package_version,
    authority_id: request.authority_id,
    tenant_id: request.tenant_id,
    corpus_id: request.corpus_id,
    operation_id: request.operation_id,
    step_id: request.step_id,
    resource_kind: request.resource_kind,
    direction: request.direction,
    target_selector: request.target_selector,
    idempotency_key: request.idempotency_key,
    request_digest: request.request_digest,
    precondition_digest: request.precondition_digest,
    project_id: request.project_id,
    project_slug: request.project_slug,
    project_name: request.project_name,
    desired: request.desired,
    accepted_receipt_id: request.accepted_receipt?.receipt_id ?? null,
  });
}

function insertLegacyAcceptedProjectReceipt(
  request: TodosProjectRegistrationRequest,
  project: ReturnType<typeof createProject>,
): string {
  const receiptId = `tpr_legacy_${request.operation_id.replace(/[^a-z0-9]/gi, "").slice(0, 28)}`;
  const resultDigest = digestProjectRegistrationValue({
    id: project.id,
    name: project.name,
    path: project.path,
    description: project.description,
    task_list_id: project.task_list_id,
    task_prefix: project.task_prefix,
    task_counter: project.task_counter,
    created_at: project.created_at,
    updated_at: project.updated_at,
  });
  db.run(`
    INSERT INTO todos_project_registration_receipts (
      receipt_id, authority, route, package_version, authority_id, tenant_id,
      corpus_id, operation_id, step_id, resource_kind, direction,
      target_selector, idempotency_key, request_digest, precondition_digest,
      normalized_call_digest, outcome, reason, target_id, result_revision,
      result_digest, duplicate_of_receipt_id, accepted_receipt_id,
      created_by_operation, created_at
    ) VALUES (
      ?, 'todos', ?, ?, ?, ?, ?, ?, ?, 'project', 'forward', ?, ?, ?, ?, ?,
      'accepted', NULL, ?, ?, ?, NULL, NULL, 1, ?
    )
  `, [
    receiptId,
    request.authority_route,
    request.package_version,
    request.authority_id,
    request.tenant_id,
    request.corpus_id,
    request.operation_id,
    request.step_id,
    request.target_selector,
    request.idempotency_key,
    request.request_digest,
    request.precondition_digest,
    legacyNormalizedCallDigest(request),
    project.id,
    project.updated_at,
    resultDigest,
    project.created_at,
  ]);
  return receiptId;
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

type HistoricalReceiptFixture = {
  receiptId: string;
  stepId: string;
  resourceKind: "project" | "task_list";
  targetSelector: string;
  idempotencyKey: string;
  targetId: string;
  createdAt: string;
};

function insertHistoricalReceipt(fixture: HistoricalReceiptFixture): void {
  db.run(`
    INSERT INTO todos_project_registration_receipts (
      receipt_id, authority, route, package_version, authority_id, tenant_id,
      corpus_id, operation_id, step_id, resource_kind, direction,
      target_selector, idempotency_key, request_digest, precondition_digest,
      normalized_call_digest, outcome, reason, target_id, result_revision,
      result_digest, duplicate_of_receipt_id, accepted_receipt_id,
      created_by_operation, created_at
    ) VALUES (
      ?, 'todos', ?, ?, 'todos-test-authority', 'tenant-test', 'corpus-test',
      ?, ?, ?, 'forward', ?, ?, ?, ?, ?, 'accepted', NULL, ?, ?, ?,
      NULL, NULL, 1, ?
    )
  `, [
    fixture.receiptId,
    HISTORICAL_ROUTE,
    HISTORICAL_PACKAGE_VERSION,
    HISTORICAL_OPERATION_ID,
    fixture.stepId,
    fixture.resourceKind,
    fixture.targetSelector,
    fixture.idempotencyKey,
    "1".repeat(64),
    "2".repeat(64),
    "3".repeat(64),
    fixture.targetId,
    fixture.createdAt,
    "4".repeat(64),
    fixture.createdAt,
  ]);
}

function historicalLookup(
  fixture: HistoricalReceiptFixture,
  overrides: Partial<TodosProjectRegistrationLookupRequest> = {},
): TodosProjectRegistrationLookupRequest {
  return {
    operation_id: HISTORICAL_OPERATION_ID,
    step_id: fixture.stepId,
    resource_kind: fixture.resourceKind,
    direction: "forward",
    authority: "todos",
    authority_route: HISTORICAL_ROUTE,
    package_version: HISTORICAL_PACKAGE_VERSION,
    authority_id: "todos-test-authority",
    tenant_id: "tenant-test",
    corpus_id: "corpus-test",
    target_selector: fixture.targetSelector,
    idempotency_key: fixture.idempotencyKey,
    target_id: fixture.targetId,
    max_items: 1,
    ...BOUNDS,
    ...overrides,
  };
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
      bind_existing_adoption: true,
      prior_registration_adoption_validation: true,
      project_resource_enumeration: true,
      project_resource_page_limit: 500,
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

  test("binds deterministic existing project and task-list UUIDs without taking delete ownership", async () => {
    const existingProject = createProject({
      name: "Existing Fleet Resources",
      path: "hasna-project://wks_fleetresources01",
      task_list_id: "todos-fleet-resources",
    }, db);
    const projectCall = projectRequest({ bind_existing: true });
    const projectReceipt = await authority.create(projectCall);
    expect(projectReceipt).toMatchObject({
      outcome: "accepted",
      target_id: existingProject.id,
      created_by_operation: false,
    });

    const existingTaskList = createTaskList({
      name: "Existing Fleet Resources",
      slug: "todos-fleet-resources",
      project_id: existingProject.id,
    }, db);
    const taskListCall = taskListRequest(existingProject.id, {
      bind_existing: true,
    });
    const taskListReceipt = await authority.create(taskListCall);
    expect(taskListReceipt).toMatchObject({
      outcome: "accepted",
      target_id: existingTaskList.id,
      created_by_operation: false,
    });

    expect(await authority.listProjectResources({
      source_project_id: "wks_fleetresources01",
      limit: 10,
    })).toMatchObject({
      todos_project_id: existingProject.id,
      task_list_id: existingTaskList.id,
      count: 2,
      complete: true,
      resources: [
        { kind: "project", scope: "collection", target_id: existingProject.id },
        { kind: "task_list", scope: "collection", target_id: existingTaskList.id },
      ],
    });
    await expect(authority.compensate(inverseRequest(projectReceipt, projectCall)))
      .rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_INVALID_INPUT" });
    expect(getProject(existingProject.id, db)).not.toBeNull();
  });

  test("validates accepted and duplicate prior registrations across benign project/task-list drift", async () => {
    const projectCall = projectRequest({
      operation_id: "fleet-resources-prior-adoption-project-0001",
    });
    const projectReceipt = await authority.create(projectCall);
    const taskListCall = taskListRequest(projectReceipt.target_id!, {
      operation_id: "fleet-resources-prior-adoption-list-0001",
    });
    const taskListReceipt = await authority.create(taskListCall);
    const duplicateProjectReceipt = await authority.create(structuredClone(projectCall));

    db.run(
      "UPDATE projects SET task_counter = task_counter + 1, updated_at = ? WHERE id = ?",
      ["2099-01-02T03:04:04.000Z", projectReceipt.target_id!],
    );
    db.run(
      "UPDATE task_lists SET updated_at = ? WHERE id = ?",
      ["2099-01-02T03:04:05.000Z", taskListReceipt.target_id!],
    );
    const currentProject = getProject(projectReceipt.target_id!, db)!;
    const currentTaskList = getTaskList(taskListReceipt.target_id!, db)!;

    expect(await authority.validatePriorRegistrationAdoption(
      projectCall,
      projectReceipt,
      currentProject,
    )).toMatchObject({
      valid: true,
      source_outcome: "accepted",
      target_id: projectReceipt.target_id,
      accepted_receipt_id: projectReceipt.receipt_id,
    });
    expect(await authority.validatePriorRegistrationAdoption(
      projectCall,
      duplicateProjectReceipt,
      currentProject,
    )).toMatchObject({
      valid: true,
      source_outcome: "duplicate_of_accepted",
      target_id: projectReceipt.target_id,
      accepted_receipt_id: projectReceipt.receipt_id,
    });
    expect(await authority.validatePriorRegistrationAdoption(
      taskListCall,
      taskListReceipt,
      currentTaskList,
    )).toMatchObject({
      valid: true,
      resource_kind: "task_list",
      target_id: taskListReceipt.target_id,
    });

    expect(await authority.readExact({
      resource_kind: "project",
      target_id: projectReceipt.target_id!,
      target: null,
      ...BOUNDS,
    })).not.toEqual({
      target_id: projectReceipt.target_id,
      revision: projectReceipt.result_revision,
      digest: projectReceipt.result_digest,
    });
    expect(await authority.listProjectResources({
      source_project_id: projectCall.project_id,
      limit: 10,
    })).toMatchObject({
      todos_project_id: projectReceipt.target_id,
      task_list_id: taskListReceipt.target_id,
      resources: [
        {
          kind: "project",
          target_id: projectReceipt.target_id,
          parent_id: null,
        },
        {
          kind: "task_list",
          target_id: taskListReceipt.target_id,
          parent_id: projectReceipt.target_id,
        },
      ],
    });
  });

  test("rejects forged receipt, request lineage, stable mutation, and foreign current records", async () => {
    const request = projectRequest({
      operation_id: "fleet-resources-prior-adoption-rejections-0001",
    });
    const receipt = await authority.create(request);
    const current = getProject(receipt.target_id!, db)!;
    const unrelated = createProject({
      name: "Foreign current project",
      path: "hasna-project://wks_foreignadoption01",
      task_list_id: "todos-foreign-adoption",
    }, db);

    await expect(authority.validatePriorRegistrationAdoption(
      request,
      { ...receipt, result_digest: `sha256:${"0".repeat(64)}` },
      current,
    )).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED" });
    for (const changedRequest of [
      { ...request, authority_id: "foreign-authority" },
      { ...request, tenant_id: "foreign-tenant" },
      { ...request, corpus_id: "foreign-corpus" },
      { ...request, operation_id: "foreign-operation" },
      { ...request, step_id: "foreign-step" },
      { ...request, target_selector: "foreign-selector" },
      { ...request, idempotency_key: `sha256:${"1".repeat(64)}` },
      { ...request, request_digest: `sha256:${"2".repeat(64)}` },
      { ...request, precondition_digest: `sha256:${"3".repeat(64)}` },
      { ...request, desired: { ...request.desired, name: "Foreign desired name" } },
    ]) {
      await expect(authority.validatePriorRegistrationAdoption(
        changedRequest,
        receipt,
        current,
      )).rejects.toBeInstanceOf(TodosProjectRegistrationError);
    }
    await expect(authority.validatePriorRegistrationAdoption(
      request,
      receipt,
      unrelated,
    )).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED" });
    await expect(authority.validatePriorRegistrationAdoption(
      request,
      receipt,
      undefined as never,
    )).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED" });
    await expect(authority.validatePriorRegistrationAdoption(
      request,
      receipt,
      false as never,
    )).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED" });
    await expect(authority.validatePriorRegistrationAdoption(
      false as never,
      receipt,
      current,
    )).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED" });
    await expect(authority.validatePriorRegistrationAdoption(
      request,
      undefined as never,
      current,
    )).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED" });
    const throwingCurrentRecord = Object.defineProperty({}, "id", {
      enumerable: true,
      get() {
        throw new Error("untrusted current record getter");
      },
    });
    await expect(authority.validatePriorRegistrationAdoption(
      request,
      receipt,
      throwingCurrentRecord as never,
    )).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED" });

    const changed = updateProject(receipt.target_id!, { name: "Mutated stable name" }, db);
    await expect(authority.validatePriorRegistrationAdoption(
      request,
      receipt,
      changed,
    )).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED" });
  });

  test("rejects missing or forged accepted bindings and a delete-recreated target incarnation", async () => {
    const missingBindingRequest = projectRequest({
      operation_id: "fleet-resources-prior-adoption-missing-binding-0001",
    });
    const missingBindingReceipt = await authority.create(missingBindingRequest);
    const missingBindingCurrent = getProject(missingBindingReceipt.target_id!, db)!;
    db.run(
      "DELETE FROM todos_project_registration_bindings WHERE target_selector = ?",
      [missingBindingRequest.target_selector],
    );
    await expect(authority.validatePriorRegistrationAdoption(
      missingBindingRequest,
      missingBindingReceipt,
      missingBindingCurrent,
    )).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED" });

    const forgedBindingRequest = projectRequest({
      operation_id: "fleet-resources-prior-adoption-forged-binding-0001",
      project_id: "wks_forgedbinding01",
      target_selector: "wks_forgedbinding01",
      project_slug: "forged-binding",
      project_name: "Forged Binding",
      desired: {
        source_project_id: "wks_forgedbinding01",
        source_project_slug: "forged-binding",
        name: "Forged Binding",
      },
    });
    const forgedBindingReceipt = await authority.create(forgedBindingRequest);
    const forgedBindingCurrent = getProject(forgedBindingReceipt.target_id!, db)!;
    db.run(
      `UPDATE todos_project_registration_bindings
       SET accepted_receipt_id = ? WHERE target_selector = ?`,
      ["tpr_forged_prior_adoption", forgedBindingRequest.target_selector],
    );
    await expect(authority.validatePriorRegistrationAdoption(
      forgedBindingRequest,
      forgedBindingReceipt,
      forgedBindingCurrent,
    )).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED" });

    const recreatedRequest = projectRequest({
      operation_id: "fleet-resources-prior-adoption-recreated-0001",
      project_id: "wks_recreatedadoption01",
      target_selector: "wks_recreatedadoption01",
      project_slug: "recreated-adoption",
      project_name: "Recreated Adoption",
      desired: {
        source_project_id: "wks_recreatedadoption01",
        source_project_slug: "recreated-adoption",
        name: "Recreated Adoption",
      },
    });
    const recreatedReceipt = await authority.create(recreatedRequest);
    const original = getProject(recreatedReceipt.target_id!, db)!;
    db.run("DELETE FROM projects WHERE id = ?", [original.id]);
    db.run(
      `INSERT INTO projects (
        id, name, path, description, task_list_id, task_prefix, task_counter,
        created_at, updated_at, machine_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        original.id,
        original.name,
        original.path,
        original.description,
        original.task_list_id,
        original.task_prefix,
        original.task_counter,
        "2099-02-03T04:05:06.000Z",
        "2099-02-03T04:05:06.000Z",
        original.machine_id,
      ],
    );
    await expect(authority.validatePriorRegistrationAdoption(
      recreatedRequest,
      recreatedReceipt,
      getProject(original.id, db)!,
    )).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED" });
  });

  test("producer-pages canonical identities and optional plan/task anchors without duplicates or unrelated rows", async () => {
    const projectReceipt = await authority.create(projectRequest());
    const taskListReceipt = await authority.create(taskListRequest(projectReceipt.target_id!));
    const plans = Array.from({ length: 3 }, (_, index) => createPlan({
      name: `Bound plan ${index}`,
      project_id: projectReceipt.target_id!,
    }, db));
    const tasks = Array.from({ length: 4 }, (_, index) => createTask({
      title: `Bound task ${index}`,
      project_id: projectReceipt.target_id!,
      plan_id: plans[index % plans.length]!.id,
    }, db));
    const inherited = createTask({
      title: "Later child inherits the linked plan project",
      plan_id: plans[0]!.id,
    }, db);
    expect(inherited.project_id).toBe(projectReceipt.target_id);

    const unrelated = createProject({
      name: "Unrelated",
      path: "/unrelated",
      task_list_id: "unrelated",
    }, db);
    const unrelatedPlan = createPlan({
      name: "Unrelated plan",
      project_id: unrelated.id,
    }, db);
    const unrelatedTask = createTask({
      title: "Unrelated task",
      project_id: unrelated.id,
      plan_id: unrelatedPlan.id,
    }, db);

    const first = await authority.listProjectResources({
      source_project_id: "wks_fleetresources01",
      include_anchors: true,
      limit: 2,
    });
    expect(first).toMatchObject({
      count: 2,
      has_more: true,
      complete: false,
      truncated: false,
      collection_revision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      resources: [
        { kind: "project", target_id: projectReceipt.target_id },
        { kind: "task_list", target_id: taskListReceipt.target_id },
      ],
    });
    expect(first.next_cursor).toBeTruthy();

    const resources = [...first.resources];
    let cursor = first.next_cursor;
    while (cursor) {
      const page = await authority.listProjectResources({
        source_project_id: "wks_fleetresources01",
        include_anchors: true,
        limit: 2,
        cursor,
      });
      resources.push(...page.resources);
      cursor = page.next_cursor;
    }
    const keys = resources.map((resource) => `${resource.kind}:${resource.target_id}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(resources.map((resource) => resource.kind)).toEqual([
      "project",
      "task_list",
      "plan",
      "plan",
      "plan",
      "task",
      "task",
      "task",
      "task",
      "task",
    ]);
    expect(new Set(resources.map((resource) => resource.target_id))).toEqual(new Set([
      projectReceipt.target_id!,
      taskListReceipt.target_id!,
      ...plans.map((plan) => plan.id),
      ...tasks.map((task) => task.id),
      inherited.id,
    ]));
    expect(resources.some((resource) =>
      resource.target_id === unrelated.id
      || resource.target_id === unrelatedPlan.id
      || resource.target_id === unrelatedTask.id
    )).toBe(false);

    await expect(authority.listProjectResources({
      source_project_id: "wks_fleetresources01",
      include_anchors: false,
      limit: 2,
      cursor: first.next_cursor!,
    })).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_INVALID_INPUT" });
    expect(await authority.listProjectResources({
      source_project_id: "wks_fleetresources01",
      include_anchors: false,
      limit: 10,
    })).toMatchObject({ count: 2, complete: true });
  });

  test("rejects a stale project-resource cursor instead of silently losing a later child", async () => {
    const projectReceipt = await authority.create(projectRequest());
    await authority.create(taskListRequest(projectReceipt.target_id!));
    const originalPlan = createPlan({
      name: "Original paged plan",
      project_id: projectReceipt.target_id!,
    }, db);
    const first = await authority.listProjectResources({
      source_project_id: "wks_fleetresources01",
      include_anchors: true,
      limit: 2,
    });
    expect(first.next_cursor).toBeTruthy();

    const laterChild = createTask({
      title: "Later child added between resource pages",
      project_id: projectReceipt.target_id!,
      plan_id: originalPlan.id,
    }, db);
    expect(laterChild.project_id).toBe(projectReceipt.target_id);

    await expect(authority.listProjectResources({
      source_project_id: "wks_fleetresources01",
      include_anchors: true,
      limit: 2,
      cursor: first.next_cursor!,
    })).rejects.toMatchObject({
      code: "TODOS_PROJECT_REGISTRATION_COLLECTION_CHANGED",
      details: {
        expected_collection_revision: first.collection_revision,
        current_collection_revision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      },
    });
    expect((await authority.listProjectResources({
      source_project_id: "wks_fleetresources01",
      include_anchors: true,
      limit: 10,
    })).resources.some((resource) => resource.target_id === laterChild.id)).toBe(true);
  });

  test("detects a SQLite child mutation during page production before returning a cursor", async () => {
    const projectReceipt = await authority.create(projectRequest());
    await authority.create(taskListRequest(projectReceipt.target_id!));
    const plan = createPlan({
      name: "Mutation-during-page plan",
      project_id: projectReceipt.target_id!,
    }, db);
    const delegate = new SqliteTodosProjectRegistrationBackend(db);
    let mutated = false;
    const backend: TodosProjectRegistrationBackend = {
      kind: delegate.kind,
      transaction: delegate.transaction.bind(delegate),
      getReceiptForLookup: delegate.getReceiptForLookup.bind(delegate),
      getReceiptById: delegate.getReceiptById.bind(delegate),
      getBinding: delegate.getBinding.bind(delegate),
      getProject: delegate.getProject.bind(delegate),
      getTaskList: delegate.getTaskList.bind(delegate),
      getProjectResourceCollectionRevision:
        delegate.getProjectResourceCollectionRevision.bind(delegate),
      listProjectResourceCandidates: async (input) => {
        const candidates = await delegate.listProjectResourceCandidates(input);
        if (!mutated) {
          mutated = true;
          createTask({
            title: "Mutation inserted during page production",
            project_id: projectReceipt.target_id!,
            plan_id: plan.id,
          }, db);
        }
        return candidates;
      },
    };
    const guardedAuthority = new PackageOwnedTodosProjectRegistrationAuthority(backend, {
      packageVersion: "0.15.6-test",
      authorityId: "todos-test-authority",
      tenantId: "tenant-test",
      corpusId: "corpus-test",
    });
    await expect(guardedAuthority.listProjectResources({
      source_project_id: "wks_fleetresources01",
      include_anchors: true,
      limit: 2,
    })).rejects.toMatchObject({
      code: "TODOS_PROJECT_REGISTRATION_COLLECTION_CHANGED",
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
    expect(await client.validatePriorRegistrationAdoption(
      request,
      receipt,
      getProject(receipt.target_id!, db)!,
    )).toMatchObject({
      valid: true,
      source_receipt_id: receipt.receipt_id,
      accepted_receipt_id: receipt.receipt_id,
      target_id: receipt.target_id,
    });
    await expect(client.validatePriorRegistrationAdoption(
      request,
      { ...receipt, target_id: "11111111-1111-4111-8111-111111111111" },
      getProject(receipt.target_id!, db)!,
    )).rejects.toMatchObject({
      code: "TODOS_PROJECT_REGISTRATION_ADOPTION_REJECTED",
    });
    const listRequest = taskListRequest(receipt.target_id!, {
      operation_id: "fleet-resources-http-list-0001",
      project_id: request.project_id,
      project_slug: request.project_slug,
      project_name: request.project_name,
      desired: {
        todos_project_id: receipt.target_id,
        source_project_id: request.project_id,
        name: request.project_name,
      },
    });
    const listReceipt = await client.create(listRequest);
    const plan = createPlan({
      name: "HTTP foreign plan",
      project_id: receipt.target_id!,
    }, db);
    const firstPage = await client.listProjectResources({
      source_project_id: request.project_id,
      include_anchors: true,
      limit: 2,
    });
    expect(firstPage).toMatchObject({
      todos_project_id: receipt.target_id,
      task_list_id: listReceipt.target_id,
      has_more: true,
      collection_revision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    createTask({
      title: "HTTP later child",
      project_id: receipt.target_id!,
      plan_id: plan.id,
    }, db);
    await expect(client.listProjectResources({
      source_project_id: request.project_id,
      include_anchors: true,
      limit: 2,
      cursor: firstPage.next_cursor!,
    })).rejects.toMatchObject({
      code: "TODOS_PROJECT_REGISTRATION_COLLECTION_CHANGED",
    });
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

  test("recovers the exact Fleet Resources project and list receipts by historical source identity", async () => {
    const projectFixture: HistoricalReceiptFixture = {
      receiptId: HISTORICAL_PROJECT_RECEIPT_ID,
      stepId: "todos_project",
      resourceKind: "project",
      targetSelector: "wks_fleetresourceshistorical01",
      idempotencyKey: `prk_${"5".repeat(48)}`,
      targetId: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-08-07T10:00:00.000Z",
    };
    const listFixture: HistoricalReceiptFixture = {
      receiptId: HISTORICAL_LIST_RECEIPT_ID,
      stepId: "todos_task_list",
      resourceKind: "task_list",
      targetSelector: `${projectFixture.targetId}:default`,
      idempotencyKey: `prk_${"6".repeat(48)}`,
      targetId: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-08-07T10:00:01.000Z",
    };
    insertHistoricalReceipt(projectFixture);
    insertHistoricalReceipt(listFixture);

    for (const fixture of [projectFixture, listFixture]) {
      const result = await authority.lookupReceipt(historicalLookup(fixture));
      expect(result.receipt).toMatchObject({
        receipt_id: fixture.receiptId,
        route: HISTORICAL_ROUTE,
        package_version: HISTORICAL_PACKAGE_VERSION,
        authority_id: "todos-test-authority",
        tenant_id: "tenant-test",
        corpus_id: "corpus-test",
        target_id: fixture.targetId,
      });
      expect(result.response_control).toMatchObject({
        complete: true,
        truncated: false,
      });
      await expect(authority.lookupReceipt(historicalLookup(fixture, {
        package_version: FABRICATED_PACKAGE_VERSION,
      }))).rejects.toMatchObject({
        code: "TODOS_PROJECT_REGISTRATION_RECEIPT_NOT_FOUND",
      });
    }

    await expect(authority.lookupReceipt(historicalLookup(projectFixture, {
      authority_route: "todos.project-registration.v2",
    }))).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_RECEIPT_NOT_FOUND" });
    await expect(authority.lookupReceipt(historicalLookup(projectFixture, {
      tenant_id: "tenant-other",
    }))).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH" });
    await expect(authority.lookupReceipt(historicalLookup(projectFixture, {
      corpus_id: "corpus-other",
    }))).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH" });
    await expect(authority.lookupReceipt(historicalLookup(projectFixture, {
      authority: "projects" as "todos",
    }))).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH" });
    await expect(authority.lookupReceipt(historicalLookup(projectFixture, {
      target_id: "33333333-3333-4333-8333-333333333333",
    }))).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_RECEIPT_NOT_FOUND" });

    expect(() => db.run(
      "UPDATE todos_project_registration_receipts SET package_version = 'changed' WHERE receipt_id = ?",
      [HISTORICAL_PROJECT_RECEIPT_ID],
    )).toThrow(/immutable/i);
  });

  test("keeps current create and inverse operations strict to the installed package identity", async () => {
    await expect(authority.create(projectRequest({
      package_version: HISTORICAL_PACKAGE_VERSION,
    }))).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH" });

    const forward = projectRequest({
      operation_id: "fleet-resources-current-package-inverse-0001",
    });
    const accepted = await authority.create(forward);
    await expect(authority.compensate({
      ...inverseRequest(accepted, forward),
      package_version: HISTORICAL_PACKAGE_VERSION,
    })).rejects.toMatchObject({ code: "TODOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH" });
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

  for (const bindExisting of [undefined, false] as const) {
    test(`duplicates a pre-bind_existing accepted receipt when bind_existing is ${
      bindExisting === undefined ? "omitted" : "explicit false"
    }`, async () => {
      const suffix = bindExisting === undefined ? "omitted" : "false";
      const request = projectRequest({
        operation_id: `fleet-resources-legacy-bind-${suffix}-0001`,
        project_id: `wks_fleetlegacy${suffix}01`,
        target_selector: `wks_fleetlegacy${suffix}01`,
        project_slug: `fleet-legacy-${suffix}`,
        project_name: `Fleet Legacy ${suffix}`,
        desired: {
          source_project_id: `wks_fleetlegacy${suffix}01`,
          source_project_slug: `fleet-legacy-${suffix}`,
          name: `Fleet Legacy ${suffix}`,
        },
        ...(bindExisting === false ? { bind_existing: false } : {}),
      });
      const normalized = projectRequest(request);
      const project = createProject({
        name: normalized.project_name,
        path: `hasna-project://${normalized.project_id}`,
        description: `Registered from Projects workspace ${normalized.project_id}`,
        task_list_id: `todos-${normalized.project_slug}`,
        task_prefix: "FLE",
      }, db);
      const acceptedReceiptId = insertLegacyAcceptedProjectReceipt(normalized, project);

      await expect(authority.create(structuredClone(normalized))).resolves.toMatchObject({
        outcome: "duplicate_of_accepted",
        duplicate_of_receipt_id: acceptedReceiptId,
        target_id: project.id,
        created_by_operation: false,
      });
      expect(db.query("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 1 });
    });
  }

  test("does not treat legacy digest compatibility as bind_existing=true semantics", async () => {
    const request = projectRequest({
      operation_id: "fleet-resources-legacy-bind-true-0001",
      project_id: "wks_fleetlegacytrue01",
      target_selector: "wks_fleetlegacytrue01",
      project_slug: "fleet-legacy-true",
      project_name: "Fleet Legacy True",
      desired: {
        source_project_id: "wks_fleetlegacytrue01",
        source_project_slug: "fleet-legacy-true",
        name: "Fleet Legacy True",
      },
      bind_existing: true,
    });
    const normalized = projectRequest(request);
    const project = createProject({
      name: normalized.project_name,
      path: `hasna-project://${normalized.project_id}`,
      task_list_id: `todos-${normalized.project_slug}`,
    }, db);
    insertLegacyAcceptedProjectReceipt(normalized, project);

    await expect(authority.create(structuredClone(normalized))).resolves.toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "operation_step_semantics_changed",
      target_id: project.id,
    });
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

  test("does not roll back an ordinary task write interleaved while a registration fault hook is held", async () => {
    const preexistingTask = createTask({ title: "Preexisting task" }, db);
    let signalFaultEntered!: () => void;
    let releaseFault!: () => void;
    const faultEntered = new Promise<void>((resolve) => {
      signalFaultEntered = resolve;
    });
    const faultRelease = new Promise<void>((resolve) => {
      releaseFault = resolve;
    });
    authority = createLocalTodosProjectRegistrationAuthority(db, {
      packageVersion: "0.15.6-test",
      authorityId: "todos-test-authority",
      tenantId: "tenant-test",
      corpusId: "corpus-test",
      async faultInjector(point) {
        if (point !== "after_object_write") return;
        signalFaultEntered();
        await faultRelease;
        throw new Error("injected:after_object_write");
      },
    });

    const registrationAttempt = authority.create(projectRequest({
      operation_id: "fleet-resources-interleaved-task-write-0001",
    }));
    await faultEntered;

    let unrelatedTaskId: string | null = null;
    let unrelatedTaskVisibleBeforeRollback = false;
    let unrelatedCreateError: unknown = null;
    try {
      unrelatedTaskId = createTask({ title: "Unrelated task" }, db).id;
      unrelatedTaskVisibleBeforeRollback = getTask(unrelatedTaskId, db) !== null;
    } catch (error) {
      unrelatedCreateError = error;
    } finally {
      releaseFault();
    }

    const terminal = await registrationAttempt;
    expect(unrelatedCreateError).toBeNull();
    expect(unrelatedTaskId).not.toBeNull();
    expect(unrelatedTaskVisibleBeforeRollback).toBe(true);
    expect(terminal).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "write_failed:after_object_write",
    });
    expect(getTask(preexistingTask.id, db)).not.toBeNull();
    expect(getTask(unrelatedTaskId!, db)).not.toBeNull();
  });

  test("commits registration without absorbing an ordinary task write interleaved at a successful hook", async () => {
    let signalFaultEntered!: () => void;
    let releaseFault!: () => void;
    const faultEntered = new Promise<void>((resolve) => {
      signalFaultEntered = resolve;
    });
    const faultRelease = new Promise<void>((resolve) => {
      releaseFault = resolve;
    });
    authority = createLocalTodosProjectRegistrationAuthority(db, {
      packageVersion: "0.15.6-test",
      authorityId: "todos-test-authority",
      tenantId: "tenant-test",
      corpusId: "corpus-test",
      async faultInjector(point) {
        if (point !== "after_object_write") return;
        signalFaultEntered();
        await faultRelease;
      },
    });

    const registrationAttempt = authority.create(projectRequest({
      operation_id: "fleet-resources-successful-interleaved-task-write-0001",
    }));
    await faultEntered;
    const unrelatedTask = createTask({ title: "Successful unrelated task" }, db);
    expect(getTask(unrelatedTask.id, db)).not.toBeNull();
    releaseFault();

    const accepted = await registrationAttempt;
    expect(accepted.outcome).toBe("accepted");
    expect(getProject(accepted.target_id!, db)).not.toBeNull();
    expect(getTask(unrelatedTask.id, db)).not.toBeNull();
  });

  test("re-evaluates a registration when a relevant ordinary project wins before commit", async () => {
    let signalFaultEntered!: () => void;
    let releaseFault!: () => void;
    const faultEntered = new Promise<void>((resolve) => {
      signalFaultEntered = resolve;
    });
    const faultRelease = new Promise<void>((resolve) => {
      releaseFault = resolve;
    });
    authority = createLocalTodosProjectRegistrationAuthority(db, {
      packageVersion: "0.15.6-test",
      authorityId: "todos-test-authority",
      tenantId: "tenant-test",
      corpusId: "corpus-test",
      async faultInjector(point) {
        if (point !== "after_object_write") return;
        signalFaultEntered();
        await faultRelease;
      },
    });

    const registrationAttempt = authority.create(projectRequest({
      operation_id: "fleet-resources-relevant-concurrent-write-0001",
    }));
    await faultEntered;
    const ordinaryWinner = createProject({
      name: "Ordinary winner",
      path: "/ordinary-winner",
      task_list_id: "todos-fleet-resources",
      task_prefix: "WIN",
    }, db);
    releaseFault();

    const terminal = await registrationAttempt;
    expect(terminal).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "target_already_exists",
      target_id: ordinaryWinner.id,
      created_by_operation: false,
    });
    expect(getProject(ordinaryWinner.id, db)).not.toBeNull();
    expect(db.query("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 1 });
  });

  test("serializes concurrent identical authority calls into one accepted object", async () => {
    const request = projectRequest({
      operation_id: "fleet-resources-concurrent-identical-calls-0001",
    });
    const [first, second] = await Promise.all([
      authority.create(request),
      authority.create(structuredClone(request)),
    ]);
    const accepted = [first, second].find((receipt) => receipt.outcome === "accepted");
    const duplicate = [first, second].find(
      (receipt) => receipt.outcome === "duplicate_of_accepted",
    );
    expect(accepted).toBeDefined();
    expect(duplicate).toMatchObject({
      target_id: accepted!.target_id,
      duplicate_of_receipt_id: accepted!.receipt_id,
      created_by_operation: false,
    });
    expect(db.query("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 1 });
  });

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

  test("does not roll back an ordinary task write interleaved with a failing inverse", async () => {
    const forward = projectRequest({
      operation_id: "fleet-resources-interleaved-inverse-write-0001",
    });
    const accepted = await authority.create(forward);
    const inverse = inverseRequest(accepted, forward);
    let signalFaultEntered!: () => void;
    let releaseFault!: () => void;
    const faultEntered = new Promise<void>((resolve) => {
      signalFaultEntered = resolve;
    });
    const faultRelease = new Promise<void>((resolve) => {
      releaseFault = resolve;
    });
    authority = createLocalTodosProjectRegistrationAuthority(db, {
      packageVersion: "0.15.6-test",
      authorityId: "todos-test-authority",
      tenantId: "tenant-test",
      corpusId: "corpus-test",
      async faultInjector(point) {
        if (point !== "after_object_write") return;
        signalFaultEntered();
        await faultRelease;
        throw new Error("injected:after_object_write");
      },
    });

    const inverseAttempt = authority.compensate(inverse);
    await faultEntered;
    const unrelatedTask = createTask({ title: "Inverse-unrelated task" }, db);
    expect(getTask(unrelatedTask.id, db)).not.toBeNull();
    releaseFault();

    const terminal = await inverseAttempt;
    expect(terminal).toMatchObject({
      outcome: "terminal_nonacceptance",
      reason: "write_failed:after_object_write",
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
    });
    expect(getProject(accepted.target_id!, db)).not.toBeNull();
    expect(getTask(unrelatedTask.id, db)).not.toBeNull();
  });

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
    expect(sql).toContain("todos_project_registration_receipts_source_identity_idx");
    expect(sql).toContain("route, package_version");
  });

  test("selects PostgreSQL receipts by the complete stored route and package identity", async () => {
    const statements: Array<{ text: string; params: readonly unknown[] | undefined }> = [];
    const row = {
      receipt_id: HISTORICAL_PROJECT_RECEIPT_ID,
      authority: "todos",
      route: HISTORICAL_ROUTE,
      package_version: HISTORICAL_PACKAGE_VERSION,
      authority_id: "todos-test-authority",
      tenant_id: "tenant-test",
      corpus_id: "corpus-test",
      operation_id: HISTORICAL_OPERATION_ID,
      step_id: "todos_project",
      resource_kind: "project",
      direction: "forward",
      target_selector: "wks_fleetresourceshistorical01",
      idempotency_key: `prk_${"5".repeat(48)}`,
      request_digest: "1".repeat(64),
      precondition_digest: "2".repeat(64),
      normalized_call_digest: "3".repeat(64),
      outcome: "accepted",
      reason: null,
      target_id: "11111111-1111-4111-8111-111111111111",
      result_revision: "2026-08-07T10:00:00.000Z",
      result_digest: "4".repeat(64),
      duplicate_of_receipt_id: null,
      accepted_receipt_id: null,
      created_by_operation: true,
      created_at: "2026-08-07T10:00:00.000Z",
    };
    const query = async (text: string, params?: readonly unknown[]) => {
      statements.push({ text, params });
      return text.includes("SELECT * FROM todos_project_registration_receipts")
        ? { rows: [row] }
        : { rows: [] };
    };
    const client = {
      query,
      async transaction<T>(fn: (transaction: { query: typeof query }) => Promise<T>) {
        return await fn({ query });
      },
    };
    const backend = new PostgresTodosProjectRegistrationBackend(client);

    const receipt = await backend.getReceiptForLookup({
      authority_id: row.authority_id,
      tenant_id: row.tenant_id,
      corpus_id: row.corpus_id,
      route: row.route,
      package_version: row.package_version,
      operation_id: row.operation_id,
      step_id: row.step_id,
      resource_kind: row.resource_kind,
      direction: row.direction,
      idempotency_key: row.idempotency_key,
      target_selector: row.target_selector,
    });

    expect(receipt?.receipt_id).toBe(HISTORICAL_PROJECT_RECEIPT_ID);
    const lookup = statements.find(({ text }) =>
      text.includes("SELECT * FROM todos_project_registration_receipts"));
    expect(lookup?.text).toContain("route = $4 AND package_version = $5");
    expect(lookup?.params).toEqual([
      row.authority_id,
      row.tenant_id,
      row.corpus_id,
      row.route,
      row.package_version,
      row.operation_id,
      row.step_id,
      row.resource_kind,
      row.direction,
      row.idempotency_key,
      row.target_selector,
    ]);
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

  test("locks exact PostgreSQL project and task-list adoption candidates through the transaction", async () => {
    const statements: string[] = [];
    const project = createProject({
      name: "Postgres adoption project",
      path: "hasna-project://wks_postgresadoption01",
      task_list_id: "todos-postgres-adoption",
    }, db);
    const taskList = createTaskList({
      name: "Postgres adoption task list",
      slug: "todos-postgres-adoption",
      project_id: project.id,
    }, db);
    const query = async (text: string) => {
      statements.push(text);
      if (text.includes("object_type = 'projects'")) {
        return { rows: [{ payload: project }] };
      }
      if (text.includes("object_type = 'task_lists'")) {
        return { rows: [{ payload: taskList }] };
      }
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
      expect(await transaction.findProjectConflict(
        project.path,
        project.task_list_id!,
      )).toMatchObject({ id: project.id });
      expect(await transaction.findTaskListConflict(
        project.id,
        taskList.slug,
      )).toMatchObject({ id: taskList.id });
    });

    const projectSelect = statements.find((text) =>
      text.includes("object_type = 'projects'"));
    const taskListSelect = statements.find((text) =>
      text.includes("object_type = 'task_lists'"));
    expect(projectSelect).toContain("FOR UPDATE");
    expect(taskListSelect).toContain("FOR UPDATE");
  });

  test("hosted PostgreSQL collection revisions change across child mutations and candidate pages stay bounded", async () => {
    const statements: Array<{ text: string; params: unknown[] | undefined }> = [];
    const revisions = [
      "md5:11111111111111111111111111111111",
      "md5:22222222222222222222222222222222",
    ];
    const query = async (text: string, params?: unknown[]) => {
      statements.push({ text, params });
      if (text.includes("string_agg(")) {
        return { rows: [{ revision: revisions.shift()! }] };
      }
      if (text.includes("WITH resources(kind, kind_rank")) {
        return { rows: [] };
      }
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
    const input = {
      todos_project_id: "11111111-1111-4111-8111-111111111111",
      task_list_id: "22222222-2222-4222-8222-222222222222",
      include_anchors: true,
    };
    const before = await backend.getProjectResourceCollectionRevision(input);
    const after = await backend.getProjectResourceCollectionRevision(input);
    expect({ before, after }).toEqual({
      before: "md5:11111111111111111111111111111111",
      after: "md5:22222222222222222222222222222222",
    });
    expect(before).not.toBe(after);
    await backend.listProjectResourceCandidates({
      ...input,
      after: { kind_rank: 2, target_id: "33333333-3333-4333-8333-333333333333" },
      limit: 51,
    });
    const revisionSql = statements.find(({ text }) => text.includes("string_agg("))!;
    expect(revisionSql.text).toContain("ORDER BY kind_rank ASC, target_id ASC");
    expect(revisionSql.text).toContain("payload->>'project_id' = $2");
    const pageSql = statements.find(({ text }) =>
      text.includes("WITH resources(kind, kind_rank"))!;
    expect(pageSql.text).toContain("LIMIT $7");
    expect(pageSql.params?.at(-1)).toBe(51);
  });

  test("detects a hosted PostgreSQL revision change during page production", async () => {
    const backend = new PostgresTodosProjectRegistrationBackend({
      async query() {
        return { rows: [] };
      },
      async transaction<T>(fn: (client: { query: () => Promise<{ rows: never[] }> }) => Promise<T>) {
        return await fn({ query: async () => ({ rows: [] }) });
      },
    });
    const projectId = "11111111-1111-4111-8111-111111111111";
    const taskListId = "22222222-2222-4222-8222-222222222222";
    backend.getBinding = async (_scope, resourceKind) => ({
      authority_id: "todos",
      tenant_id: "postgresql",
      corpus_id: "todos:postgresql",
      resource_kind: resourceKind,
      target_selector: resourceKind === "project"
        ? "wks_postgresmutation01"
        : `${projectId}:default`,
      operation_id: "postgres-mutation-operation",
      step_id: resourceKind,
      direction: "forward",
      idempotency_key: `prk_${resourceKind.padEnd(48, "0").slice(0, 48)}`,
      request_digest: "a".repeat(64),
      precondition_digest: "b".repeat(64),
      normalized_call_digest: "c".repeat(64),
      state: "accepted",
      target_id: resourceKind === "project" ? projectId : taskListId,
      accepted_receipt_id: `tpr_${resourceKind}`,
      result_revision: "2026-08-11T00:00:00.000Z",
      result_digest: "d".repeat(64),
      removed_receipt_id: null,
      created_at: "2026-08-11T00:00:00.000Z",
      updated_at: "2026-08-11T00:00:00.000Z",
    });
    let revisionRead = 0;
    backend.getProjectResourceCollectionRevision = async () =>
      revisionRead++ === 0
        ? "md5:11111111111111111111111111111111"
        : "md5:22222222222222222222222222222222";
    backend.listProjectResourceCandidates = async () => [{
      kind: "project",
      kind_rank: 0,
      target_id: projectId,
      parent_id: null,
      revision: "2026-08-11T00:00:00.000Z",
    }];
    const guardedAuthority = new PackageOwnedTodosProjectRegistrationAuthority(backend);
    await expect(guardedAuthority.listProjectResources({
      source_project_id: "wks_postgresmutation01",
      include_anchors: true,
      limit: 1,
    })).rejects.toMatchObject({
      code: "TODOS_PROJECT_REGISTRATION_COLLECTION_CHANGED",
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
