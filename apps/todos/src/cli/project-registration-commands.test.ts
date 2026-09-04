import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlan } from "../db/plans.js";
import { createProject, getProject } from "../db/projects.js";
import { runMigrations } from "../db/schema.js";
import { createTaskList } from "../db/task-lists.js";
import { createTask } from "../db/tasks.js";
import {
  deriveTodosProjectRegistrationIdempotencyKey,
  digestProjectRegistrationValue,
  TodosProjectRegistrationError,
  type TodosProjectRegistrationCapability,
  type TodosProjectRegistrationRequest,
  type TodosProjectResourcePage,
} from "../project-registration/index.js";
import { collectAllProjectResources } from "./commands/project-registration-commands.js";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

type CliResult = { stdout: string; stderr: string; exitCode: number };
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function runCli(
  cwd: string,
  dbPath: string,
  args: string[],
  remote?: { apiUrl: string; apiKey: string },
): Promise<CliResult> {
  const process = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: import.meta.dir + "/../..",
    env: localRoutingTestEnv({
      HOME: join(cwd, "home"),
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_API_URL: remote?.apiUrl,
      HASNA_TODOS_API_KEY: remote?.apiKey,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
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
): Omit<TodosProjectRegistrationRequest, "target"> {
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
    response_byte_limit: 65_536,
    time_budget_ms: 5_000,
  };
}

describe("project-registration CLI", () => {
  test("restarts a complete traversal after the producer reports a collection mutation", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const taskListId = "22222222-2222-4222-8222-222222222222";
    let calls = 0;
    const page = (
      collectionRevision: string,
      resources: TodosProjectResourcePage["resources"],
      nextCursor: string | null,
    ): TodosProjectResourcePage => ({
      authority: "todos",
      route: "todos.project-registration.v1",
      package_version: "test",
      authority_id: "todos",
      tenant_id: "sqlite",
      corpus_id: "todos:sqlite",
      source_project_id: "wks_clirestart000001",
      todos_project_id: projectId,
      task_list_id: taskListId,
      include_anchors: true,
      collection_revision: collectionRevision,
      limit: 1,
      count: resources.length,
      resources,
      has_more: nextCursor !== null,
      next_cursor: nextCursor,
      complete: nextCursor === null,
      truncated: false,
    });
    const projectResource = {
      source_project_id: "wks_clirestart000001",
      kind: "project" as const,
      scope: "collection" as const,
      target_id: projectId,
      parent_id: null,
      revision: "2026-08-11T00:00:00.000Z",
      digest: "a".repeat(64),
    };
    const taskListResource = {
      source_project_id: "wks_clirestart000001",
      kind: "task_list" as const,
      scope: "collection" as const,
      target_id: taskListId,
      parent_id: projectId,
      revision: "2026-08-11T00:00:00.000Z",
      digest: "b".repeat(64),
    };
    const result = await collectAllProjectResources(async (request) => {
      calls += 1;
      if (calls === 1) {
        return page("sha256:" + "1".repeat(64), [projectResource], "old-cursor");
      }
      if (calls === 2) {
        expect(request.cursor).toBe("old-cursor");
        throw new TodosProjectRegistrationError(
          "TODOS_PROJECT_REGISTRATION_COLLECTION_CHANGED",
          "restart",
        );
      }
      if (calls === 3) {
        expect(request.cursor).toBeUndefined();
        return page("sha256:" + "2".repeat(64), [projectResource], "new-cursor");
      }
      expect(request.cursor).toBe("new-cursor");
      return page("sha256:" + "2".repeat(64), [taskListResource], null);
    }, {
      source_project_id: "wks_clirestart000001",
      include_anchors: true,
      limit: 1,
    });
    expect(result).toMatchObject({
      collection_revision: "sha256:" + "2".repeat(64),
      count: 2,
      pages: 2,
      restarts: 1,
      complete: true,
    });
    expect(calls).toBe(4);
  });

  test("accepts an honest page and rejects wrong source or producer completion claims", async () => {
    const request = {
      source_project_id: "wks_clivalidation0001",
      include_anchors: true,
      limit: 1,
    };
    const resource = {
      source_project_id: request.source_project_id,
      kind: "project" as const,
      scope: "collection" as const,
      target_id: "11111111-1111-4111-8111-111111111111",
      parent_id: null,
      revision: "2026-08-11T00:00:00.000Z",
      digest: "a".repeat(64),
    };
    const page: TodosProjectResourcePage = {
      authority: "todos",
      route: "todos.project-registration.v1",
      package_version: "test",
      authority_id: "todos",
      tenant_id: "sqlite",
      corpus_id: "todos:sqlite",
      source_project_id: request.source_project_id,
      todos_project_id: resource.target_id,
      task_list_id: "22222222-2222-4222-8222-222222222222",
      include_anchors: true,
      collection_revision: "sha256:" + "1".repeat(64),
      limit: 1,
      count: 1,
      resources: [resource],
      has_more: false,
      next_cursor: null,
      complete: true,
      truncated: false,
    };

    await expect(collectAllProjectResources(async () => page, request)).resolves.toMatchObject({
      source_project_id: request.source_project_id,
      count: 1,
      pages: 1,
      complete: true,
      truncated: false,
    });
    await expect(collectAllProjectResources(
      async () => ({ ...page, source_project_id: "wks_wrongidentity0001" }),
      request,
    )).rejects.toThrow("a page bound to a different request or authority identity");
    await expect(collectAllProjectResources(
      async () => ({
        ...page,
        resources: [{ ...resource, source_project_id: "wks_wrongresource0001" }],
      }),
      request,
    )).rejects.toThrow("a resource bound to a different source");
    await expect(collectAllProjectResources(
      async () => ({ ...page, count: 0 }),
      request,
    )).rejects.toThrow("an inconsistent resource count");
    await expect(collectAllProjectResources(
      async () => ({
        ...page,
        complete: false,
        truncated: true,
      } as unknown as TodosProjectResourcePage),
      request,
    )).rejects.toThrow("inconsistent completion or cursor flags");
    await expect(collectAllProjectResources(
      async () => ({
        ...page,
        has_more: true,
        next_cursor: null,
        complete: false,
      }),
      request,
    )).rejects.toThrow("inconsistent completion or cursor flags");

    let pageNumber = 0;
    await expect(collectAllProjectResources(async () => {
      pageNumber += 1;
      if (pageNumber === 1) {
        return {
          ...page,
          has_more: true,
          next_cursor: "cursor-1",
          complete: false,
        };
      }
      return {
        ...page,
        tenant_id: "different-tenant",
        resources: [{
          ...resource,
          kind: "task" as const,
          target_id: "33333333-3333-4333-8333-333333333333",
        }],
      };
    }, request)).rejects.toThrow("an authority identity change during pagination");
  });

  test("binds existing UUIDs and exhausts producer pages without duplicates", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-project-registration-cli-"));
    roots.push(root);
    mkdirSync(join(root, "home"));
    const dbPath = join(root, "todos.db");
    const db = new Database(dbPath);
    runMigrations(db);
    const sourceProjectId = "wks_projectresources1";
    const project = createProject({
      name: "Project resources CLI",
      path: `hasna-project://${sourceProjectId}`,
      task_list_id: "todos-project-resources-cli",
    }, db);
    const taskList = createTaskList({
      name: "Project resources CLI",
      slug: "todos-project-resources-cli",
      project_id: project.id,
    }, db);
    const plans = Array.from({ length: 2 }, (_, index) => createPlan({
      name: `CLI plan ${index}`,
      project_id: project.id,
    }, db));
    const tasks = Array.from({ length: 3 }, (_, index) => createTask({
      title: `CLI task ${index}`,
      project_id: project.id,
      plan_id: plans[index % plans.length]!.id,
    }, db));
    db.close();

    const capabilityResult = await runCli(
      root,
      dbPath,
      ["--json", "project-registration", "capability"],
    );
    expect(capabilityResult.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(capabilityResult.stderr).not.toContain('"event":"todos-local-fallback"');
    const capability = JSON.parse(capabilityResult.stdout)
      .capability as TodosProjectRegistrationCapability;
    expect(capability).toMatchObject({
      bind_existing_adoption: true,
      prior_registration_adoption_validation: true,
      project_resource_enumeration: true,
      project_resource_page_limit: 500,
    });

    const projectRequestPath = join(root, "project-request.json");
    writeFileSync(projectRequestPath, JSON.stringify(registrationRequest(capability, {
      operation_id: "project-resources-cli-project",
      step_id: "todos_project",
      resource_kind: "project",
      target_selector: sourceProjectId,
      project_id: sourceProjectId,
      project_slug: "project-resources-cli",
      project_name: "Project resources CLI",
      desired: {
        source_project_id: sourceProjectId,
        source_project_slug: "project-resources-cli",
        name: "Project resources CLI",
      },
    })));
    const projectBind = await runCli(
      root,
      dbPath,
      ["--json", "project-registration", "create", "--file", projectRequestPath],
    );
    expect(projectBind.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(projectBind.stderr).not.toContain('"event":"todos-local-fallback"');
    const projectBindingReceipt = JSON.parse(projectBind.stdout).receipt;
    expect(projectBindingReceipt).toMatchObject({
      outcome: "accepted",
      target_id: project.id,
      created_by_operation: false,
    });
    const validationDb = new Database(dbPath);
    const validationPath = join(root, "prior-adoption-validation.json");
    writeFileSync(validationPath, JSON.stringify({
      source_request: JSON.parse(readFileSync(projectRequestPath, "utf8")),
      source_receipt: projectBindingReceipt,
      current_record: getProject(project.id, validationDb),
    }));
    validationDb.close();
    const validationResult = await runCli(
      root,
      dbPath,
      [
        "--json",
        "project-registration",
        "validate-prior-adoption",
        "--file",
        validationPath,
      ],
    );
    expect(validationResult.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(validationResult.stderr).not.toContain('"event":"todos-local-fallback"');
    expect(JSON.parse(validationResult.stdout).validation).toMatchObject({
      valid: true,
      source_receipt_id: projectBindingReceipt.receipt_id,
      accepted_receipt_id: projectBindingReceipt.receipt_id,
      target_id: project.id,
    });

    const taskListRequestPath = join(root, "task-list-request.json");
    writeFileSync(taskListRequestPath, JSON.stringify(registrationRequest(capability, {
      operation_id: "project-resources-cli-task-list",
      step_id: "todos_task_list",
      resource_kind: "task_list",
      target_selector: `${project.id}:default`,
      project_id: sourceProjectId,
      project_slug: "project-resources-cli",
      project_name: "Project resources CLI",
      desired: {
        todos_project_id: project.id,
        source_project_id: sourceProjectId,
        name: "Project resources CLI",
      },
    })));
    const taskListBind = await runCli(
      root,
      dbPath,
      ["--json", "project-registration", "create", "--file", taskListRequestPath],
    );
    expect(taskListBind.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(taskListBind.stderr).not.toContain('"event":"todos-local-fallback"');
    expect(JSON.parse(taskListBind.stdout).receipt).toMatchObject({
      outcome: "accepted",
      target_id: taskList.id,
      created_by_operation: false,
    });

    const listed = await runCli(root, dbPath, [
      "--json",
      "project-resources",
      sourceProjectId,
      "--anchors",
      "--limit",
      "2",
      "--all",
    ]);
    expect(listed.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(listed.stderr).not.toContain('"event":"todos-local-fallback"');
    const result = JSON.parse(listed.stdout);
    expect(result).toMatchObject({
      source_project_id: sourceProjectId,
      todos_project_id: project.id,
      task_list_id: taskList.id,
      count: 7,
      pages: 4,
      restarts: 0,
      collection_revision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      complete: true,
      truncated: false,
    });
    const keys = result.resources.map(
      (resource: { kind: string; target_id: string }) =>
        `${resource.kind}:${resource.target_id}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(result.resources.map(
      (resource: { target_id: string }) => resource.target_id,
    ))).toEqual(new Set([
      project.id,
      taskList.id,
      ...plans.map((plan) => plan.id),
      ...tasks.map((task) => task.id),
    ]));
  }, 30_000);

  test("remote prior-adoption CLI exits nonzero for false, negative, malformed, and forged validation proof", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-project-registration-cli-remote-validation-"));
    roots.push(root);
    const inputPath = join(root, "prior-adoption-validation.json");
    const targetId = "11111111-1111-4111-8111-111111111111";
    const createdAt = "2026-08-12T09:00:00.000Z";
    const resultDigest = "c".repeat(64);
    const sourceRequest = {
      operation_id: "project-resources-cli-remote-validation-0001",
      step_id: "todos_project",
      resource_kind: "project",
      direction: "forward",
      authority_route: "todos.project-registration.v1",
      package_version: "0.15.30-test",
      authority_id: "todos",
      tenant_id: "tenant-test",
      corpus_id: "todos:tenant-test",
      target_selector: "wks_cliremotevalidation01",
      idempotency_key: `prk_${"7".repeat(48)}`,
      request_digest: "a".repeat(64),
      precondition_digest: "b".repeat(64),
      project_id: "wks_cliremotevalidation01",
      project_slug: "cli-remote-validation",
      project_name: "CLI remote validation",
      desired: {},
      bind_existing: true,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    } as const;
    const sourceReceipt = {
      receipt_id: "tpr_cli_remote_validation",
      authority: "todos",
      route: "todos.project-registration.v1",
      package_version: sourceRequest.package_version,
      authority_id: sourceRequest.authority_id,
      tenant_id: sourceRequest.tenant_id,
      corpus_id: sourceRequest.corpus_id,
      operation_id: sourceRequest.operation_id,
      step_id: sourceRequest.step_id,
      resource_kind: sourceRequest.resource_kind,
      direction: sourceRequest.direction,
      idempotency_key: sourceRequest.idempotency_key,
      request_digest: sourceRequest.request_digest,
      precondition_digest: sourceRequest.precondition_digest,
      outcome: "accepted",
      reason: null,
      target_id: targetId,
      result_revision: createdAt,
      result_digest: resultDigest,
      duplicate_of_receipt_id: null,
      accepted_receipt_id: null,
      created_by_operation: false,
      created_at: createdAt,
    } as const;
    const currentRecord = {
      id: targetId,
      name: sourceRequest.project_name,
      path: `hasna-project://${sourceRequest.project_id}`,
      description: null,
      task_list_id: "todos-cli-remote-validation",
      task_prefix: "CLI",
      task_counter: 0,
      created_at: createdAt,
      updated_at: createdAt,
      machine_id: null,
    };
    const validation = {
      valid: true,
      resource_kind: "project",
      target_id: targetId,
      source_receipt_id: sourceReceipt.receipt_id,
      accepted_receipt_id: sourceReceipt.receipt_id,
      source_outcome: "accepted",
      created_at: currentRecord.created_at,
      current_revision: currentRecord.updated_at,
      accepted_result_digest: sourceReceipt.result_digest,
    } as const;
    writeFileSync(inputPath, JSON.stringify({
      source_request: sourceRequest,
      source_receipt: sourceReceipt,
      current_record: currentRecord,
    }));
    let responseBody: unknown = { validation };
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(new URL(request.url).pathname)
          .toBe("/v1/project-registration/validate-prior-adoption");
        return Response.json(responseBody);
      },
    });
    const remote = {
      apiUrl: `http://127.0.0.1:${server.port}`,
      apiKey: "[REDACTED_SECRET]",
    };
    try {
      const honest = await runCli(
        root,
        join(root, "unused-local.db"),
        ["--json", "project-registration", "validate-prior-adoption", "--file", inputPath],
        remote,
      );
      expect({ exitCode: honest.exitCode, stderr: honest.stderr }).toEqual({
        exitCode: 0,
        stderr: "",
      });
      expect(JSON.parse(honest.stdout)).toEqual({ validation });

      for (const body of [
        false,
        { validation: false },
        { validation: { valid: false } },
        { validation: { valid: true } },
        { validation: { ...validation, source_receipt_id: "tpr_forged" } },
      ]) {
        responseBody = body;
        const rejected = await runCli(
          root,
          join(root, "unused-local.db"),
          ["--json", "project-registration", "validate-prior-adoption", "--file", inputPath],
          remote,
        );
        expect(rejected.exitCode).not.toBe(0);
        expect(`${rejected.stdout}\n${rejected.stderr}`).toContain(
          "REMOTE_API_INCOMPATIBLE",
        );
      }
    } finally {
      server.stop(true);
    }
  }, 30_000);
});
