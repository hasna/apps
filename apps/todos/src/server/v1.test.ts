import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { ResourceConflictError } from "../types/index.js";
import { handleV1Request, type V1RequestDependencies } from "./v1.js";
import { createLocalPrGroupLedger } from "../pr-groups/index.js";
import {
  createLocalTodosProjectRegistrationAuthority,
  deriveTodosProjectRegistrationIdempotencyKey,
  digestProjectRegistrationValue,
} from "../project-registration/index.js";
import { createSqliteTodosTaskManifestAuthority } from "../task-manifest/index.js";

let db: Database;
let store: TodosStorageAdapter;
let principal: { agent: string | null; kid?: string; scopes: string[] };
let dependencies: V1RequestDependencies;

function request(path: string, method = "GET", body?: unknown): Promise<Response | null> {
  const url = new URL(`https://todos.example.test${path}`);
  return handleV1Request(new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), url, dependencies);
}

// Read lock state back over the HTTP surface rather than from the response of the
// call under test — a mutation route reporting success is not evidence that the
// stored state changed.
async function readTaskOverHttp(id: string): Promise<{ locked_by: string | null }> {
  const response = await request(`/v1/tasks/${id}`);
  if (response?.status !== 200) throw new Error(`read-back failed: ${response?.status}`);
  return (await response.json() as { task: { locked_by: string | null } }).task;
}

beforeEach(() => {
  resetDatabase();
  db = getDatabase(":memory:");
  store = createLocalSqliteTodosStorageAdapter({ db });
  principal = { agent: null, scopes: ["todos:*"] };
  dependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => store,
    getPrGroupLedger: () => createLocalPrGroupLedger(db),
    getProjectRegistrationAuthority: () =>
      createLocalTodosProjectRegistrationAuthority(db, {
        packageVersion: "0.15.6-test",
        authorityId: "todos-v1-test",
        tenantId: "tenant-v1-test",
        corpusId: "corpus-v1-test",
      }),
    getTaskManifestAuthority: () =>
      createSqliteTodosTaskManifestAuthority({
        database: db,
        tenantId: "tenant-v1-test",
      }),
    getVerifier: () => ({
      authenticate: async () => ({ ok: true, principal }),
    }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
  };
});

afterEach(() => resetDatabase());

