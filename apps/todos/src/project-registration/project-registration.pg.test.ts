/**
 * REAL PostgreSQL coverage for bind-existing adoption versus concurrent rename.
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://localhost:5432/todos_reftest \
 *     bun test src/project-registration/project-registration.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTodosCloudQueryClient,
  type TodosCloudQueryClient,
} from "../storage/cloud-client.js";
import { createPostgresTodosStorageAdapter } from "../storage/postgres-adapter.js";
import { postgresTodosSyncSchemaSql } from "../storage/postgres-sync.js";
import type { Project, TaskList } from "../types/index.js";
import {
  createPostgresTodosProjectRegistrationAuthority,
  deriveTodosProjectRegistrationIdempotencyKey,
  digestProjectRegistrationValue,
  postgresTodosProjectRegistrationSchemaSql,
  type TodosProjectRegistrationAuthority,
  type TodosProjectRegistrationCapability,
  type TodosProjectRegistrationRequest,
} from "./index.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SUFFIX = `${process.pid}-${Date.now()}`;
const SERVICE = `todos-registration-race-${SUFFIX}`;
const AUTHORITY_ID = `todos-registration-race-${SUFFIX}`;
const TENANT_ID = `tenant-registration-race-${SUFFIX}`;
const CORPUS_ID = `corpus-registration-race-${SUFFIX}`;
const BOUNDS = {
  response_byte_limit: 65_536,
  time_budget_ms: 5_000,
} as const;

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function projectDigest(project: Project): string {
  return digestProjectRegistrationValue({
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
}

function taskListDigest(taskList: TaskList): string {
  return digestProjectRegistrationValue({
    id: taskList.id,
    project_id: taskList.project_id,
    slug: taskList.slug,
    name: taskList.name,
    description: taskList.description,
    metadata: taskList.metadata,
    created_at: taskList.created_at,
    updated_at: taskList.updated_at,
  });
}

function registrationRequest(
  capability: TodosProjectRegistrationCapability,
  input: {
    operation_id: string;
    step_id: string;
    resource_kind: "project" | "task_list";
    target_selector: string;
    project_id: string;
    project_slug: string;
    project_name: string;
    desired: Record<string, unknown>;
  },
): TodosProjectRegistrationRequest {
  const requestDigest = digestProjectRegistrationValue(input.desired);
  const preconditionDigest = digestProjectRegistrationValue({
    target_selector: input.target_selector,
    expected: "absent_or_matching_existing",
  });
  return {
    ...input,
    direction: "forward",
    authority_route: capability.route,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    idempotency_key: deriveTodosProjectRegistrationIdempotencyKey({
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "forward",
      target_selector: input.target_selector,
      request_digest: requestDigest,
      precondition_digest: preconditionDigest,
    }),
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    bind_existing: true,
    target: null,
    ...BOUNDS,
  };
}

describe.skipIf(!PG_URL)("PostgreSQL project-registration adoption serialization", () => {
  let client: TodosCloudQueryClient;
  let store: ReturnType<typeof createPostgresTodosStorageAdapter>;

  beforeAll(async () => {
    client = createTodosCloudQueryClient(PG_URL!, { max: 4 });
    for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
    for (const sql of postgresTodosProjectRegistrationSchemaSql()) await client.query(sql);
    store = createPostgresTodosStorageAdapter({ client, service: SERVICE });
  });

  afterAll(async () => {
    if (!PG_URL) return;
    // Registration receipts and accepted bindings are deliberately immutable.
    // Every run uses unique authority/scope ids, while its mutable sync records
    // can be cleaned without weakening the production immutability trigger.
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    await client.close();
  });

  function authorityWithGate(
    operationId: string,
    gateEntered: ReturnType<typeof deferred>,
    gateRelease: ReturnType<typeof deferred>,
  ): TodosProjectRegistrationAuthority {
    return createPostgresTodosProjectRegistrationAuthority(client, {
      service: SERVICE,
      packageVersion: "0.15.6-pg-test",
      authorityId: AUTHORITY_ID,
      tenantId: TENANT_ID,
      corpusId: CORPUS_ID,
      async faultInjector(point, context) {
        if (
          point === "before_receipt_write"
          && context.operation_id === operationId
        ) {
          gateEntered.resolve();
          await gateRelease.promise;
        }
      },
    });
  }

  test("project adoption holds the exact candidate row until its accepted receipt commits", async () => {
    const operationId = `postgres-project-adoption-${SUFFIX}`;
    const gateEntered = deferred();
    const gateRelease = deferred();
    const authority = authorityWithGate(operationId, gateEntered, gateRelease);
    const capability = await authority.capability();
    const sourceProjectId = `wks_pgprojectrace${process.pid}`;
    const before = await store.projects.create({
      name: "PostgreSQL adoption project",
      path: `hasna-project://${sourceProjectId}`,
      task_list_id: "todos-postgresql-adoption-project",
    });
    const request = registrationRequest(capability, {
      operation_id: operationId,
      step_id: "todos_project",
      resource_kind: "project",
      target_selector: sourceProjectId,
      project_id: sourceProjectId,
      project_slug: "postgresql-adoption-project",
      project_name: before.name,
      desired: {
        source_project_id: sourceProjectId,
        source_project_slug: "postgresql-adoption-project",
        name: before.name,
      },
    });

    const adoption = authority.create(request);
    await gateEntered.promise;
    let renameSettled = false;
    const rename = store.projects.update(before.id, {
      name: "PostgreSQL renamed project",
    }).finally(() => {
      renameSettled = true;
    });
    await Bun.sleep(50);
    expect(renameSettled).toBe(false);
    gateRelease.resolve();

    const [receipt, renamed] = await Promise.all([adoption, rename]);
    expect(receipt).toMatchObject({
      outcome: "accepted",
      target_id: before.id,
      result_digest: projectDigest(before),
      created_by_operation: false,
    });
    expect(renamed.name).toBe("PostgreSQL renamed project");
    expect((await store.projects.get(before.id))?.name).toBe(renamed.name);
  });

  test("task-list adoption holds the exact candidate row until its accepted receipt commits", async () => {
    const projectAuthority = createPostgresTodosProjectRegistrationAuthority(client, {
      service: SERVICE,
      packageVersion: "0.15.6-pg-test",
      authorityId: AUTHORITY_ID,
      tenantId: TENANT_ID,
      corpusId: CORPUS_ID,
    });
    const capability = await projectAuthority.capability();
    const sourceProjectId = `wks_pglistrace${process.pid}`;
    const project = await store.projects.create({
      name: "PostgreSQL task-list parent",
      path: `hasna-project://${sourceProjectId}`,
      task_list_id: "todos-postgresql-adoption-list",
    });
    await projectAuthority.create(registrationRequest(capability, {
      operation_id: `postgres-list-parent-${SUFFIX}`,
      step_id: "todos_project",
      resource_kind: "project",
      target_selector: sourceProjectId,
      project_id: sourceProjectId,
      project_slug: "postgresql-adoption-list",
      project_name: project.name,
      desired: {
        source_project_id: sourceProjectId,
        source_project_slug: "postgresql-adoption-list",
        name: project.name,
      },
    }));
    const before = await store.taskLists.create({
      name: "PostgreSQL adoption task list",
      slug: "todos-postgresql-adoption-list",
      project_id: project.id,
    });
    const operationId = `postgres-task-list-adoption-${SUFFIX}`;
    const gateEntered = deferred();
    const gateRelease = deferred();
    const authority = authorityWithGate(operationId, gateEntered, gateRelease);
    const request = registrationRequest(capability, {
      operation_id: operationId,
      step_id: "todos_task_list",
      resource_kind: "task_list",
      target_selector: `${project.id}:default`,
      project_id: sourceProjectId,
      project_slug: "postgresql-adoption-list",
      project_name: before.name,
      desired: {
        todos_project_id: project.id,
        source_project_id: sourceProjectId,
        name: before.name,
      },
    });

    const adoption = authority.create(request);
    await gateEntered.promise;
    let renameSettled = false;
    const rename = store.taskLists.update(before.id, {
      name: "PostgreSQL renamed task list",
    }).finally(() => {
      renameSettled = true;
    });
    await Bun.sleep(50);
    expect(renameSettled).toBe(false);
    gateRelease.resolve();

    const [receipt, renamed] = await Promise.all([adoption, rename]);
    expect(receipt).toMatchObject({
      outcome: "accepted",
      target_id: before.id,
      result_digest: taskListDigest(before),
      created_by_operation: false,
    });
    expect(renamed.name).toBe("PostgreSQL renamed task list");
    expect((await store.taskLists.get(before.id))?.name).toBe(renamed.name);
  });
});