describe("/v1 task-manifest routing", () => {
  test("applies and recovers the owning tenant's binding through the production v1 router", async () => {
    const projectId = "a0000000-0000-4000-8000-000000000051";
    db.run(
      `INSERT INTO projects (id, name, path, task_prefix, task_counter, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [
        projectId,
        "V1 task manifest",
        "/disposable/v1-task-manifest",
        "VTM",
        "2026-08-08T00:00:00.000Z",
        "2026-08-08T00:00:00.000Z",
      ],
    );
    const appliedResponse = await request("/v1/task-manifest/apply", "POST", {
      version: 1,
      operation_id: "v1-task-manifest-receipt-recovery",
      idempotency_key: "v1-task-manifest-receipt-recovery:apply",
      project_id: projectId,
      plan: { key: "receipt-recovery", name: "Receipt recovery" },
      tasks: [{ key: "verify", title: "Verify v1 route" }],
    });
    expect(appliedResponse?.status).toBe(201);
    const applied = await appliedResponse!.json() as {
      result: { receipt: { receipt_id: string }; graph: { plan_id: string } };
    };

    const response = await request("/v1/task-manifest/bindings/lookup", "POST", {
      authority: "todos",
      route: "todos.task-manifest.v1",
      schema_version: 1,
      tenant_id: "tenant-v1-test",
      plan_id: applied.result.graph.plan_id,
      max_items: 1,
    });

    expect(response?.status).toBe(200);
    expect(await response!.json()).toEqual({
      result: {
        authority: "todos",
        route: "todos.task-manifest.v1",
        schema_version: 1,
        tenant_id: "tenant-v1-test",
        plan_id: applied.result.graph.plan_id,
        apply_receipt_id: applied.result.receipt.receipt_id,
        binding_version: 1,
        state: "applied",
      },
    });
  });
});

describe("/v1 task-list cloud parity", () => {
  test("plans and idempotently applies an exact-project task-list repair", async () => {
    const created = await request("/v1/projects", "POST", {
      name: "Dubai Fraud",
      path: "/workspace/dubai-fraud",
      task_list_id: "dubai-fraud",
    });
    expect(created?.status).toBe(201);
    const project = (await created!.json() as { project: { id: string; updated_at: string } }).project;

    const plan = await request(`/v1/projects/${project.id}/task-list/ensure`);
    expect(plan?.status).toBe(200);
    expect(await plan!.json()).toMatchObject({
      mode: "plan",
      action: "would_create",
      project: { id: project.id, name: "Dubai Fraud", task_list_id: "dubai-fraud" },
      task_list: null,
      receipt: null,
    });
    expect(await store.taskLists.list(project.id)).toEqual([]);

    const first = await request(
      `/v1/projects/${project.id}/task-list/ensure`,
      "POST",
      {
        expected_project_revision: project.updated_at,
        idempotency_key: "dubai-fraud-default-task-list",
      },
    );
    expect(first?.status).toBe(201);
    const firstBody = await first!.json() as {
      mode: string;
      action: string;
      project: { id: string; name: string; task_list_id: string };
      task_list: { id: string; project_id: string; slug: string; name: string; updated_at: string };
      receipt: { receipt_id: string; project_id: string; task_list_id: string; result_revision: string; created_by_operation: boolean; rollback_supported: boolean };
    };
    expect(firstBody).toMatchObject({
      mode: "apply",
      action: "created",
      project: { id: project.id, name: "Dubai Fraud", task_list_id: "dubai-fraud" },
      task_list: { project_id: project.id, slug: "dubai-fraud", name: "Dubai Fraud" },
      receipt: {
        project_id: project.id,
        created_by_operation: true,
        rollback_supported: true,
      },
    });
    expect(firstBody.receipt.task_list_id).toBe(firstBody.task_list.id);
    expect(firstBody.receipt.result_revision).toBe(firstBody.task_list.updated_at);

    const second = await request(
      `/v1/projects/${project.id}/task-list/ensure`,
      "POST",
      {
        expected_project_revision: project.updated_at,
        idempotency_key: "dubai-fraud-default-task-list",
      },
    );
    expect(second?.status).toBe(200);
    const secondBody = await second!.json() as typeof firstBody;
    expect(secondBody).toMatchObject({ mode: "apply", action: "already_present" });
    expect(secondBody.task_list.id).toBe(firstBody.task_list.id);
    expect(secondBody.receipt.receipt_id).toBe(firstBody.receipt.receipt_id);
    expect(await store.taskLists.list(project.id)).toHaveLength(1);

    const mismatchedKey = await request(
      `/v1/projects/${project.id}/task-list/ensure`,
      "POST",
      {
        expected_project_revision: project.updated_at,
        idempotency_key: "different-operation-key",
      },
    );
    expect(mismatchedKey?.status).toBe(409);
    expect(await mismatchedKey!.json()).toMatchObject({
      code: "PROJECT_TASK_LIST_IDEMPOTENCY_CONFLICT",
    });
    expect(await store.taskLists.list(project.id)).toHaveLength(1);

    const exactProject = await request(`/v1/projects/${project.id}`);
    const exactList = await request(`/v1/task-lists/${firstBody.task_list.id}`);
    expect((await exactProject!.json() as { project: { id: string; name: string } }).project)
      .toMatchObject({ id: project.id, name: "Dubai Fraud" });
    expect((await exactList!.json() as { task_list: { id: string; project_id: string; slug: string } }).task_list)
      .toMatchObject({ id: firstBody.task_list.id, project_id: project.id, slug: "dubai-fraud" });
  });

  test("rejects a raced create when the project revision changed before conflict reconciliation", async () => {
    const created = await request("/v1/projects", "POST", {
      name: "Raced Project",
      path: "/workspace/raced-project",
      task_list_id: "raced-project",
    });
    const project = (await created!.json() as { project: { id: string; updated_at: string } }).project;
    const originalCreate = store.taskLists.create;
    const originalGetProject = store.projects.get;
    let exposeRacedRevision = false;
    store.projects.get = async (id) => {
      const current = await originalGetProject(id);
      return exposeRacedRevision && current
        ? { ...current, updated_at: "2099-01-01T00:00:00.000Z" }
        : current;
    };
    store.taskLists.create = async (input) => {
      await originalCreate(input);
      exposeRacedRevision = true;
      throw new ResourceConflictError("TASK_LIST_SLUG_CONFLICT", "simulated raced create");
    };

    const response = await request(
      `/v1/projects/${project.id}/task-list/ensure`,
      "POST",
      {
        expected_project_revision: project.updated_at,
        idempotency_key: "raced-project-task-list",
      },
    );
    expect(response?.status).toBe(409);
    expect(await response!.json()).toMatchObject({ code: "PROJECT_REVISION_CONFLICT" });
    expect(await store.taskLists.list(project.id)).toHaveLength(1);
  });

  test("fails missing declarations and legacy global-slug collisions without mutation", async () => {
    const missing = await request(
      "/v1/projects/ffffffff-ffff-4fff-8fff-ffffffffffff/task-list/ensure",
    );
    expect({ status: missing?.status, body: await missing!.json() }).toMatchObject({
      status: 404,
      body: { code: "PROJECT_NOT_FOUND" },
    });

    const created = await request("/v1/projects", "POST", {
      name: "Collision",
      path: "/workspace/collision",
      task_list_id: "collision",
    });
    const project = (await created!.json() as { project: { id: string } }).project;
    db.run("UPDATE projects SET task_list_id = NULL WHERE id = ?", [project.id]);
    const undeclared = await request(`/v1/projects/${project.id}/task-list/ensure`);
    expect({ status: undeclared?.status, body: await undeclared!.json() }).toMatchObject({
      status: 409,
      body: { code: "PROJECT_TASK_LIST_NOT_DECLARED" },
    });
    expect(await store.taskLists.list(project.id)).toEqual([]);

    db.run("UPDATE projects SET task_list_id = 'collision' WHERE id = ?", [project.id]);
    await store.taskLists.create({ name: "Legacy collision", slug: "collision" });
    const collision = await request(`/v1/projects/${project.id}/task-list/ensure`);
    expect({ status: collision?.status, body: await collision!.json() }).toMatchObject({
      status: 409,
      body: { code: "TASK_LIST_SCOPE_COLLISION" },
    });
    expect(await store.taskLists.list(project.id)).toEqual([]);
  });

  test("conditionally rolls back only an unchanged operation-owned task list", async () => {
    const created = await request("/v1/projects", "POST", {
      name: "Rollback",
      path: "/workspace/rollback",
      task_list_id: "rollback",
    });
    const project = (await created!.json() as { project: { id: string; updated_at: string } }).project;
    const applied = await request(`/v1/projects/${project.id}/task-list/ensure`, "POST", {
      expected_project_revision: project.updated_at,
      idempotency_key: "rollback-default-task-list",
    });
    const body = await applied!.json() as {
      task_list: { id: string; updated_at: string };
      receipt: { receipt_id: string; result_revision: string };
    };

    const rolledBack = await request(
      `/v1/projects/${project.id}/task-list/rollback`,
      "POST",
      {
        receipt_id: body.receipt.receipt_id,
        expected_task_list_revision: body.receipt.result_revision,
      },
    );
    expect(rolledBack?.status).toBe(200);
    expect(await rolledBack!.json()).toMatchObject({
      action: "removed",
      project_id: project.id,
      task_list_id: body.task_list.id,
      accepted_receipt_id: body.receipt.receipt_id,
    });
    expect(await store.taskLists.get(body.task_list.id)).toBeNull();
  });

  test("refuses rollback after the operation-owned task list drifts", async () => {
    const created = await request("/v1/projects", "POST", {
      name: "Rollback drift",
      path: "/workspace/rollback-drift",
      task_list_id: "rollback-drift",
    });
    const project = (await created!.json() as { project: { id: string; updated_at: string } }).project;
    const applied = await request(`/v1/projects/${project.id}/task-list/ensure`, "POST", {
      expected_project_revision: project.updated_at,
      idempotency_key: "rollback-drift-default-task-list",
    });
    const body = await applied!.json() as {
      task_list: { id: string };
      receipt: { receipt_id: string; result_revision: string };
    };
    await store.taskLists.update(body.task_list.id, { description: "operator-owned change" });

    const rollback = await request(
      `/v1/projects/${project.id}/task-list/rollback`,
      "POST",
      {
        receipt_id: body.receipt.receipt_id,
        expected_task_list_revision: body.receipt.result_revision,
      },
    );
    expect({ status: rollback?.status, body: await rollback!.json() }).toMatchObject({
      status: 409,
      body: { code: "PROJECT_TASK_LIST_ROLLBACK_CONFLICT", conflict: true },
    });
    expect(await store.taskLists.get(body.task_list.id)).toMatchObject({
      id: body.task_list.id,
      description: "operator-owned change",
    });
  });

  test("refuses rollback when dependents exist or the backend lacks atomic conditional delete", async () => {
    const created = await request("/v1/projects", "POST", {
      name: "Rollback safety",
      path: "/workspace/rollback-safety",
      task_list_id: "rollback-safety",
    });
    const project = (await created!.json() as { project: { id: string; updated_at: string } }).project;
    const applied = await request(`/v1/projects/${project.id}/task-list/ensure`, "POST", {
      expected_project_revision: project.updated_at,
      idempotency_key: "rollback-safety-default-list",
    });
    const body = await applied!.json() as {
      task_list: { id: string };
      receipt: { receipt_id: string; result_revision: string; rollback_supported: boolean };
    };
    expect(body.receipt.rollback_supported).toBe(true);
    await store.tasks.create({
      title: "Dependent task",
      project_id: project.id,
      task_list_id: body.task_list.id,
    });

    const dependentRollback = await request(
      `/v1/projects/${project.id}/task-list/rollback`,
      "POST",
      {
        receipt_id: body.receipt.receipt_id,
        expected_task_list_revision: body.receipt.result_revision,
      },
    );
    expect({ status: dependentRollback?.status, body: await dependentRollback!.json() }).toMatchObject({
      status: 409,
      body: { code: "PROJECT_TASK_LIST_ROLLBACK_HAS_DEPENDENTS", conflict: true },
    });
    expect(await store.taskLists.get(body.task_list.id)).not.toBeNull();

    const atomicStore = store;
    store = {
      ...atomicStore,
      taskLists: {
        ...atomicStore.taskLists,
        deleteIfUnchangedAndUnused: undefined,
      },
    };
    const reapplied = await request(`/v1/projects/${project.id}/task-list/ensure`, "POST", {
      expected_project_revision: project.updated_at,
      idempotency_key: "rollback-safety-default-list",
    });
    expect(await reapplied!.json()).toMatchObject({
      action: "already_present",
      receipt: { rollback_supported: false },
    });
    const unsupportedRollback = await request(
      `/v1/projects/${project.id}/task-list/rollback`,
      "POST",
      {
        receipt_id: body.receipt.receipt_id,
        expected_task_list_revision: body.receipt.result_revision,
      },
    );
    expect({ status: unsupportedRollback?.status, body: await unsupportedRollback!.json() }).toMatchObject({
      status: 409,
      body: { code: "PROJECT_TASK_LIST_ROLLBACK_CONFLICT", conflict: true },
    });
    expect(await atomicStore.taskLists.get(body.task_list.id)).not.toBeNull();
  });

  test("routes package-owned conditional project registration through authenticated v1", async () => {
    const capabilityResponse = await request("/v1/project-registration/capability");
    expect(capabilityResponse?.status).toBe(200);
    const { capability } = await capabilityResponse!.json() as {
      capability: {
        route: string;
        package_version: string;
        authority_id: string;
        tenant_id: string;
        corpus_id: string;
      };
    };
    const desired = {
      source_project_id: "wks_fleetresourcesv1",
      source_project_slug: "fleet-resources",
      name: "Fleet Resources",
    };
    const requestDigest = digestProjectRegistrationValue(desired);
    const preconditionDigest = digestProjectRegistrationValue({
      target_selector: "wks_fleetresourcesv1",
      expected: "absent",
    });
    const registration = {
      operation_id: "fleet-resources-v1-registration-0001",
      step_id: "todos_project",
      resource_kind: "project",
      direction: "forward",
      authority_route: capability.route,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      target_selector: "wks_fleetresourcesv1",
      idempotency_key: deriveTodosProjectRegistrationIdempotencyKey({
        operation_id: "fleet-resources-v1-registration-0001",
        step_id: "todos_project",
        direction: "forward",
        target_selector: "wks_fleetresourcesv1",
        request_digest: requestDigest,
        precondition_digest: preconditionDigest,
      }),
      request_digest: requestDigest,
      precondition_digest: preconditionDigest,
      project_id: "wks_fleetresourcesv1",
      project_slug: "fleet-resources",
      project_name: "Fleet Resources",
      desired,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    };
    const created = await request(
      "/v1/project-registration/create",
      "POST",
      registration,
    );
    expect(created?.status).toBe(201);
    const createdBody = await created!.json() as {
      receipt: Record<string, unknown> & {
        receipt_id: string;
        target_id: string;
        result_revision: string;
        result_digest: string;
        outcome: string;
      };
    };
    const receiptId = createdBody.receipt.receipt_id;
    const targetId = createdBody.receipt.target_id;
    expect(createdBody.receipt.outcome).toBe("accepted");
    expect(typeof targetId).toBe("string");

    const lookup = await request(
      "/v1/project-registration/receipts/lookup",
      "POST",
      {
        operation_id: registration.operation_id,
        step_id: registration.step_id,
        resource_kind: registration.resource_kind,
        direction: registration.direction,
        authority: "todos",
        authority_route: capability.route,
        package_version: capability.package_version,
        authority_id: capability.authority_id,
        tenant_id: capability.tenant_id,
        corpus_id: capability.corpus_id,
        target_selector: registration.target_selector,
        idempotency_key: registration.idempotency_key,
        target_id: targetId,
        max_items: 1,
        response_byte_limit: 65_536,
        time_budget_ms: 5_000,
      },
    );
    const lookupBody = await lookup!.json();
    expect({ status: lookup?.status, body: lookupBody }).toMatchObject({
      status: 200,
      body: {
        receipt: {
          receipt_id: receiptId,
          target_id: targetId,
        },
        response_control: {
          complete: true,
          truncated: false,
        },
      },
    });

    const readback = await request(
      "/v1/project-registration/read-exact",
      "POST",
      {
        resource_kind: "project",
        target_id: targetId,
        response_byte_limit: 65_536,
        time_budget_ms: 5_000,
      },
    );
    expect(readback?.status).toBe(200);
    expect(await readback!.json()).toEqual({
      record: {
        target_id: targetId,
        revision: createdBody.receipt.result_revision,
        digest: createdBody.receipt.result_digest,
      },
    });

    const inverseDesired = {
      accepted_receipt_id: receiptId,
      target_id: targetId,
    };
    const inversePrecondition = {
      expected_revision: createdBody.receipt.result_revision,
      expected_digest: createdBody.receipt.result_digest,
    };
    const inverseRequestDigest = digestProjectRegistrationValue(inverseDesired);
    const inversePreconditionDigest = digestProjectRegistrationValue(inversePrecondition);
    const inverse = {
      ...registration,
      direction: "inverse",
      target_selector: targetId,
      desired: inverseDesired,
      request_digest: inverseRequestDigest,
      precondition_digest: inversePreconditionDigest,
      idempotency_key: deriveTodosProjectRegistrationIdempotencyKey({
        operation_id: registration.operation_id,
        step_id: registration.step_id,
        direction: "inverse",
        target_selector: targetId,
        request_digest: inverseRequestDigest,
        precondition_digest: inversePreconditionDigest,
      }),
      accepted_receipt: createdBody.receipt,
    };
    const compensated = await request(
      "/v1/project-registration/compensate",
      "POST",
      inverse,
    );
    expect({ status: compensated?.status, body: await compensated!.json() })
      .toMatchObject({
        status: 201,
        body: {
          receipt: {
            outcome: "accepted",
            direction: "inverse",
            target_id: targetId,
            accepted_receipt_id: receiptId,
            result_revision: "absent",
          },
        },
      });
    const verified = await request(
      "/v1/project-registration/verify-inverse",
      "POST",
      inverse,
    );
    expect({ status: verified?.status, body: await verified!.json() })
      .toMatchObject({
        status: 200,
        body: {
          verification: {
            target_id: targetId,
            accepted_receipt_id: receiptId,
            absent: true,
          },
        },
      });
    expect(await store.projects.get(targetId)).toBeNull();
  });

  test("routes authenticated PR-group state and history through the injected authority", async () => {
    const admitted = await request("/v1/pr-groups/admit", "POST", {
      root_request_id: "request-root",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task",
      dispatch_attempt: "dispatch-1",
      writer_generation: "generation-1",
      worktree: "/tmp/pr-group",
      branch: "feat/pr-group",
      pr_number: 78,
      base_sha: "a".repeat(40),
      admitted_at: "2026-07-23T10:00:00.000Z",
    });
    expect(admitted?.status).toBe(201);
    const admission = await admitted!.json() as {
      view: { group: { id: string }; attempts: Array<{ id: string }> };
    };
    const progress = await request(
      `/v1/pr-groups/${admission.view.group.id}/events`,
      "POST",
      {
        attempt_id: admission.view.attempts[0]!.id,
        writer_generation: "generation-1",
        idempotency_key: "progress-1",
        event_type: "progress",
      },
    );
    expect(progress?.status).toBe(201);
    expect(await (await request(`/v1/pr-groups/${admission.view.group.id}`))!.json()).toMatchObject({
      view: { authoritative: true, group: { state: "in_progress" } },
    });
    expect(await (await request(`/v1/pr-groups/${admission.view.group.id}/events?limit=1`))!.json())
      .toMatchObject({ history: { count: 1, has_more: true } });
  });

  test("binds review actor and actor-run identity to the signed v1 principal", async () => {
    const head = "a".repeat(40);
    const base = "b".repeat(40);
    principal = { agent: "reviewer-1", kid: "signed-key-run-1", scopes: ["todos:*"] };
    const admitted = await request("/v1/pr-groups/admit", "POST", {
      root_request_id: "authenticated-review",
      repository: "hasna/todos",
      leaf_task_id: "leaf-authenticated-review",
      dispatch_attempt: "dispatch-authenticated-review",
      writer_generation: "generation-authenticated-review",
      worktree: "/tmp/authenticated-review",
      branch: "feat/authenticated-review",
      pr_number: 78,
      base_sha: base,
      admitted_at: "2026-07-23T10:00:00.000Z",
    });
    const admission = await admitted!.json() as {
      view: { group: { id: string }; attempts: Array<{ id: string }> };
    };
    const path = `/v1/pr-groups/${admission.view.group.id}/events`;
    const envelope = {
      attempt_id: admission.view.attempts[0]!.id,
      writer_generation: "generation-authenticated-review",
    };
    for (const [idempotency_key, event_type] of [
      ["authenticated-start", "started"],
      ["authenticated-handoff", "handoff"],
    ]) {
      expect((await request(path, "POST", { ...envelope, idempotency_key, event_type }))?.status).toBe(201);
    }
    expect((await request(path, "POST", {
      ...envelope,
      idempotency_key: "authenticated-review-request",
      event_type: "review_requested",
      head_sha: head,
      repository: "hasna/todos",
      pr_number: 78,
      base_sha: base,
      expected_reviewer_id: "reviewer-1",
    }))?.status).toBe(201);

    const forged = await request(path, "POST", {
      ...envelope,
      idempotency_key: "forged-review-receipt",
      event_type: "review_receipt",
      head_sha: head,
      receipt_key: "forged-review-receipt",
      outcome: "approved",
      repository: "hasna/todos",
      pr_number: 78,
      base_sha: base,
      actor_id: "reviewer-1",
      actor_run_id: "forged-run",
    });
    expect(forged?.status).toBe(409);
    expect(await forged!.json()).toMatchObject({ code: "PR_GROUP_IDENTITY_CONFLICT" });

    const accepted = await request(path, "POST", {
      ...envelope,
      idempotency_key: "authenticated-review-receipt",
      event_type: "review_receipt",
      head_sha: head,
      receipt_key: "authenticated-review-receipt",
      outcome: "approved",
      repository: "hasna/todos",
      pr_number: 78,
      base_sha: base,
      actor_id: "reviewer-1",
      actor_run_id: "signed-key-run-1",
    });
    expect(accepted?.status).toBe(201);
    expect(await accepted!.json()).toMatchObject({
      event: { actor_id: "reviewer-1", actor_run_id: "signed-key-run-1" },
    });
  });

  test("list tasks returns total and honors every documented filter plus offset", async () => {
    const project = await store.projects.create({ name: "Filtered", path: "/tmp/filtered" });
    const list = await store.taskLists.create({ name: "Queue", slug: "queue", project_id: project.id });
    const plan = await store.plans.create({ name: "Plan", project_id: project.id });
    await store.tasks.create({ title: "first", project_id: project.id, task_list_id: list.id, plan_id: plan.id, status: "pending", priority: "high", assigned_to: "agent-a", agent_id: "owner-a" });
    await store.tasks.create({ title: "second", project_id: project.id, task_list_id: list.id, plan_id: plan.id, status: "pending", priority: "high", assigned_to: "agent-a", agent_id: "owner-a" });
    await store.tasks.create({ title: "excluded", project_id: project.id, task_list_id: list.id, plan_id: plan.id, status: "pending", priority: "low", assigned_to: "agent-b", agent_id: "owner-b" });

    const params = new URLSearchParams({
      status: "pending",
      priority: "high",
      project_id: project.id,
      plan_id: plan.id,
      task_list_id: list.id,
      assigned_to: "agent-a",
      agent_id: "owner-a",
      limit: "1",
      offset: "1",
    });
    const response = await request(`/v1/tasks?${params}`);
    expect(response?.status).toBe(200);
    const body = await response!.json() as { tasks: Array<{ title: string }>; count: number; total: number };
    expect(body).toMatchObject({ count: 1, total: 2 });
    params.set("offset", "0");
    const firstPage = await request(`/v1/tasks?${params}`);
    const firstBody = await firstPage!.json() as { tasks: Array<{ title: string }>; count: number; total: number };
    expect(firstBody).toMatchObject({ count: 1, total: 2 });
    expect(new Set([body.tasks[0]!.title, firstBody.tasks[0]!.title])).toEqual(new Set(["first", "second"]));
  });

  test("create, project-scoped enumeration, get, update, and delete share one canonical id", async () => {
    const project = await store.projects.create({ name: "Open Emails", path: "/tmp/open-emails" });
    await store.taskLists.create({ name: "Other", slug: "other" });
    const created = await request("/v1/task-lists", "POST", {
      name: "Open Emails",
      slug: "todos-open-emails",
      project_id: project.id,
    });
    expect(created?.status).toBe(201);
    const createdBody = await created!.json() as { task_list: { id: string } };

    const listed = await request(`/v1/task-lists?project_id=${project.id}`);
    const listedBody = await listed!.json() as { task_lists: Array<{ id: string }> };
    expect(listedBody.task_lists.map((list) => list.id)).toEqual([createdBody.task_list.id]);

    expect((await request(`/v1/task-lists/${createdBody.task_list.id}`))?.status).toBe(200);
    const updated = await request(`/v1/task-lists/${createdBody.task_list.id}`, "PATCH", {
      slug: "emails-next",
      name: "Emails Next",
    });
    expect(updated?.status).toBe(200);
    expect(await updated!.json()).toMatchObject({
      task_list: { id: createdBody.task_list.id, slug: "emails-next", name: "Emails Next" },
    });
    expect((await request(`/v1/task-lists/${createdBody.task_list.id}`, "PATCH", { slug: 42 }))?.status).toBe(400);
    expect((await request(`/v1/task-lists/${createdBody.task_list.id}`, "PATCH", { metadata: [] }))?.status).toBe(400);
    expect((await request(`/v1/task-lists/${createdBody.task_list.id}`, "PATCH", { project_id: null }))?.status).toBe(400);
    expect((await request(`/v1/task-lists/${createdBody.task_list.id}`, "DELETE"))?.status).toBe(200);
    expect((await request(`/v1/task-lists/${createdBody.task_list.id}`))?.status).toBe(404);
  });

  test("task-list filtering does not return unrelated tasks", async () => {
    const listA = await store.taskLists.create({ name: "A", slug: "a" });
    const listB = await store.taskLists.create({ name: "B", slug: "b" });
    await store.tasks.create({ title: "in scope", task_list_id: listA.id });
    await store.tasks.create({ title: "out of scope", task_list_id: listB.id });

    const response = await request(`/v1/tasks?task_list_id=${listA.id}`);
    const body = await response!.json() as { tasks: Array<{ title: string; task_list_id: string }> };
    expect(body.tasks.map((task) => task.title)).toEqual(["in scope"]);
    expect(body.tasks.every((task) => task.task_list_id === listA.id)).toBe(true);
  });

  test("returns a stable 409 for duplicate task-list create and update", async () => {
    const project = await store.projects.create({ name: "Open Emails", path: "/tmp/open-emails" });
    const first = await store.taskLists.create({ name: "Inbox", slug: "inbox", project_id: project.id });
    const second = await store.taskLists.create({ name: "Archive", slug: "archive", project_id: project.id });

    for (const response of [
      await request("/v1/task-lists", "POST", { name: "Duplicate", slug: "inbox", project_id: project.id }),
      await request(`/v1/task-lists/${second.id}`, "PATCH", { slug: first.slug }),
    ]) {
      expect(response?.status).toBe(409);
      expect(await response!.json()).toMatchObject({ code: "TASK_LIST_SLUG_CONFLICT", conflict: true });
    }
  });

  test("rejects explicit and derived empty task-list slugs before storage", async () => {
    for (const body of [
      { name: "---" },
      { name: "Inbox", slug: "" },
      { name: "Inbox", slug: "---" },
    ]) {
      expect((await request("/v1/task-lists", "POST", body))?.status).toBe(400);
    }
    const list = await store.taskLists.create({ name: "Inbox", slug: "inbox" });
    expect((await request(`/v1/task-lists/${list.id}`, "PATCH", { slug: "---" }))?.status).toBe(400);
    expect(await store.taskLists.get(list.id)).toMatchObject({ slug: "inbox" });
  });
});

describe("/v1 guarded plan/project linkage", () => {
  test("plans, atomically applies, enforces future membership, and rolls back exact prior links", async () => {
    const priorProjectResponse = await request("/v1/projects", "POST", {
      name: "Prior project",
      path: "/workspace/prior-project",
    });
    const targetProjectResponse = await request("/v1/projects", "POST", {
      name: "Target project",
      path: "/workspace/target-project",
    });
    const priorProject = (await priorProjectResponse!.json() as { project: { id: string } }).project;
    const targetProject = (await targetProjectResponse!.json() as {
      project: { id: string; updated_at: string };
    }).project;
    const planResponse = await request("/v1/plans", "POST", { name: "Existing plan" });
    const plan = (await planResponse!.json() as {
      plan: { id: string; updated_at: string; project_id: string | null };
    }).plan;
    const memberResponse = await request("/v1/tasks", "POST", {
      title: "Existing member",
      plan_id: plan.id,
      project_id: priorProject.id,
    });
    const member = (await memberResponse!.json() as { task: { id: string } }).task;

    const plannedResponse = await request(
      `/v1/plans/${encodeURIComponent(plan.id)}/project-link?project_id=${encodeURIComponent(targetProject.id)}`,
    );
    expect(plannedResponse?.status).toBe(200);
    const planned = await plannedResponse!.json() as {
      action: string;
      plan: { updated_at: string };
      project: { updated_at: string };
      tasks: Array<{ id: string; project_id: string | null }>;
    };
    expect(planned).toMatchObject({
      action: "would_link",
      tasks: [{ id: member.id, project_id: priorProject.id }],
    });

    const appliedResponse = await request(
      `/v1/plans/${encodeURIComponent(plan.id)}/project-link`,
      "POST",
      {
        project_id: targetProject.id,
        expected_plan_revision: planned.plan.updated_at,
        expected_project_revision: planned.project.updated_at,
        idempotency_key: "v1-plan-project-link-fixture",
      },
    );
    expect(appliedResponse?.status).toBe(201);
    const applied = await appliedResponse!.json() as {
      plan: { updated_at: string; project_id: string | null };
      tasks: Array<{ id: string; project_id: string | null }>;
      receipt: { receipt_id: string };
    };
    expect(applied.plan.project_id).toBe(targetProject.id);
    expect(applied.tasks).toEqual([expect.objectContaining({ id: member.id, project_id: targetProject.id })]);

    const inheritedResponse = await request("/v1/tasks", "POST", {
      title: "Future member",
      plan_id: plan.id,
    });
    expect(inheritedResponse?.status).toBe(201);
    const inherited = (await inheritedResponse!.json() as {
      task: { id: string; project_id: string | null };
    }).task;
    expect(inherited.project_id).toBe(targetProject.id);

    const conflictingCreate = await request("/v1/tasks", "POST", {
      title: "Conflicting member",
      plan_id: plan.id,
      project_id: priorProject.id,
    });
    expect(conflictingCreate?.status).toBe(409);
    expect(await conflictingCreate!.json()).toMatchObject({ code: "PLAN_PROJECT_LINK_CONFLICT" });

    const conflictingUpdate = await request(`/v1/tasks/${encodeURIComponent(member.id)}`, "PATCH", {
      project_id: priorProject.id,
    });
    expect(conflictingUpdate?.status).toBe(409);
    expect(await conflictingUpdate!.json()).toMatchObject({ code: "PLAN_PROJECT_LINK_CONFLICT" });

    // A new member changes the accepted membership digest, so rollback must
    // fail closed instead of partially restoring a plan whose membership moved.
    const rollbackConflict = await request(
      `/v1/plans/${encodeURIComponent(plan.id)}/project-link/rollback`,
      "POST",
      {
        project_id: targetProject.id,
        receipt_id: applied.receipt.receipt_id,
        expected_plan_revision: applied.plan.updated_at,
      },
    );
    expect(rollbackConflict?.status).toBe(409);

    const cleared = await request(`/v1/tasks/${encodeURIComponent(inherited.id)}`, "PATCH", { plan_id: null });
    expect(cleared?.status).toBe(200);
    const currentPlanResponse = await request(`/v1/plans/${encodeURIComponent(plan.id)}`);
    const currentPlan = (await currentPlanResponse!.json() as { plan: { updated_at: string } }).plan;
    const rolledBackResponse = await request(
      `/v1/plans/${encodeURIComponent(plan.id)}/project-link/rollback`,
      "POST",
      {
        project_id: targetProject.id,
        receipt_id: applied.receipt.receipt_id,
        expected_plan_revision: currentPlan.updated_at,
      },
    );
    expect(rolledBackResponse?.status).toBe(200);
    expect(await rolledBackResponse!.json()).toMatchObject({
      action: "restored",
      plan: { id: plan.id, project_id: null },
      tasks: [{ id: member.id, project_id: priorProject.id }],
    });
  });
});

describe("/v1 plan cloud parity", () => {
  test("create, list, get, complete, and delete share one canonical id", async () => {
    const created = await request("/v1/plans", "POST", {
      name: "Codila CLI control",
      slug: "codila-cli-control",
      description: "Private CLI release plan",
    });
    expect(created?.status).toBe(201);
    const createdPlan = (await created!.json() as { plan: { id: string; slug: string } }).plan;
    expect(createdPlan.slug).toBe("codila-cli-control");

    const titleAlias = await request("/v1/plans", "POST", { title: "Title alias" });
    expect(titleAlias?.status).toBe(201);
    expect(await titleAlias!.json()).toMatchObject({ plan: { name: "Title alias" } });

    for (const body of [
      {},
      { name: 42 },
      { title: "Title", name: "Different" },
      { name: "Bad status", status: "done" },
      { name: "Bad slug", slug: "---" },
      { name: "Unknown", extra: true },
    ]) {
      expect((await request("/v1/plans", "POST", body))?.status).toBe(400);
    }
    const duplicateCreate = await request("/v1/plans", "POST", { name: "Duplicate", slug: "codila cli control" });
    expect(duplicateCreate?.status).toBe(409);
    expect(await duplicateCreate!.json()).toMatchObject({ code: "PLAN_SLUG_CONFLICT", conflict: true });

    const listed = await request("/v1/plans");
    expect(await listed!.json()).toMatchObject({ count: 2 });
    expect((await request(`/v1/plans/${createdPlan.id}`))?.status).toBe(200);

    const completed = await request(`/v1/plans/${createdPlan.id}`, "PATCH", { status: "completed" });
    expect(completed?.status).toBe(200);
    expect(await completed!.json()).toMatchObject({ plan: { id: createdPlan.id, status: "completed" } });

    for (const patch of [{}, { status: "done" }, { name: "" }, { slug: "---" }, { description: 42 }, { project_id: "unsafe" }]) {
      expect((await request(`/v1/plans/${createdPlan.id}`, "PATCH", patch))?.status).toBe(400);
    }
    const other = await request("/v1/plans", "POST", { name: "Other plan", slug: "other-plan" });
    const otherPlan = (await other!.json() as { plan: { id: string } }).plan;
    const duplicatePatch = await request(`/v1/plans/${otherPlan.id}`, "PATCH", { slug: "codila cli control" });
    expect(duplicatePatch?.status).toBe(409);
    expect(await duplicatePatch!.json()).toMatchObject({ code: "PLAN_SLUG_CONFLICT", conflict: true });
    expect((await request("/v1/plans/missing", "PATCH", { status: "completed" }))?.status).toBe(404);

    expect((await request(`/v1/plans/${createdPlan.id}`, "DELETE"))?.status).toBe(200);
    expect((await request(`/v1/plans/${createdPlan.id}`))?.status).toBe(404);
  });
});

describe("/v1 reusable template cloud parity", () => {
  test("creates, scopes, reads, and deletes an imported checklist without losing its steps", async () => {
    const project = await store.projects.create({ name: "Ro Accounting", path: "/tmp/ro-accounting" });
    const created = await request("/v1/templates", "POST", {
      name: "Monthly accounting",
      title_pattern: "Monthly accounting {month}",
      project_id: project.id,
      tags: ["accounting"],
      tasks: [
        { title_pattern: "Collect statements {month}" },
        { title_pattern: "Reconcile {month}", depends_on: [0], priority: "high" },
      ],
    });
    expect(created?.status).toBe(201);
    const createdBody = await created!.json() as { template: { id: string; tasks: Array<{ position: number; depends_on_positions: number[] }> } };
    expect(createdBody.template.tasks).toEqual([
      expect.objectContaining({ position: 0, depends_on_positions: [] }),
      expect.objectContaining({ position: 1, depends_on_positions: [0] }),
    ]);

    const listed = await request(`/v1/templates?project_id=${project.id}`);
    expect(await listed!.json()).toMatchObject({ count: 1, templates: [expect.objectContaining({ id: createdBody.template.id })] });
    const read = await request(`/v1/templates/${createdBody.template.id}`);
    expect(await read!.json()).toMatchObject({ template: { id: createdBody.template.id, tasks: [expect.anything(), expect.anything()] } });

    expect((await request(`/v1/templates/${createdBody.template.id}`, "DELETE"))?.status).toBe(200);
    expect((await request(`/v1/templates/${createdBody.template.id}`))?.status).toBe(404);
  });

  test("rejects forward checklist dependencies before any remote mutation", async () => {
    const response = await request("/v1/templates", "POST", {
      name: "Invalid",
      title_pattern: "Invalid",
      tasks: [{ title_pattern: "Later", depends_on: [0] }],
    });
    expect(response?.status).toBe(400);
    expect(await response!.json()).toMatchObject({ error: expect.stringMatching(/earlier task positions/) });
    expect((await store.templates.list()).length).toBe(0);
  });

  test("accepts the canonical template-export shape for remote import and supports lifecycle metadata updates", async () => {
    const imported = await request("/v1/templates", "POST", {
      name: "Exported monthly accounting",
      title_pattern: "Monthly accounting {month}",
      description: null,
      priority: "medium",
      tags: ["accounting"],
      variables: [],
      project_id: null,
      plan_id: null,
      metadata: {},
      tasks: [{
        position: 0,
        title_pattern: "Collect statements {month}",
        description: null,
        priority: "high",
        tags: [],
        task_type: null,
        condition: null,
        include_template_id: null,
        depends_on_positions: [],
        metadata: {},
      }],
    });
    expect(imported?.status).toBe(201);
    const body = await imported!.json() as { template: { id: string; description: null; project_id: null; tasks: Array<{ depends_on_positions: number[] }> } };
    expect(body.template).toMatchObject({ description: null, project_id: null, tasks: [{ depends_on_positions: [] }] });

    const updated = await request(`/v1/templates/${body.template.id}`, "PATCH", { priority: "high" });
    expect(updated?.status).toBe(200);
    expect(await updated!.json()).toMatchObject({ template: { priority: "high" } });

    const patchProject = await store.projects.create({ name: "Patch project", path: "/tmp/patch-project" });
    const patchPlan = await store.plans.create({ name: "Patch plan", project_id: patchProject.id });
    const patchable = await store.templates.create({
      name: "Clearable", title_pattern: "Clearable", description: "obsolete", project_id: patchProject.id, plan_id: patchPlan.id,
    });
    const cleared = await request(`/v1/templates/${patchable.id}`, "PATCH", {
      description: null, project_id: null, plan_id: null,
    });
    expect(cleared?.status).toBe(200);
    expect(await cleared!.json()).toMatchObject({ template: { description: null, project_id: null, plan_id: null } });
  });
});

describe("/v1 project mutation", () => {
  test("create preserves explicit canonical routing fields while patch cannot mutate them", async () => {
    const explicit = await request("/v1/projects", "POST", {
      name: "Injected",
      path: "/tmp/injected",
      task_list_id: "injected-explicit",
      task_prefix: "INJ",
    });
    expect(explicit?.status).toBe(201);
    expect(await explicit!.json()).toMatchObject({
      project: { task_list_id: "injected-explicit", task_prefix: "INJ" },
    });
    expect((await request("/v1/projects", "POST", {
      name: "Invalid Explicit",
      path: "/tmp/invalid-explicit",
      task_list_id: "Not Canonical !!",
    }))?.status).toBe(400);

    const first = await request("/v1/projects", "POST", { name: "Open Emails", path: "/tmp/open-emails" });
    expect(first?.status).toBe(201);
    const firstProject = (await first!.json() as { project: { id: string; task_list_id: string } }).project;
    expect(firstProject.task_list_id).toBe("todos-open-emails");

    const distinct = await request("/v1/projects", "POST", {
      name: "Open Emails",
      path: "/tmp/open-emails-2",
      task_list_id: "open-emails-secondary",
    });
    expect(distinct?.status).toBe(201);

    const duplicate = await request("/v1/projects", "POST", { name: "Open Emails", path: "/tmp/open-emails-3" });
    expect(duplicate?.status).toBe(409);
    expect(await duplicate!.json()).toMatchObject({ code: "PROJECT_SLUG_CONFLICT", conflict: true });

    const bypass = await request(`/v1/projects/${firstProject.id}`, "PATCH", { task_list_id: "bypass" });
    expect(bypass?.status).toBe(400);
    expect(await store.projects.get(firstProject.id)).toMatchObject({ task_list_id: "todos-open-emails" });

    const emptyCanonicalSlug = await request("/v1/projects", "POST", { name: "---", path: "/tmp/empty" });
    expect(emptyCanonicalSlug?.status).toBe(400);
  });

  test("renames a project and its canonical task list atomically", async () => {
    const project = await store.projects.create({ name: "Open Emails", path: "/tmp/open-emails", task_list_id: "emails" });
    const list = await store.taskLists.create({ name: "Open Emails", slug: "emails", project_id: project.id });

    const response = await request(`/v1/projects/${project.id}/rename`, "POST", {
      new_slug: "emails-next",
      name: "Emails Next",
    });
    expect(response?.status).toBe(200);
    expect(await response!.json()).toMatchObject({
      project: { id: project.id, name: "Emails Next", task_list_id: "emails-next" },
      task_lists_updated: 1,
    });
    expect(await store.taskLists.get(list.id)).toMatchObject({ slug: "emails-next", name: "Emails Next" });

    const invalid = await request(`/v1/projects/${project.id}/rename`, "POST", { new_slug: "---" });
    expect(invalid?.status).toBe(400);
    expect(await store.projects.get(project.id)).toMatchObject({ task_list_id: "emails-next" });
  });

  test("rejects unknown and malformed project patch fields", async () => {
    const project = await store.projects.create({ name: "Open Emails", path: "/tmp/open-emails" });
    for (const body of [{ task_prefix: "BAD" }, { name: "" }, { description: 42 }, {}]) {
      const response = await request(`/v1/projects/${project.id}`, "PATCH", body);
      expect(response?.status).toBe(400);
    }
    expect((await request(`/v1/projects/${project.id}/rename`, "POST", { new_slug: "next", extra: true }))?.status).toBe(400);
    expect((await request("/v1/projects/missing", "PATCH", { name: "Missing" }))?.status).toBe(404);
  });
});

describe("/v1 task hierarchy and lock authorization", () => {
  test("starting a failed task returns a pending-reset transition error while pending still starts", async () => {
    const failed = await store.tasks.create({ title: "failed start", status: "failed" });
    const rejected = await request(`/v1/tasks/${failed.id}/start`, "POST", { agent_id: "silvanus" });

    expect(rejected?.status).toBe(409);
    expect(await rejected!.json()).toMatchObject({
      code: "TASK_NOT_STARTABLE",
      error: expect.stringContaining("pending"),
    });
    expect(await store.tasks.get(failed.id)).toMatchObject({ status: "failed", locked_by: null });

    const pending = await store.tasks.create({ title: "pending start" });
    const started = await request(`/v1/tasks/${pending.id}/start`, "POST", { agent_id: "silvanus" });

    expect(started?.status).toBe(200);
    expect(await started!.json()).toMatchObject({
      task: { id: pending.id, status: "in_progress", locked_by: "silvanus" },
    });
    expect(await store.tasks.get(pending.id)).toMatchObject({ status: "in_progress", locked_by: "silvanus" });
  });

  test("complete persists the full operational evidence body and confidence", async () => {
    const task = await store.tasks.create({ title: "evidence" });
    const response = await request(`/v1/tasks/${task.id}/complete`, "POST", {
      agent_id: "reviewer",
      attachment_ids: ["attachment-one", "attachment-two"],
      files_changed: ["src/a.ts", "src/b.ts"],
      test_results: "12 passed",
      commit_hash: "abc123",
      notes: "verified",
      confidence: 0.85,
    });
    expect(response?.status).toBe(200);
    const completed = (await response!.json() as { task: { confidence: number; metadata: Record<string, unknown> } }).task;
    expect(completed.confidence).toBe(0.85);
    expect(completed.metadata).toMatchObject({
      _evidence: {
        attachment_ids: ["attachment-one", "attachment-two"],
        files_changed: ["src/a.ts", "src/b.ts"],
        test_results: "12 passed",
        commit_hash: "abc123",
        notes: "verified",
      },
      _completion: { confidence: 0.85 },
    });
    expect(await store.tasks.get(task.id)).toMatchObject({ confidence: 0.85, metadata: completed.metadata });
  });

  test("complete rejects malformed evidence and confidence before storage mutation", async () => {
    for (const body of [
      null,
      [],
      { confidence: -0.1 },
      { confidence: 1.1 },
      { confidence: "high" },
      { attachment_ids: ["ok", 42] },
      { files_changed: "src/a.ts" },
      { test_results: 42 },
      { commit_hash: { sha: "abc" } },
      { notes: ["bad"] },
      { unknown: true },
    ]) {
      const task = await store.tasks.create({ title: `invalid ${JSON.stringify(body)}` });
      const response = await request(`/v1/tasks/${task.id}/complete`, "POST", body);
      expect(response?.status).toBe(400);
      expect(await store.tasks.get(task.id)).toMatchObject({ status: "pending", confidence: null });
    }
  });

  test("complete preserves empty-body and agent-only predecessor compatibility", async () => {
    const empty = await store.tasks.create({ title: "empty completion" });
    const emptyResponse = await request(`/v1/tasks/${empty.id}/complete`, "POST");
    expect(emptyResponse?.status).toBe(200);

    const agentOnly = await store.tasks.create({ title: "agent completion" });
    const agentResponse = await request(`/v1/tasks/${agentOnly.id}/complete`, "POST", { agent_id: "compat-agent" });
    expect(agentResponse?.status).toBe(200);
    expect(await store.tasks.get(agentOnly.id)).toMatchObject({ status: "completed" });
  });

  test("create persists parent_id and parent filtering includes only children", async () => {
    const parent = await store.tasks.create({ title: "parent" });
    const created = await request("/v1/tasks", "POST", { title: "child", parent_id: parent.id });
    const createdBody = await created!.json() as { task: { id: string; parent_id: string | null } };
    expect(createdBody.task.parent_id).toBe(parent.id);
    expect(await store.tasks.get(createdBody.task.id)).toMatchObject({
      id: createdBody.task.id,
      parent_id: parent.id,
    });

    const response = await request(`/v1/tasks?parent_id=${parent.id}`);
    const body = await response!.json() as { tasks: Array<{ id: string }> };
    expect(body.tasks.map((task) => task.id)).toEqual([createdBody.task.id]);
  });

  test("create rejects a nonexistent parent before emitting a task", async () => {
    const response = await request("/v1/tasks", "POST", {
      title: "invalid child",
      parent_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    });

    expect(response?.status).toBe(404);
    expect(await response!.json()).toMatchObject({
      code: "PARENT_TASK_NOT_FOUND",
      error: "parent task not found: ffffffff-ffff-4fff-8fff-ffffffffffff",
    });
    expect(await store.tasks.count({ include_subtasks: true })).toBe(0);
  });

  test("include_subtasks=true returns roots and descendants with an inclusive total", async () => {
    const parent = await store.tasks.create({ title: "parent" });
    const child = await store.tasks.create({ title: "child", parent_id: parent.id });
    const seenFilters: Array<Record<string, unknown>> = [];
    const originalList = store.tasks.list.bind(store.tasks);
    const originalCount = store.tasks.count.bind(store.tasks);
    store.tasks.list = (filter = {}) => {
      seenFilters.push({ ...filter });
      return originalList(filter);
    };
    store.tasks.count = (filter = {}) => {
      seenFilters.push({ ...filter });
      return originalCount(filter);
    };

    const response = await request("/v1/tasks?include_subtasks=true&limit=10&offset=0");
    expect(response?.status).toBe(200);
    const body = await response!.json() as { tasks: Array<{ id: string }>; count: number; total: number };
    expect(new Set(body.tasks.map((task) => task.id))).toEqual(new Set([parent.id, child.id]));
    expect(body.count).toBe(2);
    expect(body.total).toBe(2);
    expect(seenFilters).toEqual([
      { include_subtasks: true, limit: 10, offset: 0 },
      { include_subtasks: true },
    ]);
    expect((await request("/v1/tasks?include_subtasks=1"))?.status).toBe(400);
  });

  test("force unlock is restricted to todos:* and clears a parent-owned lock", async () => {
    const task = await store.tasks.create({ title: "locked" });
    await store.tasks.start(task.id, "parent-agent");

    principal = { agent: null, scopes: ["todos:write"] };
    expect((await request(`/v1/tasks/${task.id}/unlock`, "POST", { force: true }))?.status).toBe(403);

    principal = { agent: null, scopes: ["todos:*"] };
    const response = await request(`/v1/tasks/${task.id}/unlock`, "POST", { force: true });
    expect(response?.status).toBe(200);
    expect(await response!.json()).toEqual({ success: true });
    expect((await store.tasks.get(task.id))?.locked_by).toBeNull();
  });

  test("non-owner unlock is a 409 conflict and an unbound write key is denied", async () => {
    const task = await store.tasks.create({ title: "locked" });
    await store.tasks.start(task.id, "parent-agent");

    principal = { agent: "other-agent", scopes: ["todos:write"] };
    const conflict = await request(`/v1/tasks/${task.id}/unlock`, "POST");
    expect(conflict?.status).toBe(409);
    expect(await conflict!.json()).toMatchObject({ code: "LOCK_ERROR" });

    principal = { agent: null, scopes: ["todos:write"] };
    expect((await request(`/v1/tasks/${task.id}/unlock`, "POST"))?.status).toBe(403);
  });

  // Regression for a8472e06. Every station's API key binds to ONE shared principal
  // agent ("fleet") with scope todos:*, so `principal.agent || body.agent_id` discarded
  // the agent the caller named and compared the holder against "fleet" — a permanent 409
  // for every named agent on the fleet. The pre-existing non-owner test above could not
  // catch it: it only ever exercised the stranger case, so it cannot distinguish
  // "refuses a stranger" from "refuses everyone". Both directions are asserted here on
  // one fixture, and the state is read back over the HTTP surface rather than trusted
  // from the unlock response.
  test("a shared-principal key releases the lock of the agent it NAMES, and only that agent's", async () => {
    const created = await request("/v1/tasks", "POST", { title: "shared-principal lock" });
    const { task } = await created!.json() as { task: { id: string } };

    // Station shape: one shared principal agent, broad scope.
    principal = { agent: "fleet", scopes: ["todos:*"] };

    // local-sqlite exposes `unlock` but no `lock` (the lock route 501s on it), so the
    // holder is established through the same lifecycle call the route would make. The
    // asymmetry under test is in the ROUTE's identity precedence, not in the store.
    store.tasks.lock = async (id: string, agentId: string) => store.tasks.start(id, agentId);
    const locked = await request(`/v1/tasks/${task.id}/lock`, "POST", { agent_id: "nerva" });
    expect(locked?.status).toBe(200);
    // The LOCK route already prefers the caller-named agent over the principal; the
    // defect was that UNLOCK did the opposite, so a lock taken as "nerva" through a
    // "fleet" principal could never be released as "nerva".
    expect((await readTaskOverHttp(task.id)).locked_by).toBe("nerva");

    // A different named agent must NOT be able to release it.
    const stranger = await request(`/v1/tasks/${task.id}/unlock`, "POST", { agent_id: "postumius" });
    expect(stranger?.status).toBe(409);
    expect(await stranger!.json()).toMatchObject({ code: "LOCK_ERROR" });
    expect((await readTaskOverHttp(task.id)).locked_by).toBe("nerva");

    // Anonymous (no agent named, no force) falls back to the shared principal "fleet",
    // which is not the holder, so it must be refused too.
    const anonymous = await request(`/v1/tasks/${task.id}/unlock`, "POST");
    expect(anonymous?.status).toBe(409);
    expect((await readTaskOverHttp(task.id)).locked_by).toBe("nerva");

    // The holder releases its own lock.
    const released = await request(`/v1/tasks/${task.id}/unlock`, "POST", { agent_id: "nerva" });
    expect(released?.status).toBe(200);
    expect(await released!.json()).toEqual({ success: true });
    expect((await readTaskOverHttp(task.id)).locked_by).toBeNull();
  });

  test("naming another agent requires todos:*, whether or not the key is agent-bound", async () => {
    const task = await store.tasks.create({ title: "locked" });
    await store.tasks.start(task.id, "holder-agent");

    // Agent-bound key without todos:* may not name a different agent.
    principal = { agent: "other-agent", scopes: ["todos:write"] };
    expect((await request(`/v1/tasks/${task.id}/unlock`, "POST", { agent_id: "holder-agent" }))?.status).toBe(403);

    // Nor may an UNBOUND key without todos:* — same impersonation, one key class down.
    principal = { agent: null, scopes: ["todos:write"] };
    expect((await request(`/v1/tasks/${task.id}/unlock`, "POST", { agent_id: "holder-agent" }))?.status).toBe(403);
    expect((await store.tasks.get(task.id))?.locked_by).toBe("holder-agent");

    // An agent-bound key naming ITSELF is fine and is not a delegation.
    principal = { agent: "holder-agent", scopes: ["todos:write"] };
    expect((await request(`/v1/tasks/${task.id}/unlock`, "POST", { agent_id: "holder-agent" }))?.status).toBe(200);
    expect((await store.tasks.get(task.id))?.locked_by).toBeNull();
  });
});

describe("/v1 git ref path decoding", () => {
  test("round-trips a slash-and-hash ref through the encoded lookup path", async () => {
    const created = await request("/v1/tasks", "POST", { title: "encoded ref" });
    const task = (await created!.json() as { task: { id: string } }).task;
    const name = "hasna/todos#synthetic";
    const linkedRef = {
      id: "synthetic-ref-id",
      task_id: task.id,
      ref_type: "pull_request" as const,
      name,
      url: "https://example.test/hasna/todos/pull/synthetic",
      provider: "github",
      metadata: {},
      created_at: "2026-08-03T00:00:00.000Z",
      updated_at: "2026-08-03T00:00:00.000Z",
    };
    store = {
      ...store,
      gitRefs: {
        add: (input) => ({ ...linkedRef, ...input }),
        list: (taskId) => taskId === task.id ? [linkedRef] : [],
        find: (ref) => ref === name ? [linkedRef] : [],
      },
    };

    const linked = await request(`/v1/tasks/${task.id}/refs`, "POST", {
      ref_type: "pull_request",
      name,
      url: linkedRef.url,
      provider: linkedRef.provider,
    });
    expect(linked?.status).toBe(201);

    const found = await request(`/v1/refs/${encodeURIComponent(name)}`);
    expect(found?.status).toBe(200);
    expect(await found!.json()).toEqual({ refs: [linkedRef], count: 1 });

    const malformed = await request("/v1/refs/%ZZ");
    expect(malformed?.status).toBe(400);
    expect(await malformed!.json()).toEqual({ error: "ref path segment has invalid percent encoding" });
  });
});

describe("/v1 short task reference resolution", () => {
  test("GET /v1/tasks/:ref resolves a unique id-prefix and an exact (case-insensitive) short_id", async () => {
    const created = await request("/v1/tasks", "POST", { title: "resolvable" });
    const { task } = await created!.json() as { task: { id: string } };
    // New tasks are created with a null short_id; the 50k legacy tasks carry one,
    // so seed a legacy-style short_id directly to exercise short_id resolution.
    db.query("UPDATE tasks SET short_id = ? WHERE id = ?").run("OPE2-00125", task.id);

    const byPrefix = await request(`/v1/tasks/${task.id.slice(0, 8)}`);
    expect(byPrefix?.status).toBe(200);
    expect((await byPrefix!.json() as { task: { id: string } }).task.id).toBe(task.id);

    const byShort = await request("/v1/tasks/ope2-00125");
    expect(byShort?.status).toBe(200);
    expect((await byShort!.json() as { task: { id: string } }).task.id).toBe(task.id);

    const byShortExact = await request("/v1/tasks/OPE2-00125");
    expect(byShortExact?.status).toBe(200);
    expect((await byShortExact!.json() as { task: { id: string } }).task.id).toBe(task.id);
  });

  test("GET /v1/tasks/:ref 404s an unknown reference and does not resolve a full-UUID exact miss", async () => {
    expect((await request("/v1/tasks/NOPE-00001"))?.status).toBe(404);
    expect((await request("/v1/tasks/ffffffff-ffff-4fff-8fff-ffffffffffff"))?.status).toBe(404);
  });

  test("GET /v1/tasks/:ref 409s an ambiguous id-prefix", async () => {
    const a = await request("/v1/tasks", "POST", { title: "a" });
    const b = await request("/v1/tasks", "POST", { title: "b" });
    const idA = (await a!.json() as { task: { id: string } }).task.id;
    const idB = (await b!.json() as { task: { id: string } }).task.id;
    // Force two live tasks to share an id prefix so the prefix is ambiguous.
    db.query("UPDATE tasks SET id = ? WHERE id = ?").run("dddddddd-0000-4000-8000-000000000001", idA);
    db.query("UPDATE tasks SET id = ? WHERE id = ?").run("dddddddd-0000-4000-8000-000000000002", idB);
    expect((await request("/v1/tasks/dddddddd"))?.status).toBe(409);
  });

  test("GET /v1/tasks/:ref rejects duplicate project-scoped short IDs with candidate projects", async () => {
    const firstProjectResponse = await request("/v1/projects", "POST", {
      name: "Short ID First",
      path: "/workspace/short-id-first",
    });
    const secondProjectResponse = await request("/v1/projects", "POST", {
      name: "Short ID Second",
      path: "/workspace/short-id-second",
    });
    const firstProject = (await firstProjectResponse!.json() as { project: { id: string } }).project;
    const secondProject = (await secondProjectResponse!.json() as { project: { id: string } }).project;
    const firstTaskResponse = await request("/v1/tasks", "POST", { title: "first", project_id: firstProject.id });
    const secondTaskResponse = await request("/v1/tasks", "POST", { title: "second", project_id: secondProject.id });
    const firstTask = (await firstTaskResponse!.json() as { task: { id: string } }).task;
    const secondTask = (await secondTaskResponse!.json() as { task: { id: string } }).task;

    db.query("UPDATE tasks SET short_id = ?, machine_id = ? WHERE id = ?").run("DUP-00001", "source-one", firstTask.id);
    db.query("UPDATE tasks SET short_id = ?, machine_id = ? WHERE id = ?").run("DUP-00001", "source-two", secondTask.id);

    const response = await request("/v1/tasks/DUP-00001");
    expect(response?.status).toBe(409);
    expect(await response!.json()).toEqual({
      error: expect.stringContaining("Candidate project IDs:"),
      code: "TASK_REFERENCE_AMBIGUOUS",
      candidate_project_ids: [firstProject.id, secondProject.id].sort(),
      candidate_task_ids: [firstTask.id, secondTask.id].sort(),
    });

    // Exact UUID identity is authoritative even while the human label collides.
    const exact = await request(`/v1/tasks/${firstTask.id}`);
    expect(exact?.status).toBe(200);
    expect((await exact!.json() as { task: { id: string } }).task.id).toBe(firstTask.id);
  });
});

describe("/v1/integrity", () => {
  test("GET reports every referential condition from the backing store (SQLite half of the duality gate)", async () => {
    const created = await request("/v1/projects", "POST", { name: "Integrity", path: "/workspace/integrity" });
    const project = (await created!.json() as { project: { id: string } }).project;
    const listResponse = await request("/v1/task-lists", "POST", { name: "Bound list", slug: "bound-list", project_id: project.id });
    const list = (await listResponse!.json() as { task_list: { id: string } }).task_list;
    await request("/v1/tasks", "POST", { title: "healthy", project_id: project.id, task_list_id: list.id });

    const clean = await request("/v1/integrity");
    expect(clean?.status).toBe(200);
    const cleanBody = await clean!.json() as {
      integrity: { schema_version: string; source: string; summary: { ok: boolean; findings: number }; conditions: Array<{ id: string; count: number }> };
    };
    expect(cleanBody.integrity.schema_version).toBe("todos.integrity.v1");
    expect(cleanBody.integrity.summary).toMatchObject({ ok: true, findings: 0 });
    expect(cleanBody.integrity.conditions).toHaveLength(6);

    // An unrouted OPEN task and an unbound list must both surface as findings.
    await request("/v1/tasks", "POST", { title: "unrouted" });
    await request("/v1/task-lists", "POST", { name: "Unbound list", slug: "unbound-list" });

    const dirty = await request("/v1/integrity");
    const dirtyBody = await dirty!.json() as {
      integrity: {
        summary: { ok: boolean; findings: number; rows: number; errors: number; unverified: number };
        conditions: Array<{ id: string; count: number; open_count: number | null; severity: string | null }>;
      };
    };
    const byId = new Map(dirtyBody.integrity.conditions.map((condition) => [condition.id, condition]));
    expect(byId.get("tasks_without_project")).toMatchObject({ count: 1, open_count: 1, severity: "error" });
    expect(byId.get("tasks_without_task_list")).toMatchObject({ count: 1, open_count: 1, severity: "error" });
    expect(byId.get("task_lists_without_project")).toMatchObject({ count: 1, severity: "warn" });
    expect(dirtyBody.integrity.summary).toMatchObject({ ok: false, findings: 3, rows: 3, unverified: 0 });
  });

  test("rejects a write method and 501s a backend that cannot answer it", async () => {
    expect((await request("/v1/integrity", "POST", {}))?.status).toBe(405);

    const withoutIntegrity = { ...store } as typeof store & { integrity?: unknown };
    delete withoutIntegrity.integrity;
    const url = new URL("https://todos.example.test/v1/integrity");
    const response = await handleV1Request(new Request(url), url, { ...dependencies, getStorageAdapter: () => withoutIntegrity });
    expect(response?.status).toBe(501);
    expect(await response!.json()).toMatchObject({ error: expect.stringContaining("not supported") });
  });
});
