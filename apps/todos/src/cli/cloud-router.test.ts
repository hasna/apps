import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planProjectLinkReceiptId,
  planProjectLinkResultDigest,
  planProjectLinkRollbackReceiptId,
} from "../lib/plan-project-link-contract.js";
import type {
  TodosPriorRegistrationAdoptionValidationRequest,
  TodosProjectResourcePage,
} from "../project-registration/index.js";
import type { Plan, PlanProjectLinkReceipt, Project, Task } from "../types/index.js";
import {
  getTodosCloudClient,
  getTodosRemoteAuthorityConfigStatus,
  resolveTodosCliTransport,
  isCloudRouting,
  resetTodosCloudClient,
  resetTodosLocalFallbackNotice,
  cloudListTasks,
  cloudGetTask,
  cloudCreateTask,
  cloudUpdateTask,
  cloudDeleteTask,
  cloudTaskAction,
  cloudFailTask,
  cloudCompleteTask,
  cloudAddComment,
  cloudListComments,
  cloudRegisterAgent,
  cloudLockTask,
  cloudUnlockTask,
  cloudHandoffStaleTaskLock,
  cloudAddDependency,
  cloudRemoveDependency,
  cloudGetDependencies,
  cloudRecordVerification,
  cloudActiveWork,
  cloudStaleTasks,
  cloudOverdueTasks,
  cloudEscalatedTasks,
  cloudChangedSince,
  cloudTaskStats,
  cloudCountTasks,
  cloudRecentActivity,
  cloudListProjects,
  cloudListTaskLists,
  cloudNextTask,
  cloudAllDependencies,
  cloudBlockingDepsMap,
  cloudRecap,
  cloudTimeline,
  cloudCreateTaskList,
  cloudDeleteTaskList,
  cloudPlanProjectTaskListEnsure,
  cloudApplyProjectTaskListEnsure,
  cloudRollbackProjectTaskListEnsure,
  cloudPlanPlanProjectLink,
  cloudApplyPlanProjectLink,
  cloudRollbackPlanProjectLink,
  cloudResolveProjectRef,
  cloudRenameProject,
  cloudResolvePlan,
  cloudResolveTaskListForUpdate,
  cloudResolveTaskListRef,
  cloudResolveTaskRef,
  cloudListProjectResources,
  cloudValidatePriorRegistrationAdoption,
  requireTodosRemoteAuthorityEnv,
} from "./cloud-router.js";

const CLOUD_ENV = {
  HASNA_TODOS_API_URL: "https://todos.example.com",
  HASNA_TODOS_API_KEY: "hasna_todos_test_key",
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown; redirect?: RequestRedirect };

let previousFetch: typeof globalThis.fetch | undefined;

function installFetch(handler: (call: Call) => { status?: number; body?: unknown }): Call[] {
  previousFetch ??= globalThis.fetch;
  const calls: Call[] = [];
  (globalThis as any).fetch = async (input: any, init: any = {}) => {
    const headers: Record<string, string> = {};
    const h = new Headers(init.headers);
    h.forEach((v, k) => (headers[k] = v));
    const call: Call = {
      url: String(input),
      method: (init.method || "GET").toUpperCase(),
      headers,
      body: init.body ? JSON.parse(init.body) : undefined,
      redirect: init.redirect,
    };
    calls.push(call);
    const { status = 200, body = {} } = handler(call);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return calls;
}

function createdByOpenApi(supported: boolean): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    components: {
      schemas: {
        CreateTaskInput: {
          type: "object",
          properties: supported ? { created_by: { type: "string" } } : {},
        },
        Task: {
          type: "object",
          properties: supported
            ? { created_by: { type: "string", nullable: true } }
            : {},
        },
      },
    },
  };
}

function planProjectLinkPlanFixture(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    slug: "dubai-fraud",
    project_id: null,
    task_list_id: null,
    agent_id: null,
    name: "Dubai Fraud",
    description: null,
    status: "active",
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function planProjectLinkProjectFixture(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Dubai Fraud",
    path: "/workspace/dubai-fraud",
    description: null,
    task_list_id: null,
    task_prefix: null,
    task_counter: 0,
    created_at: "2026-08-08T00:00:01.000Z",
    updated_at: "2026-08-08T00:00:01.000Z",
    ...overrides,
  };
}

function planProjectLinkTaskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    short_id: "dubai-1",
    project_id: null,
    parent_id: null,
    plan_id: "plan-1",
    task_list_id: null,
    title: "Investigate Dubai fraud",
    description: null,
    status: "pending",
    priority: "medium",
    agent_id: null,
    assigned_to: null,
    session_id: null,
    working_dir: null,
    tags: [],
    metadata: {},
    version: 1,
    locked_by: null,
    locked_at: null,
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
    started_at: null,
    completed_at: null,
    due_at: null,
    estimated_minutes: null,
    actual_minutes: null,
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    recurrence_rule: null,
    recurrence_parent_id: null,
    spawns_template_id: null,
    confidence: null,
    reason: null,
    spawned_from_session: null,
    assigned_by: null,
    created_by: null,
    assigned_from_project: null,
    task_type: null,
    cost_tokens: 0,
    cost_usd: 0,
    delegated_from: null,
    delegation_depth: 0,
    retry_count: 0,
    max_retries: 3,
    retry_after: null,
    sla_minutes: null,
    runner_id: null,
    runner_started_at: null,
    runner_completed_at: null,
    current_step: null,
    total_steps: null,
    ...overrides,
  };
}

function planProjectLinkReceiptFixture(
  plan: Plan,
  tasks: Task[],
  overrides: Partial<PlanProjectLinkReceipt> = {},
): PlanProjectLinkReceipt {
  const idempotencyKey = overrides.idempotency_key ?? "link-fixture";
  return {
    schema_version: "todos.plan-project-link.v1",
    receipt_id: planProjectLinkReceiptId(idempotencyKey),
    idempotency_key: idempotencyKey,
    plan_id: plan.id,
    project_id: plan.project_id!,
    prior_plan_project_id: null,
    prior_task_project_ids: Object.fromEntries(tasks.map((task) => [task.id, null])),
    task_ids: tasks.map((task) => task.id),
    task_count: tasks.length,
    result_plan_revision: plan.updated_at,
    result_digest: planProjectLinkResultDigest(plan, tasks),
    rollback_supported: true,
    created_at: "2026-08-08T00:00:02.000Z",
    ...overrides,
  };
}

function projectResourcePageFixture(
  overrides: Partial<TodosProjectResourcePage> = {},
): TodosProjectResourcePage {
  const sourceProjectId = "wks_cloudresources0001";
  return {
    authority: "todos",
    route: "todos.project-registration.v1",
    package_version: "0.15.30-test",
    authority_id: "todos",
    tenant_id: "tenant-test",
    corpus_id: "todos:tenant-test",
    source_project_id: sourceProjectId,
    todos_project_id: "11111111-1111-4111-8111-111111111111",
    task_list_id: "22222222-2222-4222-8222-222222222222",
    include_anchors: true,
    collection_revision: "sha256:" + "a".repeat(64),
    limit: 1,
    count: 1,
    resources: [{
      source_project_id: sourceProjectId,
      kind: "project",
      scope: "collection",
      target_id: "11111111-1111-4111-8111-111111111111",
      parent_id: null,
      revision: "2026-08-11T00:00:00.000Z",
      digest: "b".repeat(64),
    }],
    has_more: false,
    next_cursor: null,
    complete: true,
    truncated: false,
    ...overrides,
  };
}

afterEach(() => {
  if (previousFetch) {
    globalThis.fetch = previousFetch;
    previousFetch = undefined;
  }
  resetTodosCloudClient();
});

describe("todos client transport resolver (API pair, no storage modes)", () => {
  test("no env -> local (null client, isCloudRouting false)", () => {
    expect(getTodosCloudClient({})).toBeNull();
    expect(isCloudRouting({})).toBe(false);
  });

  test("API_URL + API_KEY -> cloud-http client at /v1", () => {
    const client = getTodosCloudClient(CLOUD_ENV);
    expect(client).not.toBeNull();
    expect(client!.baseUrl).toBe("https://todos.example.com/v1");
    expect(isCloudRouting(CLOUD_ENV)).toBe(true);
  });

  test("URL + KEY without any mode variable selects http (owner deprecation)", () => {
    // The regression that shipped with the removal: the API pair is now the
    // SOLE selector — a bare URL+KEY must never silently stay local.
    const pairOnly = { HASNA_TODOS_API_URL: "https://todos.example.com", HASNA_TODOS_API_KEY: "k" } as never;
    expect(getTodosCloudClient(pairOnly)).not.toBeNull();
    expect(isCloudRouting(pairOnly)).toBe(true);
  });

  test("env silent + fleet-env file selects http and reports the file PATH as the source (release-review P1)", () => {
    // The `machines flip` file is a first-class tier: a flipped machine in a
    // non-interactive shell resolves from ~/.hasna/fleet-env/todos.env and the
    // provenance gates verify the reported path.
    const home = mkdtempSync(join(tmpdir(), "todos-fleetenv-"));
    const envDir = join(home, ".hasna", "fleet-env");
    mkdirSync(envDir, { recursive: true });
    writeFileSync(
      join(envDir, "todos.env"),
      "HASNA_TODOS_API_URL=https://todos.example.com\nHASNA_TODOS_API_KEY=fixture-key\n",
    );
    try {
      const resolution = resolveTodosCliTransport({ HOME: home });
      expect(resolution.transport).toBe("http");
      expect(resolution.selected).toBe(true);
      expect(resolution.source).toBe("fleet-env");
      expect(resolution.apiUrlSource).toBe(join(envDir, "todos.env"));
      expect(resolution.apiKeySource).toBe(join(envDir, "todos.env"));
      const status = getTodosRemoteAuthorityConfigStatus({ HOME: home });
      expect(status.transport).toBe("http");
      expect(status.api_url_source).toBe(join(envDir, "todos.env"));
      expect(status.api_key_source).toBe(join(envDir, "todos.env"));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("retired storage-mode variables are inert: never read, never selected", () => {
    // The removal is complete: the mode vocabulary is not read at all. A stale
    // variable neither selects a transport nor throws — the API env pair is
    // the sole selector.
    const withPair = {
      HASNA_TODOS_STORAGE_MODE: "cloud",
      HASNA_TODOS_API_URL: "https://todos.example.com",
      HASNA_TODOS_API_KEY: "hasna_todos_test_key",
    } as never;
    expect(getTodosCloudClient(withPair)).not.toBeNull();
    expect(isCloudRouting(withPair)).toBe(true);
    expect(resolveTodosCliTransport({ HASNA_TODOS_STORAGE_MODE: "remtoe" }).transport).toBe("sqlite");
    expect(resolveTodosCliTransport({
      HASNA_TODOS_STORAGE_MODE: "local",
      TODOS_STORAGE_MODE: "remote",
    }).transport).toBe("sqlite");
  });

  test("KEY without URL refuses with the missing variable named, without local fallback", () => {
    expect(() => getTodosCloudClient({
      HASNA_TODOS_API_KEY: "fixture-key",
      TODOS_URL: "https://todos.md",
    } as never)).toThrow(
      "REMOTE_API_URL_MISSING: remote Todos storage requires HASNA_TODOS_API_URL",
    );
  });

  test("URL without KEY reports the exact missing API key without local fallback", () => {
    expect(() =>
      getTodosCloudClient({ HASNA_TODOS_API_URL: "https://todos.example.com" }),
    ).toThrow(
      "REMOTE_API_KEY_MISSING: remote Todos storage requires HASNA_TODOS_API_KEY",
    );
  });

  test("a blank retired storage-mode variable is inert too", () => {
    expect(resolveTodosCliTransport({ HASNA_TODOS_STORAGE_MODE: "   " }).transport).toBe("sqlite");
    expect(resolveTodosCliTransport({ HASNA_TODOS_MODE: "" }).transport).toBe("sqlite");
  });

  test.each([
    "https://fixture-user@todos.example",
    "https://todos.example?route=v1",
    "https://todos.example#v1",
    "https://todos.example/api/v1",
    "https://todos.example/custom",
    "http://todos.example",
  ])("rejects ambiguous or credential-unsafe authority URL %s", (apiUrl) => {
    expect(() => getTodosCloudClient({
      HASNA_TODOS_API_URL: apiUrl,
      HASNA_TODOS_API_KEY: "fixture-key",
    })).toThrow("REMOTE_API_URL_INVALID");
  });

  test("accepts exact /v1 and loopback HTTP without duplicating the route prefix", () => {
    const status = getTodosRemoteAuthorityConfigStatus({
      HASNA_TODOS_API_URL: "http://127.0.0.1:18881/v1",
      HASNA_TODOS_API_KEY: "fixture-key",
    });
    expect(status).toMatchObject({ ok: true, v1_base_url: "http://127.0.0.1:18881/v1" });
  });

  test("never reuses a client across authority, mode, or API-key changes", async () => {
    const calls = installFetch(() => ({ body: { projects: [], count: 0 } }));
    const authorityA = getTodosCloudClient({
      HASNA_TODOS_API_URL: "https://authority-a.example",
      HASNA_TODOS_API_KEY: "fixture-key-a",
    })!;
    const authorityB = getTodosCloudClient({
      HASNA_TODOS_API_URL: "https://authority-b.example",
      HASNA_TODOS_API_KEY: "fixture-key-b",
    })!;
    expect(authorityA.baseUrl).toBe("https://authority-a.example/v1");
    expect(authorityB.baseUrl).toBe("https://authority-b.example/v1");
    expect(getTodosCloudClient({})).toBeNull();
    const authorityAWithNewKey = getTodosCloudClient({
      HASNA_TODOS_API_URL: "https://authority-a.example",
      HASNA_TODOS_API_KEY: "fixture-key-a-rotated",
    })!;

    await cloudListProjects(authorityA);
    await cloudListProjects(authorityB);
    await cloudListProjects(authorityAWithNewKey);
    expect(calls.map((call) => [call.url, call.headers["authorization"]])).toEqual([
      ["https://authority-a.example/v1/projects", "Bearer fixture-key-a"],
      ["https://authority-b.example/v1/projects", "Bearer fixture-key-b"],
      ["https://authority-a.example/v1/projects", "Bearer fixture-key-a-rotated"],
    ]);

    expect(getTodosCloudClient({})).toBeNull();
    expect(getTodosCloudClient(CLOUD_ENV)?.baseUrl).toBe("https://todos.example.com/v1");
  });
});

describe("remote authority compatibility diagnostics", () => {
  test("routes prior-registration adoption validation through the exact fail-closed HTTP endpoint", async () => {
    const input = {
      source_request: {
        operation_id: "cloud-prior-adoption-0001",
        step_id: "todos_project",
        resource_kind: "project",
        direction: "forward",
        authority_route: "todos.project-registration.v1",
        package_version: "0.15.30-test",
        authority_id: "todos",
        tenant_id: "tenant-test",
        corpus_id: "todos:tenant-test",
        target_selector: "wks_cloudprioradoption01",
        idempotency_key: "prk_cloud_prior_adoption",
        request_digest: "a".repeat(64),
        precondition_digest: "b".repeat(64),
        project_id: "wks_cloudprioradoption01",
        project_slug: "cloud-prior-adoption",
        project_name: "Cloud prior adoption",
        desired: {},
        bind_existing: true,
        response_byte_limit: 65_536,
        time_budget_ms: 5_000,
      },
      source_receipt: {
        receipt_id: "tpr_cloud_prior_adoption",
        authority: "todos",
        route: "todos.project-registration.v1",
        package_version: "0.15.30-test",
        authority_id: "todos",
        tenant_id: "tenant-test",
        corpus_id: "todos:tenant-test",
        operation_id: "cloud-prior-adoption-0001",
        step_id: "todos_project",
        resource_kind: "project",
        direction: "forward",
        idempotency_key: "prk_cloud_prior_adoption",
        request_digest: "a".repeat(64),
        precondition_digest: "b".repeat(64),
        outcome: "accepted",
        reason: null,
        target_id: "11111111-1111-4111-8111-111111111111",
        result_revision: "2026-08-11T00:00:00.000Z",
        result_digest: "c".repeat(64),
        duplicate_of_receipt_id: null,
        accepted_receipt_id: null,
        created_by_operation: false,
        created_at: "2026-08-11T00:00:00.000Z",
      },
      current_record: planProjectLinkProjectFixture({
        id: "11111111-1111-4111-8111-111111111111",
        created_at: "2026-08-11T00:00:00.000Z",
        updated_at: "2026-08-11T00:00:00.000Z",
      }),
    } satisfies TodosPriorRegistrationAdoptionValidationRequest;
    const validation = {
      valid: true,
      resource_kind: "project",
      target_id: input.current_record.id,
      source_receipt_id: input.source_receipt.receipt_id,
      accepted_receipt_id: input.source_receipt.receipt_id,
      source_outcome: "accepted",
      created_at: input.current_record.created_at,
      current_revision: input.current_record.updated_at,
      accepted_result_digest: input.source_receipt.result_digest!,
    } as const;
    const calls = installFetch(() => ({ body: { validation } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudValidatePriorRegistrationAdoption(client, input))
      .resolves.toEqual(validation);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://todos.example.com/v1/project-registration/validate-prior-adoption",
      body: input,
    });

    installFetch(() => ({ body: { valid: true } }));
    await expect(cloudValidatePriorRegistrationAdoption(
      getTodosCloudClient(CLOUD_ENV)!,
      input,
    )).rejects.toThrow(
      "REMOTE_API_INCOMPATIBLE: /v1/project-registration/validate-prior-adoption",
    );

    for (const body of [
      false,
      { validation: false },
      { validation: { valid: false } },
      { validation: { valid: true } },
      { validation: { ...validation, target_id: "22222222-2222-4222-8222-222222222222" } },
      { validation: { ...validation, accepted_result_digest: "0".repeat(64) } },
    ]) {
      installFetch(() => ({ body }));
      await expect(cloudValidatePriorRegistrationAdoption(
        getTodosCloudClient(CLOUD_ENV)!,
        input,
      )).rejects.toThrow(
        "REMOTE_API_INCOMPATIBLE: /v1/project-registration/validate-prior-adoption",
      );
    }
  });

  test("accepts an honest project-resource page bound to the request", async () => {
    const page = projectResourcePageFixture();
    const calls = installFetch(() => ({ body: { page } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudListProjectResources(client, {
      source_project_id: page.source_project_id,
      include_anchors: true,
      limit: 1,
    })).resolves.toEqual(page);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://todos.example.com/v1/project-registration/resources?source_project_id=wks_cloudresources0001&limit=1&include_anchors=true",
    ]);
  });

  test("rejects wrong-identity and truncated project-resource pages at the HTTP boundary", async () => {
    const request = {
      source_project_id: "wks_cloudresources0001",
      include_anchors: true,
      limit: 1,
    };
    installFetch(() => ({
      body: {
        page: projectResourcePageFixture({
          source_project_id: "wks_differentproject01",
        }),
      },
    }));
    const wrongIdentityClient = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudListProjectResources(wrongIdentityClient, request)).rejects.toThrow(
      "REMOTE_API_INCOMPATIBLE: /v1/project-registration/resources returned an invalid project-resource page",
    );

    installFetch(() => ({
      body: {
        page: {
          ...projectResourcePageFixture(),
          complete: false,
          truncated: true,
        },
      },
    }));
    const truncatedClient = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudListProjectResources(truncatedClient, request)).rejects.toThrow(
      "REMOTE_API_INCOMPATIBLE: /v1/project-registration/resources returned an invalid project-resource page",
    );
  });

  test("does not treat a health-only platform host as a Todos /v1 CRUD authority", async () => {
    const calls = installFetch((call) => {
      if (call.url === "https://todos.md/v1/projects") {
        return { status: 404, body: { error: "not found" } };
      }
      return { status: 200, body: { status: "ok", service: "platform-todos", mode: "oss" } };
    });
    const client = getTodosCloudClient({
      HASNA_TODOS_API_URL: "https://todos.md",
      HASNA_TODOS_API_KEY: "fixture-key",
    } as never)!;

    await expect(cloudListProjects(client)).rejects.toThrow(
      "REMOTE_API_INCOMPATIBLE: configured Todos authority https://todos.md does not expose /v1/projects",
    );
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://todos.md/v1/projects",
    ]);
  });

  test.each([
    [401, "REMOTE_API_UNAUTHORIZED"],
    [403, "REMOTE_API_FORBIDDEN"],
    [503, "REMOTE_API_UNAVAILABLE"],
  ])("classifies HTTP %i without local fallback", async (status, expected) => {
    installFetch(() => ({ status, body: { error: "fixture rejection" } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudListProjects(client)).rejects.toThrow(expected);
  });

  test("rejects redirects before fetch can forward authentication", async () => {
    const calls = installFetch(() => ({ status: 302, body: { redirect: true } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudListProjects(client)).rejects.toThrow("REMOTE_API_REDIRECT_REJECTED");
    expect(calls[0]!.redirect).toBe("manual");
  });

  test("classifies timeout-like transport failures", async () => {
    previousFetch ??= globalThis.fetch;
    globalThis.fetch = async () => {
      throw new DOMException("fixture timed out", "AbortError");
    };
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudListProjects(client)).rejects.toThrow("REMOTE_API_TIMEOUT");
  });

  test("a /tasks timeout names the unbounded-read class, not API-down (task 5e5ed4d1)", async () => {
    previousFetch ??= globalThis.fetch;
    globalThis.fetch = async () => {
      throw new DOMException("fixture timed out", "AbortError");
    };
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudListTasks(client, { status: "pending" })).rejects.toThrow(/UNBOUNDED task read/);
    await expect(cloudListTasks(client, { status: "pending" })).rejects.toThrow("REMOTE_API_TIMEOUT");
    // The note is scoped to the task-list route; other routes keep the bare message.
    await expect(cloudListProjects(client)).rejects.toThrow("REMOTE_API_TIMEOUT");
    await expect(cloudListProjects(client)).rejects.not.toThrow(/UNBOUNDED task read/);
  });

  // Regression for task 9b050845: `todos count` on a stalled /tasks endpoint
  // hung past 120s and then reported REMOTE_API_UNREACHABLE, while the host was
  // reachable (curl connected in 0.18s). A slow authority must fail within the
  // bounded request timeout and report REMOTE_API_TIMEOUT (slow), never the
  // multi-minute hang followed by REMOTE_API_UNREACHABLE (down).
  describe("bounded remote request timeout (task 9b050845)", () => {
    const STALL_BOUND_MS = 200;

    async function runStalledCloudListTasks(
      fetchImpl: () => Promise<Response>,
    ): Promise<{ error: unknown; elapsedMs: number }> {
      previousFetch ??= globalThis.fetch;
      globalThis.fetch = fetchImpl as unknown as typeof globalThis.fetch;
      const client = getTodosCloudClient(CLOUD_ENV, STALL_BOUND_MS)!;
      const started = Date.now();
      let error: unknown;
      try {
        await cloudListTasks(client);
      } catch (e) {
        error = e;
      }
      return { error, elapsedMs: Date.now() - started };
    }

    test("a /tasks response that never completes fails within the bound with REMOTE_API_TIMEOUT, not REMOTE_API_UNREACHABLE", async () => {
      // The measured stall shape: the authority accepts the connection and
      // never answers. The fake fetch never settles, so only a bounded
      // request deadline can terminate the call.
      const { error, elapsedMs } = await runStalledCloudListTasks(
        () => new Promise<Response>(() => {}),
      );
      expect(String(error)).toContain("REMOTE_API_TIMEOUT");
      expect(String(error)).not.toContain("REMOTE_API_UNREACHABLE");
      // The bound fired (not an instant error)...
      expect(elapsedMs).toBeGreaterThanOrEqual(STALL_BOUND_MS - 100);
      // ...and exactly once: a retried timeout would take ~3x the bound plus
      // backoff, the multi-minute hang the census measured.
      expect(elapsedMs).toBeLessThan(STALL_BOUND_MS * 3);
    });

    test("a response that sends headers then never completes its body is bounded the same way", async () => {
      const { error, elapsedMs } = await runStalledCloudListTasks(
        () =>
          Promise.resolve(
            new Response(new ReadableStream({ start() {} }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          ),
      );
      expect(String(error)).toContain("REMOTE_API_TIMEOUT");
      expect(String(error)).not.toContain("REMOTE_API_UNREACHABLE");
      expect(elapsedMs).toBeLessThan(STALL_BOUND_MS * 3);
    });
  });
});

describe("cloud task CRUD maps /v1 envelopes and carries the bearer key", () => {
  test("full task UUID resolution remains a direct zero-request fast path", async () => {
    const calls = installFetch(() => ({ status: 500, body: { error: "must not be called" } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const id = "abc00000-0000-4000-8000-000000000001";
    expect(await cloudResolveTaskRef(client, id.toUpperCase())).toBe(id);
    expect(calls).toHaveLength(0);
  });

  test("evidence completion requires an advertised OpenAPI request schema before POST", async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/openapi.json")) {
        return {
          body: {
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/complete": { post: { responses: { "200": { description: "ok" } } } },
            },
          },
        };
      }
      return { body: { task: { id: "task-1", status: "completed" } } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudCompleteTask(client, "task-1", {
      agent_id: "agent-one",
      files_changed: ["src/a.ts"],
      confidence: 0.9,
    })).rejects.toThrow("REMOTE_COMPLETION_EVIDENCE_UNSUPPORTED");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://todos.example.com/v1/openapi.json",
    ]);
  });

  test("evidence capability is cached per authority while agent-only completion stays compatible", async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/openapi.json")) {
        return {
          body: {
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/complete": {
                post: {
                  requestBody: {
                    content: {
                      "application/json": { schema: { $ref: "#/components/schemas/CompleteTaskInput" } },
                    },
                  },
                },
              },
            },
            components: {
              schemas: {
                CompleteTaskInput: {
                  type: "object",
                  properties: {
                    agent_id: { type: "string" },
                    attachment_ids: { type: "array", items: { type: "string" } },
                    files_changed: { type: "array", items: { type: "string" } },
                    test_results: { type: "string" },
                    commit_hash: { type: "string" },
                    notes: { type: "string" },
                    confidence: { type: "number" },
                  },
                },
              },
            },
          },
        };
      }
      return { body: { task: { id: "task-1", status: "completed" } } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await cloudCompleteTask(client, "task-1", { files_changed: ["src/a.ts"] });
    await cloudCompleteTask(client, "task-1", { notes: "verified" });
    await cloudCompleteTask(client, "task-1", { agent_id: "agent-only" });

    expect(calls.filter((call) => call.url.endsWith("/v1/openapi.json"))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith("/complete"))).toHaveLength(3);
  });

  test("completion capability results never cross authority boundaries", async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/openapi.json")) {
        const supported = call.url.startsWith("https://authority-b.example/");
        return { body: supported ? {
          paths: {
            "/v1/tasks/{id}/complete": {
              post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { notes: { type: "string" } } } } } } },
            },
          },
        } : { paths: { "/v1/tasks/{id}/complete": { post: {} } } } };
      }
      return { body: { task: { id: "task-1", status: "completed" } } };
    });
    const clientA = getTodosCloudClient({
      HASNA_TODOS_API_URL: "https://authority-a.example",
      HASNA_TODOS_API_KEY: "fixture-a",
    })!;
    const clientB = getTodosCloudClient({
      HASNA_TODOS_API_URL: "https://authority-b.example",
      HASNA_TODOS_API_KEY: "fixture-b",
    })!;

    await expect(cloudCompleteTask(clientA, "task-1", { notes: "blocked" })).rejects.toThrow("REMOTE_COMPLETION_EVIDENCE_UNSUPPORTED");
    await cloudCompleteTask(clientB, "task-1", { notes: "supported" });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://authority-a.example/v1/openapi.json",
      "GET https://authority-b.example/v1/openapi.json",
      "POST https://authority-b.example/v1/tasks/task-1/complete",
    ]);
  });

  test("short (short_id) references resolve server-side in ONE bounded GET (no snapshot paging)", async () => {
    const id = "abc00000-0000-4000-8000-000000000001";
    const calls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname === "/v1/tasks/ope2-00125") return { body: { task: { id, short_id: "OPE2-00125" } } };
      throw new Error(`unexpected request: ${call.url}`);
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    // Case-insensitive: an upper-case short_id is resolved by the authority.
    await expect(cloudResolveTaskRef(client, "OPE2-00125")).resolves.toBe(id);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/v1/tasks/ope2-00125"]);
    expect(calls.some((call) => new URL(call.url).pathname.endsWith("/stats"))).toBe(false);
  });

  test("unique id-prefix references resolve server-side in ONE bounded GET", async () => {
    const id = "abc00000-0000-4000-8000-000000000001";
    const calls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname === "/v1/tasks/abc00000") return { body: { task: { id, short_id: "ONE" } } };
      throw new Error(`unexpected request: ${call.url}`);
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudResolveTaskRef(client, "abc00000")).resolves.toBe(id);
    expect(calls).toHaveLength(1);
  });

  test("an ambiguous reference (authority 409) surfaces an ambiguity error", async () => {
    const projectIds = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    const calls = installFetch((call) => {
      if (new URL(call.url).pathname === "/v1/tasks/abc") {
        return {
          status: 409,
          body: {
            error: `Task reference is ambiguous: "abc". Candidate project IDs: ${projectIds.join(", ")}. Use a full task UUID.`,
            candidate_project_ids: projectIds,
          },
        };
      }
      throw new Error(`unexpected request: ${call.url}`);
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const resolution = cloudResolveTaskRef(client, "abc");
    await expect(resolution).rejects.toThrow("ambiguous");
    await expect(resolution).rejects.toThrow(projectIds[0]);
    await expect(resolution).rejects.toThrow(projectIds[1]);
    expect(calls).toHaveLength(1);
  });

  test("a missing reference fails FAST (single GET, no whole-set paging)", async () => {
    const calls = installFetch((call) => {
      if (new URL(call.url).pathname === "/v1/tasks/nope-00001") return { status: 404, body: { error: "task not found" } };
      throw new Error(`unexpected request: ${call.url}`);
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudResolveTaskRef(client, "NOPE-00001")).rejects.toThrow("Task not found");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/v1/tasks/nope-00001"]);
  });

  test("an authority that returns an unrelated task is rejected (no false positive)", async () => {
    installFetch((call) => {
      if (new URL(call.url).pathname === "/v1/tasks/ope2-00125") {
        return { body: { task: { id: "abc00000-0000-4000-8000-000000000002", short_id: "OTHER-99999" } } };
      }
      throw new Error(`unexpected request: ${call.url}`);
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudResolveTaskRef(client, "OPE2-00125")).rejects.toThrow("Task not found");
  });

  test("list -> GET /v1/tasks, unwraps { tasks }", async () => {
    const calls = installFetch(() => ({ body: { tasks: [{ id: "t1", title: "a" }], count: 1 } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const tasks = await cloudListTasks(client, { status: "pending", limit: 5 });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe("t1");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toContain("https://todos.example.com/v1/tasks");
    expect(calls[0]!.url).toContain("status=pending");
    expect(calls[0]!.url).toContain("limit=5");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer hasna_todos_test_key");
  });

  test("cloudCountTasks reads the SQL-side total from ONE bounded limit=1 request (task 5e5ed4d1)", async () => {
    const calls = installFetch((call) => {
      expect(new URL(call.url).pathname).toBe("/v1/tasks");
      expect(new URL(call.url).searchParams.get("limit")).toBe("1");
      return { body: { tasks: [planProjectLinkTaskFixture()], count: 1, total: 64870 } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const total = await cloudCountTasks(client, { status: "pending" as never });
    expect(total).toBe(64870); // the row count served is 1; total is SQL-side
    expect(calls).toHaveLength(1); // bounded, never a second unbounded read
    expect(new URL(calls[0]!.url).searchParams.get("status")).toBe("pending");
  });

  test("cloudCountTasks falls back to the full list when a legacy authority omits `total`", async () => {
    const calls = installFetch(() => ({ body: { tasks: [
      planProjectLinkTaskFixture(),
      { ...planProjectLinkTaskFixture(), id: "task-2" },
    ], count: 2 } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const total = await cloudCountTasks(client, { status: "pending" as never });
    expect(total).toBe(2);
    expect(calls.length).toBeGreaterThan(1); // bounded attempt + unbounded fallback read
  });

  test("get -> GET /v1/tasks/:id, unwraps { task }; 404 -> null", async () => {
    const calls = installFetch((c) =>
      c.url.endsWith("/tasks/missing") ? { status: 404, body: { error: "not found" } } : { body: { task: { id: "t9", title: "z" } } },
    );
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const task = await cloudGetTask(client, "t9");
    expect(task!.id).toBe("t9");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/tasks/t9");
    const gone = await cloudGetTask(client, "missing");
    expect(gone).toBeNull();
  });

  test("parentless create uses one POST plus authoritative GET readback", async () => {
    const calls = installFetch(() => ({ status: 201, body: { task: { id: "new1", title: "made" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const task = await cloudCreateTask(client, { title: "made" });
    expect(task.id).toBe("new1");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/tasks");
    expect(calls[0]!.body).toEqual({ title: "made" });
    expect(calls[0]!.headers["idempotency-key"]).toBeTruthy();
    expect(calls[1]!.method).toBe("GET");
    expect(calls[1]!.url).toBe("https://todos.example.com/v1/tasks/new1");
  });

  test("parented create -> one POST plus authoritative GET readback, returning the stored task", async () => {
    const calls = installFetch(() => ({
      status: 201,
      body: { task: { id: "new1", title: "made", parent_id: "parent1" } },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const task = await cloudCreateTask(client, { title: "made", parent_id: "parent1" });
    expect(task.id).toBe("new1");
    expect(task.parent_id).toBe("parent1");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/tasks");
    expect(calls[0]!.body).toEqual({ title: "made", parent_id: "parent1" });
    expect(calls[0]!.headers["idempotency-key"]).toBeTruthy();
    expect(calls[1]!.method).toBe("GET");
    expect(calls[1]!.url).toBe("https://todos.example.com/v1/tasks/new1");
  });

  test("explicit created_by refuses an authority that does not advertise the creator contract", async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/openapi.json")) {
        return { body: createdByOpenApi(false) };
      }
      throw new Error(`task mutation must not be sent: ${call.method} ${call.url}`);
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudCreateTask(client, {
      title: "made",
      created_by: "theophrastus",
    }, {
      expectedCreatedBy: "theophrastus",
    })).rejects.toThrow("REMOTE_CREATED_BY_UNSUPPORTED");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://todos.example.com/v1/openapi.json",
    ]);
  });

  test("explicit created_by rejects an authoritative readback that overwrites the creator", async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/openapi.json")) {
        return { body: createdByOpenApi(true) };
      }
      if (call.method === "POST") {
        return {
          status: 201,
          body: { task: { id: "new1", title: "made", created_by: "fleet" } },
        };
      }
      return { body: { task: { id: "new1", title: "made", created_by: "fleet" } } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudCreateTask(client, {
      title: "made",
      created_by: "theophrastus",
    }, {
      expectedCreatedBy: "theophrastus",
    })).rejects.toThrow("TASK_CREATE_PERSISTENCE_UNVERIFIED");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://todos.example.com/v1/openapi.json",
      "POST https://todos.example.com/v1/tasks",
      "GET https://todos.example.com/v1/tasks/new1",
    ]);
  });

  test("create refuses a POST task that is absent from authoritative GET readback", async () => {
    const calls = installFetch((call) =>
      call.method === "POST"
        ? { status: 201, body: { task: { id: "ghost1", title: "made", parent_id: "parent1" } } }
        : { status: 404, body: { error: "task not found" } },
    );
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudCreateTask(client, { title: "made", parent_id: "parent1" }))
      .rejects.toThrow("TASK_CREATE_PERSISTENCE_UNVERIFIED");
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET"]);
  });

  test("plan-linked create rejects an authoritative readback that dropped the requested plan", async () => {
    const calls = installFetch(() => ({
      status: 201,
      body: { task: { id: "new1", title: "made", plan_id: null } },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudCreateTask(client, { title: "made", plan_id: "plan-1" }))
      .rejects.toThrow("TASK_CREATE_PERSISTENCE_UNVERIFIED");
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET"]);
  });

  test("create never replays a task POST when the authority rejects acceptance", async () => {
    const calls = installFetch(() => ({
      status: 500,
      body: {
        error: "TASK_CREATE_PERSISTENCE_UNVERIFIED: stored task readback failed",
        code: "TASK_CREATE_PERSISTENCE_UNVERIFIED",
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudCreateTask(client, { title: "single attempt" }))
      .rejects.toThrow("REMOTE_API_UNAVAILABLE");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
  });

  test("create and update use the raw v1 transport instead of generic resource writes", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const taskWriteClient = {
      baseUrl: "https://todos.example.com/v1",
      transport: {
        post: async (path: string, body?: unknown) => {
          calls.push({ method: "POST", path, body });
          return { task: { id: "created-task", title: "created" } };
        },
        patch: async (path: string, body?: unknown) => {
          calls.push({ method: "PATCH", path, body });
          return { task: { id: "updated-task", title: "updated" } };
        },
      },
      get: async () => ({ task: { id: "created-task", title: "created", plan_id: "plan-1" } }),
      create: async () => {
        throw new Error("generic task create must not be used");
      },
      update: async () => {
        throw new Error("generic task update must not be used");
      },
    } as unknown as Parameters<typeof cloudCreateTask>[0];

    await expect(
      cloudCreateTask(taskWriteClient, {
        title: "created",
        plan_id: "plan-1",
      }),
    )
      .resolves.toMatchObject({ id: "created-task" });
    await expect(
      cloudUpdateTask(taskWriteClient, "updated-task", {
        title: "updated",
        plan_id: "plan-1",
      }),
    )
      .resolves.toMatchObject({ id: "updated-task" });

    expect(calls).toEqual([
      {
        method: "POST",
        path: "/tasks",
        body: { title: "created", plan_id: "plan-1" },
      },
      {
        method: "PATCH",
        path: "/tasks/updated-task",
        body: { title: "updated", plan_id: "plan-1" },
      },
    ]);
  });

  test("update -> PATCH /v1/tasks/:id, unwraps { task }", async () => {
    const calls = installFetch(() => ({ body: { task: { id: "t2", title: "patched" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const task = await cloudUpdateTask(client, "t2", { title: "patched" });
    expect(task.title).toBe("patched");
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/tasks/t2");
  });

  test("delete -> DELETE /v1/tasks/:id (204 ok)", async () => {
    const calls = installFetch(() => ({ status: 204 }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudDeleteTask(client, "t3")).resolves.toBe(true);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/tasks/t3");
  });

  test("delete preserves a resource 404 as a normal not-found result", async () => {
    installFetch(() => ({ status: 404, body: { error: "not found" } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudDeleteTask(client, "missing")).resolves.toBe(false);
  });

  test("action -> POST /v1/tasks/:id/start, unwraps { task }", async () => {
    const calls = installFetch(() => ({ body: { task: { id: "t4", status: "in_progress" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const task = await cloudTaskAction(client, "t4", "start", { agent_id: "cli" });
    expect(task.status).toBe("in_progress");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/tasks/t4/start");
  });

  test("retrying fail preflights advertised support, posts once, and preserves reason and retry result", async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/openapi.json")) {
        return {
          body: {
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/fail": {
                post: {
                  requestBody: {
                    content: {
                      "application/json": { schema: { $ref: "#/components/schemas/FailTaskInput" } },
                    },
                  },
                },
              },
            },
            components: {
              schemas: {
                FailTaskInput: {
                  type: "object",
                  properties: {
                    agent_id: { type: "string" },
                    reason: { type: "string" },
                    retry: { type: "boolean" },
                  },
                },
              },
            },
          },
        };
      }
      return {
        body: {
          result: {
            task: { id: "t-fail", status: "failed", reason: "remote reason" },
            retryTask: { id: "t-retry", status: "pending" },
          },
        },
      };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const result = await cloudFailTask(client, "t-fail", {
      agent_id: "nausicaa",
      reason: "remote reason",
      retry: true,
    });

    expect(result.task).toMatchObject({ id: "t-fail", status: "failed", reason: "remote reason" });
    expect(result.retryTask).toMatchObject({ id: "t-retry", status: "pending" });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://todos.example.com/v1/openapi.json",
      "POST https://todos.example.com/v1/tasks/t-fail/fail",
    ]);
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: "https://todos.example.com/v1/tasks/t-fail/fail",
      body: { agent_id: "nausicaa", reason: "remote reason", retry: true },
    });
  });

  test("retry capability is cached per authority and reset clears the cached result", async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/openapi.json")) {
        return {
          body: {
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/fail": {
                post: {
                  requestBody: {
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: { retry: { type: "boolean" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        };
      }
      return {
        body: {
          result: {
            task: { id: "t-fail", status: "failed" },
            retryTask: { id: "t-retry", status: "pending" },
          },
        },
      };
    });
    const authorityA = getTodosCloudClient(CLOUD_ENV)!;
    const authorityB = getTodosCloudClient({
      HASNA_TODOS_API_URL: "https://authority-b.example",
      HASNA_TODOS_API_KEY: "fixture-b",
    })!;

    await cloudFailTask(authorityA, "task-a-1", { retry: true });
    await cloudFailTask(authorityA, "task-a-2", { retry: true });
    await cloudFailTask(authorityB, "task-b-1", { retry: true });
    expect(calls.filter((call) => call.url.endsWith("/v1/openapi.json"))).toHaveLength(2);

    resetTodosCloudClient();
    await cloudFailTask(authorityA, "task-a-3", { retry: true });
    expect(calls.filter((call) => call.url.endsWith("/v1/openapi.json"))).toHaveLength(3);
  });

  test("retrying fail rejects a non-advertising authority before any fail mutation", async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/openapi.json")) {
        return {
          body: {
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/fail": {
                post: {
                  requestBody: {
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            agent_id: { type: "string" },
                            reason: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        };
      }
      throw new Error(`unexpected mutation: ${call.method} ${call.url}`);
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    const failure = cloudFailTask(client, "t-fail", {
      agent_id: "nausicaa",
      reason: "must remain pending",
      retry: true,
    });
    await expect(failure).rejects.toThrow("REMOTE_RETRY_UNSUPPORTED");
    await expect(failure).rejects.toThrow("POST /v1/tasks/{id}/fail");
    await expect(failure).rejects.toThrow("https://todos.example.com");
    await expect(failure).rejects.toThrow("no failure mutation was sent");
    await expect(failure).rejects.toThrow("deploy a compatible @hasna/todos /v1 server");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://todos.example.com/v1/openapi.json",
    ]);
  });

  test.each([
    ["missing", undefined],
    ["malformed", "not-a-task"],
    ["missing identity", { status: "pending" }],
  ])("retrying fail rejects an advertised-support response with %s retryTask", async (_label, retryTask) => {
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/openapi.json")) {
        return {
          body: {
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/fail": {
                post: {
                  requestBody: {
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: { retry: { type: "boolean" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        };
      }
      return {
        body: {
          result: {
            task: { id: "t-fail", status: "failed" },
            ...(retryTask !== undefined ? { retryTask } : {}),
          },
        },
      };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudFailTask(client, "t-fail", { retry: true }))
      .rejects.toThrow("REMOTE_API_INCOMPATIBLE");
    expect(calls.filter((call) => call.url.endsWith("/fail"))).toHaveLength(1);
  });

  test("non-retry remote fail remains compatible and skips capability preflight", async () => {
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/openapi.json")) throw new Error("preflight must not run");
      return {
        body: {
          result: {
            task: { id: "t-fail", status: "failed", reason: "remote reason" },
          },
        },
      };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    const result = await cloudFailTask(client, "t-fail", {
      agent_id: "nausicaa",
      reason: "remote reason",
    });

    expect(result.task).toMatchObject({ id: "t-fail", status: "failed", reason: "remote reason" });
    expect(result.retryTask).toBeUndefined();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST https://todos.example.com/v1/tasks/t-fail/fail",
    ]);
  });

  test("failed-task start preserves the remote transition error instead of reporting authority failure", async () => {
    installFetch(() => ({
      status: 409,
      body: {
        error: "Task is failed and cannot be started; reset status to pending before starting again",
        code: "TASK_NOT_STARTABLE",
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudTaskAction(client, "failed-task", "start", { agent_id: "silvanus" }))
      .rejects.toThrow("TASK_NOT_STARTABLE: Task is failed and cannot be started; reset status to pending before starting again");
  });

  test("comments -> validates the envelope, count, method, auth, and encoded task path", async () => {
    const comment = {
      id: "c1",
      task_id: "task/with ? reserved",
      agent_id: null,
      session_id: null,
      content: "safe comment",
      type: "comment" as const,
      progress_pct: null,
      created_at: "2026-07-10T00:00:00.000Z",
    };
    const calls = installFetch(() => ({ body: { comments: [comment], count: 1, has_more: false, next_cursor: null } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudListComments(client, comment.task_id)).resolves.toEqual({
      comments: [comment],
      count: 1,
      has_more: false,
      next_cursor: null,
      limit: 100,
      pagination_supported: true,
    });
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/tasks/task%2Fwith%20%3F%20reserved/comments?limit=100");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer hasna_todos_test_key");
  });

  test("comment write responses are redacted before JSON callers can emit them", async () => {
    const rawComment = {
      id: "c-write",
      task_id: "t-write",
      agent_id: null,
      session_id: null,
      content: "Bearer abcdefghijklmnop should redact",
      type: "comment" as const,
      progress_pct: null,
      created_at: "2026-07-10T00:00:00.000Z",
    };
    installFetch(() => ({ status: 201, body: { comment: rawComment } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const comment = await cloudAddComment(client, rawComment.task_id, { content: rawComment.content });
    expect(comment.content).toContain("[REDACTED]");
    expect(comment.content).not.toContain("abcdefghijklmnop");
  });

  test("comments accepts the legacy bare-array response", async () => {
    const comment = {
      id: "c2",
      task_id: "t2",
      agent_id: null,
      session_id: null,
      content: "legacy response",
      type: "comment" as const,
      progress_pct: null,
      created_at: "2026-07-10T00:00:00.000Z",
    };
    installFetch(() => ({ body: [comment] }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudListComments(client, "t2")).resolves.toEqual({
      comments: [comment],
      count: 1,
      has_more: false,
      next_cursor: null,
      limit: 100,
      pagination_supported: false,
    });
  });

  test("comments exposes bounded cursor pagination without silently consuming every page", async () => {
    const comment = {
      id: "c-page",
      task_id: "t-page",
      agent_id: null,
      session_id: null,
      content: "newest page",
      type: "comment" as const,
      progress_pct: null,
      created_at: "2026-07-10T00:00:00.000Z",
    };
    const calls = installFetch(() => ({
      body: { comments: [comment], count: 1, has_more: true, next_cursor: "opaque-next" },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const page = await cloudListComments(client, "t-page", { limit: 25, cursor: "opaque-current" });
    expect(page).toMatchObject({
      count: 1,
      has_more: true,
      next_cursor: "opaque-next",
      limit: 25,
      pagination_supported: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://todos.example.com/v1/tasks/t-page/comments?limit=25&cursor=opaque-current",
    );
  });

  test("comments fails closed on malformed or internally inconsistent 2xx responses", async () => {
    const malformed = [
      null,
      {},
      { comments: null },
      { comments: [{}], count: 1 },
      { comments: [], count: 1 },
      { comments: [], count: 0, has_more: false },
      { comments: [], count: 0, next_cursor: null },
      { comments: [], count: 0, has_more: true, next_cursor: null },
      { comments: [], count: 0, has_more: false, next_cursor: "unexpected" },
    ];
    for (const body of malformed) {
      resetTodosCloudClient();
      installFetch(() => ({ body }));
      const client = getTodosCloudClient(CLOUD_ENV)!;
      await expect(cloudListComments(client, "t3")).rejects.toThrow(/invalid cloud comments.*response/i);
    }
  });

  test("comments rejects invalid limits and paginated server pages larger than requested", async () => {
    const client = getTodosCloudClient(CLOUD_ENV)!;
    for (const limit of [0, 501, 1.5, Number.NaN]) {
      await expect(cloudListComments(client, "t-limit", { limit })).rejects.toThrow(/limit/i);
    }
    for (const cursor of ["", "a".repeat(1_025)]) {
      await expect(cloudListComments(client, "t-limit", { cursor })).rejects.toThrow(/cursor/i);
    }

    resetTodosCloudClient();
    installFetch(() => ({ body: { comments: [
      { id: "c1", task_id: "t-limit", agent_id: null, session_id: null, content: "one", type: "comment", progress_pct: null, created_at: "2026-07-10T00:00:00.000Z" },
      { id: "c2", task_id: "t-limit", agent_id: null, session_id: null, content: "two", type: "comment", progress_pct: null, created_at: "2026-07-10T00:00:01.000Z" },
    ], count: 2, has_more: false, next_cursor: null } }));
    await expect(cloudListComments(getTodosCloudClient(CLOUD_ENV)!, "t-limit", { limit: 1 }))
      .rejects.toThrow(/exceeds requested limit/i);
  });

  test("comments caps an unpaginated predecessor response and explicitly reports legacy truncation", async () => {
    const comments = Array.from({ length: 150 }, (_, index) => ({
      id: `legacy-${String(index).padStart(3, "0")}`,
      task_id: "t-legacy",
      agent_id: null,
      session_id: null,
      content: `legacy ${index}`,
      type: "comment" as const,
      progress_pct: null,
      created_at: `2026-07-10T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    }));
    const calls = installFetch(() => ({ body: { comments, count: comments.length } }));
    const page = await cloudListComments(getTodosCloudClient(CLOUD_ENV)!, "t-legacy", { limit: 100 });
    expect(page.comments).toHaveLength(100);
    expect(page.comments[0]!.id).toBe("legacy-050");
    expect(page).toMatchObject({
      count: 100,
      has_more: true,
      next_cursor: null,
      limit: 100,
      pagination_supported: false,
    });
    expect(calls).toHaveLength(1);
  });

  test("comments gives an actionable compatibility error for an older server and classifies 5xx", async () => {
    for (const status of [404, 405]) {
      resetTodosCloudClient();
      installFetch(() => ({ status, body: { error: "unsupported" } }));
      const client = getTodosCloudClient(CLOUD_ENV)!;
      await expect(cloudListComments(client, "t4")).rejects.toThrow(/compatible.*server|server.*compatible/i);
    }

    resetTodosCloudClient();
    installFetch(() => ({ status: 500, body: { error: "failed" } }));
    const retryingClient = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudListComments(retryingClient, "t4")).rejects.toThrow("REMOTE_API_UNAVAILABLE");
  });
});

describe("cloud agent + lock + deps + verification routing (identity/coordination fixes)", () => {
  test("register_agent -> POST /v1/agents, unwraps { agent }, carries bearer key", async () => {
    const calls = installFetch(() => ({ status: 201, body: { agent: { id: "ag1", name: "seneca" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const agent = await cloudRegisterAgent(client, { name: "seneca", description: "worker" });
    expect(agent.id).toBe("ag1");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/agents");
    expect(calls[0]!.body).toEqual({ name: "seneca", description: "worker" });
    expect(calls[0]!.headers["authorization"]).toBe("Bearer hasna_todos_test_key");
  });

  test("register_agent -> a 409 conflict throws (no silent local duplicate)", async () => {
    installFetch(() => ({ status: 409, body: { error: "Agent name 'seneca' is already active", conflict: true } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudRegisterAgent(client, { name: "seneca" })).rejects.toBeDefined();
  });

  test("lock -> POST /v1/tasks/:id/lock with agent_id, unwraps { result }", async () => {
    const calls = installFetch(() => ({ body: { result: { success: true, locked_by: "cli", locked_at: "2026-01-01T00:00:00Z" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const result = await cloudLockTask(client, "t1", "cli");
    expect(result.success).toBe(true);
    expect(result.locked_by).toBe("cli");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/tasks/t1/lock");
    expect(calls[0]!.body).toEqual({ agent_id: "cli" });
  });

  test("unlock -> POST /v1/tasks/:id/unlock, returns success boolean", async () => {
    const calls = installFetch(() => ({ body: { success: true } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudUnlockTask(client, "t1", "cli")).resolves.toBe(true);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/tasks/t1/unlock");
    expect(calls[0]!.body).toEqual({ agent_id: "cli" });
  });

  test("stale-lock handoff -> exact v1 route with every explicit CAS input and unwraps receipt", async () => {
    const receipt = {
      schema_version: "todos.stale-lock-handoff.v1" as const,
      receipt_id: "33333333-3333-4333-8333-333333333333",
      task_id: "11111111-1111-4111-8111-111111111111",
      actor: "nausicaa",
      previous_holder: "holder-a",
      previous_lock_version: "2020-01-01T00:00:00.000Z",
      new_holder: "nausicaa",
      new_lock_version: "2026-08-09T10:00:00.000Z",
      stale_after_seconds: 3_600,
      stale_cutoff: "2026-08-09T09:00:00.000Z",
      reason: "stale exact lock",
      created_at: "2026-08-09T10:00:00.000Z",
    };
    const calls = installFetch((call) => call.url.endsWith("/v1/openapi.json")
      ? {
          body: {
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/stale-lock-handoff": {
                post: {},
              },
            },
          },
        }
      : { body: { receipt } });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudHandoffStaleTaskLock(client, {
      task_id: receipt.task_id,
      expected_holder: receipt.previous_holder,
      expected_lock_version: receipt.previous_lock_version,
      stale_after_seconds: receipt.stale_after_seconds,
      new_holder: receipt.new_holder,
      reason: receipt.reason,
    })).resolves.toEqual(receipt);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/openapi.json");
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.url).toBe(
      `https://todos.example.com/v1/tasks/${receipt.task_id}/stale-lock-handoff`,
    );
    expect(calls[1]!.body).toEqual({
      expected_holder: receipt.previous_holder,
      expected_lock_version: receipt.previous_lock_version,
      stale_after_seconds: receipt.stale_after_seconds,
      new_holder: receipt.new_holder,
      reason: receipt.reason,
    });
  });

  test("deps add -> POST /v1/tasks/:id/dependencies, unwraps { dependency }", async () => {
    const calls = installFetch(() => ({ status: 201, body: { dependency: { task_id: "t1", depends_on: "t2" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const dep = await cloudAddDependency(client, "t1", "t2");
    expect(dep.depends_on).toBe("t2");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/tasks/t1/dependencies");
    expect(calls[0]!.body).toEqual({ depends_on: "t2" });
  });

  test("deps remove -> DELETE /v1/tasks/:id/dependencies/:dep, returns removed", async () => {
    const calls = installFetch(() => ({ body: { removed: true } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudRemoveDependency(client, "t1", "t2")).resolves.toBe(true);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/tasks/t1/dependencies/t2");
  });

  test("deps list -> GET /v1/tasks/:id/dependencies, defaults arrays", async () => {
    const calls = installFetch(() => ({ body: { dependencies: [{ task_id: "t1", depends_on: "t2" }], blocked_by: [] } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const edges = await cloudGetDependencies(client, "t1");
    expect(edges.dependencies).toHaveLength(1);
    expect(edges.blocks).toEqual([]);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/tasks/t1/dependencies");
  });

  test("deps list reads incoming edges from the legacy wire name blocked_by (pre-0.13.2 server)", async () => {
    installFetch(() => ({ body: { dependencies: [], blocked_by: [{ task_id: "t9", depends_on: "t1" }] } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const edges = await cloudGetDependencies(client, "t1");
    expect(edges.blocks).toEqual([{ task_id: "t9", depends_on: "t1" }]);
  });

  test("record-verification -> POST /v1/tasks/:id/verifications, unwraps { verification }", async () => {
    const calls = installFetch(() => ({ status: 201, body: { verification: { id: "v1", task_id: "t1", command: "bun test", status: "passed" } } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const v = await cloudRecordVerification(client, "t1", { command: "bun test", status: "passed" });
    expect(v.status).toBe("passed");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/tasks/t1/verifications");
    expect(calls[0]!.body).toEqual({ command: "bun test", status: "passed" });
  });
});

describe("cloud read/analytics routing reads the shared cloud dataset", () => {
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

  test("active work -> GET /v1/tasks?status=in_progress, priority-sorted", async () => {
    const calls = installFetch(() => ({
      body: {
        tasks: [
          { id: "a", title: "low", priority: "low", status: "in_progress", updated_at: iso(1000) },
          { id: "b", title: "crit", priority: "critical", status: "in_progress", updated_at: iso(5000) },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const work = await cloudActiveWork(client, {});
    expect(work.map((t) => t.id)).toEqual(["b", "a"]);
    expect(calls[0]!.url).toContain("/v1/tasks");
    expect(calls[0]!.url).toContain("status=in_progress");
  });

  test("stale tasks -> in_progress older than threshold", async () => {
    installFetch(() => ({
      body: {
        tasks: [
          { id: "fresh", status: "in_progress", updated_at: iso(60 * 1000), locked_at: null },
          { id: "stale", status: "in_progress", updated_at: iso(60 * 60 * 1000), locked_at: null },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const tasks = await cloudStaleTasks(client, 30, {});
    expect(tasks.map((t) => t.id)).toEqual(["stale"]);
  });

  test("overdue tasks -> active tasks past due_at", async () => {
    installFetch((c) => {
      const status = c.url.includes("status=pending") ? "pending" : "in_progress";
      return {
        body: {
          tasks:
            status === "pending"
              ? [
                  { id: "overdue", status: "pending", due_at: iso(24 * 60 * 60 * 1000) },
                  { id: "future", status: "pending", due_at: new Date(Date.now() + 8.64e7).toISOString() },
                ]
              : [],
        },
      };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const tasks = await cloudOverdueTasks(client);
    expect(tasks.map((t) => t.id)).toEqual(["overdue"]);
  });

  test("escalated tasks -> overdue and sla_breached reasons", async () => {
    installFetch((c) => ({
      body: {
        tasks: c.url.includes("status=pending")
          ? [{ id: "od", status: "pending", due_at: iso(60 * 60 * 1000), created_at: iso(9e7) }]
          : [{ id: "sla", status: "in_progress", sla_minutes: 1, started_at: iso(60 * 60 * 1000), created_at: iso(9e7) }],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const esc = await cloudEscalatedTasks(client, {});
    const byId = Object.fromEntries(esc.map((e) => [e.task.id, e.reasons]));
    expect(byId["od"]).toEqual(["overdue"]);
    expect(byId["sla"]).toEqual(["sla_breached"]);
  });

  test("changed-since -> filters updated_at > since", async () => {
    installFetch(() => ({
      body: {
        tasks: [
          { id: "new", updated_at: iso(1000) },
          { id: "old", updated_at: iso(48 * 60 * 60 * 1000) },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const since = iso(24 * 60 * 60 * 1000);
    const tasks = await cloudChangedSince(client, since);
    expect(tasks.map((t) => t.id)).toEqual(["new"]);
  });

  test("REGRESSION: changed-since compares the cursor as an INSTANT, not raw text", async () => {
    // Release-review P1 (0.15.44 review): cloudChangedSince filtered
    // `(t.updated_at ?? "") > since` as raw text. Space (0x20) sorts before
    // 'T' (0x54), so a space-form stamp ("2026-08-20 23:00:00") that is
    // genuinely NEWER than an ISO cursor was silently excluded from CLI
    // summaries and activity reports; an unparseable stamp was dropped too.
    installFetch(() => ({
      body: {
        tasks: [
          { id: "space-new", updated_at: "2026-08-20 23:00:00" }, // newer than cursor, previously excluded
          { id: "iso-new", updated_at: "2026-08-20T22:00:00.000Z" },
          { id: "old", updated_at: "2026-08-19T21:00:00.000Z" },
          { id: "unparseable", updated_at: "not-a-timestamp" }, // cannot read -> KEPT, not older
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const since = "2026-08-20T21:00:00.000Z";
    const tasks = await cloudChangedSince(client, since);
    expect(tasks.map((t) => t.id).sort()).toEqual(["iso-new", "space-new", "unparseable"]);
  });

  test("task stats -> counts by status/priority/agent from cloud", async () => {
    installFetch(() => ({
      body: {
        tasks: [
          { id: "1", status: "completed", priority: "high", assigned_to: "julius" },
          { id: "2", status: "pending", priority: "low", assigned_to: null, agent_id: "cato" },
          { id: "3", status: "completed", priority: "high", assigned_to: "julius" },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const stats = await cloudTaskStats(client, {});
    expect(stats.total).toBe(3);
    expect(stats.by_status["completed"]).toBe(2);
    expect(stats.by_priority["high"]).toBe(2);
    expect(stats.by_agent["julius"]).toBe(2);
    expect(stats.completion_rate).toBe(67);
  });

  test("recent activity -> GET /v1/activity?limit, unwraps { activity }", async () => {
    const calls = installFetch(() => ({ body: { activity: [{ id: "h1", task_id: "t1", action: "create", created_at: iso(0) }], count: 1 } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const entries = await cloudRecentActivity(client, 30);
    expect(entries).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toContain("/v1/activity");
    expect(calls[0]!.url).toContain("limit=30");
  });

  test("task lists -> GET /v1/task-lists?project_id, unwraps { task_lists }", async () => {
    const calls = installFetch(() => ({ body: { task_lists: [{ id: "tl1", name: "Backlog", slug: "backlog" }], count: 1 } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const lists = await cloudListTaskLists(client, "proj1");
    expect(lists).toHaveLength(1);
    expect(calls[0]!.url).toContain("/v1/task-lists");
    expect(calls[0]!.url).toContain("project_id=proj1");
  });

  test("next -> GET /v1/next, unwraps { task }; empty -> null", async () => {
    const calls = installFetch((c) =>
      c.url.includes("agent=julius") ? { body: { task: { id: "best", title: "do this" } } } : { body: { task: null } },
    );
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const task = await cloudNextTask(client, "julius", { project_id: "p1" });
    expect(task!.id).toBe("best");
    expect(calls[0]!.url).toContain("/v1/next");
    expect(calls[0]!.url).toContain("agent=julius");
    expect(calls[0]!.url).toContain("project_id=p1");
    const none = await cloudNextTask(client);
    expect(none).toBeNull();
  });

  test("all dependencies -> GET /v1/dependencies, unwraps { dependencies }", async () => {
    const calls = installFetch(() => ({ body: { dependencies: [{ task_id: "a", depends_on: "b" }], count: 1 } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const edges = await cloudAllDependencies(client);
    expect(edges).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://todos.example.com/v1/dependencies");
  });

  test("blocking deps map -> incomplete blockers only", async () => {
    installFetch((c) => {
      if (c.url.endsWith("/dependencies")) {
        return { body: { dependencies: [{ task_id: "cand", depends_on: "done" }, { task_id: "cand", depends_on: "open" }] } };
      }
      if (c.url.endsWith("/tasks/done")) return { body: { task: { id: "done", status: "completed", title: "done" } } };
      if (c.url.endsWith("/tasks/open")) return { body: { task: { id: "open", status: "pending", title: "open" } } };
      return { body: { task: null } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const map = await cloudBlockingDepsMap(client, [{ id: "cand" } as never]);
    expect(map.get("cand")!.map((t) => t.id)).toEqual(["open"]);
  });

  test("recap -> completed/created/in_progress/stale/blocked/agents from cloud", async () => {
    installFetch((c) => {
      if (c.url.endsWith("/agents")) {
        return { body: { agents: [{ id: "ag1", name: "julius", last_seen_at: iso(60 * 1000) }] } };
      }
      if (c.url.endsWith("/dependencies")) return { body: { dependencies: [] } };
      // /v1/tasks (list, no status filter)
      return {
        body: {
          tasks: [
            { id: "c1", status: "completed", completed_at: iso(60 * 1000), started_at: iso(60 * 60 * 1000), created_at: iso(60 * 60 * 1000), assigned_to: "ag1", title: "done" },
            { id: "p1", status: "in_progress", updated_at: iso(1000), created_at: iso(90 * 60 * 1000), assigned_to: "ag1", title: "wip" },
            { id: "s1", status: "in_progress", updated_at: iso(60 * 60 * 1000), created_at: iso(90 * 60 * 1000), title: "stuck" },
          ],
        },
      };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const recap = await cloudRecap(client, 8);
    expect(recap.completed.map((t) => t.id)).toEqual(["c1"]);
    expect(recap.completed[0]!.duration_minutes).toBe(59);
    expect(recap.in_progress.map((t) => t.id).sort()).toEqual(["p1", "s1"]);
    expect(recap.stale.map((t) => t.id)).toEqual(["s1"]);
    expect(recap.agents[0]!.name).toBe("julius");
    expect(recap.agents[0]!.completed_count).toBe(1);
  });

  test("timeline -> maps /v1/activity to entries, honors order + since", async () => {
    installFetch(() => ({
      body: {
        activity: [
          { id: "h1", task_id: "t1", action: "create", agent_id: "julius", created_at: iso(60 * 60 * 1000), field: null },
          { id: "h2", task_id: "t2", action: "complete", agent_id: null, created_at: iso(1000), field: "status", old_value: "pending", new_value: "completed" },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const page = await cloudTimeline(client, { order: "desc", limit: 10 });
    expect(page.total).toBe(2);
    expect(page.entries[0]!.task_id).toBe("t2");
    expect(page.entries[0]!.event_type).toBe("complete");
    expect(page.entries[0]!.message).toContain("status");
  });

  test("timeline -> non-task entity filter yields no rows (cloud degradation)", async () => {
    installFetch(() => ({ body: { activity: [{ id: "h1", task_id: "t1", action: "create", created_at: iso(0) }] } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    const page = await cloudTimeline(client, { entity_type: "project", entity_id: "p1" });
    expect(page.total).toBe(0);
  });
});

describe("cloud task-list, filter, and force-unlock parity", () => {
  test("project resolution preserves exact UUIDs and resolves unique prefixes, names, slugs, and paths", async () => {
    installFetch(() => ({
      body: {
        projects: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            name: "Open Emails",
            path: "/workspace/hasna/opensource/open-emails",
            task_list_id: "emails-canonical",
          },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    for (const ref of [
      "99999999-9999-4999-8999-999999999999",
      "  99999999-9999-4999-8999-999999999999  ",
      "99999999",
      "Open Emails",
      "  OPEN EMAILS  ",
      "open-emails",
      "emails-canonical",
      "/workspace/hasna/opensource/open-emails",
      "/home/hasna/workspace/hasna/opensource/open-emails",
    ]) {
      await expect(cloudResolveProjectRef(client, ref))
        .resolves.toBe("99999999-9999-4999-8999-999999999999");
    }
  });

  test("project-rename reports an incompatible authority when rename is missing (404/405)", async () => {
    const projectId = "cbf3b934-44d0-4e1c-8225-23b44ade1d67";
    for (const status of [404, 405]) {
      resetTodosCloudClient();
      installFetch((call) => {
        if (call.url === "https://todos.example.com/v1/projects") {
          return {
            body: {
              projects: [{ id: projectId, name: "Mallorca", path: "/tmp/mallorca", task_list_id: "mallorca-vacation" }],
            },
          };
        }
        if (call.url === `https://todos.example.com/v1/projects/${projectId}/rename`) {
          return { status, body: { error: "method POST not allowed on /v1/projects/:id" } };
        }
        return { status: 404, body: { error: "not found" } };
      });
      const client = getTodosCloudClient(CLOUD_ENV)!;
      await expect(cloudRenameProject(client, "cbf3b934", "mallorca-holiday"))
        .rejects.toThrow(/REMOTE_API_INCOMPATIBLE.*\/v1\/projects\/:id\/rename/i);
    }
  });

  test("project resolution fails explicitly for missing and ambiguous references", async () => {
    installFetch(() => ({
      body: {
        projects: [
          { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "Shared", path: "/one/open-emails" },
          { id: "aaaaaaaa-2222-4222-8222-222222222222", name: "Shared", path: "/two/open-emails" },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudResolveProjectRef(client, "missing"))
      .rejects.toThrow('Project not found: "missing"');
    await expect(cloudResolveProjectRef(client, "Shared"))
      .rejects.toThrow('Project reference is ambiguous: "Shared"');
    await expect(cloudResolveProjectRef(client, "open-emails"))
      .rejects.toThrow('Project reference is ambiguous: "open-emails"');
    await expect(cloudResolveProjectRef(client, "aaaaaaaa"))
      .rejects.toThrow('Project reference is ambiguous: "aaaaaaaa"');
  });

  // Regression for 7a50aa8c: a project registered elsewhere (e.g. the Hasna
  // Projects CLI, whose "wks_..." workspace id and canonical slug are never
  // auto-linked into a todos project) resolved by its todos NAME but not by
  // that other system's slug — and both misses threw the byte-identical
  // "Project not found" message, so a caller could not tell "this project has
  // never been created" from "todos's own registry has no record under this
  // exact string". A name/path/slug miss must now say so explicitly; a
  // UUID-shaped id miss (a real id-lookup, not a slug guess) stays terse.
  test("project resolution distinguishes a registry-scoped slug/name miss from a genuine UUID miss", async () => {
    installFetch(() => ({
      body: {
        projects: [
          {
            id: "3a4b956d-3880-4b35-8c78-1c951237350f",
            name: "wks_bdn79k6023gj",
            path: "/home/hasna/.hasna/projects/workspaces/wks_bdn79k6023gj",
            task_list_id: "todos-wks-bdn79k6023gj",
          },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    // The project's own todos name/id/slug still resolve normally.
    await expect(cloudResolveProjectRef(client, "wks_bdn79k6023gj"))
      .resolves.toBe("3a4b956d-3880-4b35-8c78-1c951237350f");

    // A slug that is real in a DIFFERENT system but was never registered here
    // still fails — the negative-control prefix is unchanged so existing
    // callers that only check for "Project not found" keep working — but the
    // message now says the search was scoped to todos's own registry, rather
    // than reading as proof the project has never existed anywhere.
    const otherSystemSlug = "iproj-gtm-strategy";
    await expect(cloudResolveProjectRef(client, otherSystemSlug))
      .rejects.toThrow(`Project not found: "${otherSystemSlug}"`);
    await expect(cloudResolveProjectRef(client, otherSystemSlug)).rejects.toThrow(
      /todos's own project registry|does not know about projects registered elsewhere/i,
    );

    // A genuinely-absent reference of the SAME shape (a slug, not a UUID) still
    // fails outright — the fix does not weaken the negative case.
    await expect(cloudResolveProjectRef(client, "definitely-not-a-project-xyz"))
      .rejects.toThrow('Project not found: "definitely-not-a-project-xyz"');

    // A UUID-shaped id that simply doesn't exist is an id-lookup miss, not a
    // slug guess — it must NOT gain the registry-scope hint, so the two
    // failure shapes stay distinguishable from each other.
    const missingUuid = "00000000-0000-4000-8000-000000000000";
    await expect(cloudResolveProjectRef(client, missingUuid))
      .rejects.toThrow(`Project not found: "${missingUuid}"`);
    let uuidMissMessage = "";
    try {
      await cloudResolveProjectRef(client, missingUuid);
    } catch (error) {
      uuidMissMessage = error instanceof Error ? error.message : String(error);
    }
    expect(uuidMissMessage).toBe(`Project not found: "${missingUuid}"`);
  });

  test("list preserves task-list and parent filters on each scalar status request", async () => {
    const calls = installFetch(() => ({ body: { tasks: [] } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await cloudListTasks(client, {
      task_list_id: "list-1",
      parent_id: "parent-1",
      status: ["pending", "in_progress"],
    });
    expect(calls).toHaveLength(2);
    const urls = calls.map((call) => new URL(call.url));
    for (const url of urls) {
      expect(url.searchParams.get("task_list_id")).toBe("list-1");
      expect(url.searchParams.get("parent_id")).toBe("parent-1");
    }
    expect(urls.map((url) => url.searchParams.get("status")).sort())
      .toEqual(["in_progress", "pending"]);
  });

  test("an empty status array preserves the unfiltered remote list contract", async () => {
    const remoteTask = {
      id: "44444444-4444-4444-8444-444444444444",
      title: "unfiltered remote task",
      status: "pending",
      priority: "medium",
      created_at: "2026-08-08T10:00:00.000Z",
    };
    const calls = installFetch(() => ({ body: { tasks: [remoteTask] } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    const tasks = await cloudListTasks(client, { status: [] });

    expect(tasks).toEqual([remoteTask]);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).searchParams.has("status")).toBe(false);
  });

  test("task-list create/delete and slug/prefix resolution use /v1/task-lists", async () => {
    const calls = installFetch((call) => {
      if (call.method === "POST") {
        return { status: 201, body: { task_list: { id: "12345678-full", slug: "todos-open-emails", name: "Open Emails" } } };
      }
      if (call.method === "DELETE") return { status: 204 };
      return { body: { task_lists: [{ id: "12345678-full", slug: "todos-open-emails", name: "Open Emails" }] } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudCreateTaskList(client, { name: "Open Emails", slug: "todos-open-emails" }))
      .resolves.toMatchObject({ id: "12345678-full" });
    await expect(cloudResolveTaskListRef(client, "todos-open-emails")).resolves.toBe("12345678-full");
    await expect(cloudResolveTaskListRef(client, "12345678")).resolves.toBe("12345678-full");
    await expect(cloudDeleteTaskList(client, "12345678-full")).resolves.toBe(true);
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/v1/task-lists"))).toBe(true);
    expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/v1/task-lists/12345678-full"))).toBe(true);
  });

  test("project task-list ensure forwards plan, exact-revision apply, and conditional rollback", async () => {
    const project = {
      id: "project-1",
      name: "Dubai Fraud",
      path: "/workspace/dubai-fraud",
      task_list_id: "dubai-fraud",
      updated_at: "2026-08-07T10:00:00.000Z",
    };
    const taskList = {
      id: "list-1",
      project_id: project.id,
      slug: "dubai-fraud",
      name: project.name,
      created_at: "2026-08-07T10:01:00.000Z",
      updated_at: "2026-08-07T10:01:00.000Z",
    };
    const receipt = {
      schema_version: "todos.project-task-list-ensure.v1",
      receipt_id: "ptlr_fixture",
      idempotency_key: "dubai-fraud-default-list",
      project_id: project.id,
      task_list_id: taskList.id,
      slug: taskList.slug,
      created_by_operation: true,
      result_revision: taskList.updated_at,
      result_digest: "fixture-digest",
      rollback_supported: true,
      created_at: taskList.created_at,
    };
    const calls = installFetch((call) => {
      if (call.url.endsWith("/v1/projects/project-1/task-list/rollback")) {
        return {
          body: {
            schema_version: receipt.schema_version,
            action: "removed",
            project_id: project.id,
            task_list_id: taskList.id,
            accepted_receipt_id: receipt.receipt_id,
            rollback_receipt_id: "ptlr_inverse_fixture",
            removed_at: "2026-08-07T10:02:00.000Z",
          },
        };
      }
      if (call.method === "POST") {
        return { status: 201, body: { mode: "apply", action: "created", project, task_list: taskList, receipt } };
      }
      return { body: { mode: "plan", action: "would_create", project, task_list: null, receipt: null } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudPlanProjectTaskListEnsure(client, project.id))
      .resolves.toMatchObject({ mode: "plan", action: "would_create", task_list: null });
    await expect(cloudApplyProjectTaskListEnsure(client, project.id, {
      expected_project_revision: project.updated_at,
      idempotency_key: receipt.idempotency_key,
    })).resolves.toMatchObject({ mode: "apply", action: "created", receipt });
    await expect(cloudRollbackProjectTaskListEnsure(client, project.id, {
      receipt_id: receipt.receipt_id,
      expected_task_list_revision: taskList.updated_at,
    })).resolves.toMatchObject({ action: "removed", task_list_id: taskList.id });

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://todos.example.com/v1/projects/project-1/task-list/ensure",
      "POST https://todos.example.com/v1/projects/project-1/task-list/ensure",
      "POST https://todos.example.com/v1/projects/project-1/task-list/rollback",
    ]);
    expect(calls[1]!.body).toEqual({
      expected_project_revision: project.updated_at,
      idempotency_key: receipt.idempotency_key,
    });
    expect(calls[2]!.body).toEqual({
      receipt_id: receipt.receipt_id,
      expected_task_list_revision: taskList.updated_at,
    });
  });

  test("project task-list ensure preserves a domain PROJECT_NOT_FOUND response", async () => {
    installFetch(() => ({
      status: 404,
      body: { error: "Project not found: missing", code: "PROJECT_NOT_FOUND" },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudPlanProjectTaskListEnsure(client, "missing")).rejects.toMatchObject({
      status: 404,
      body: { code: "PROJECT_NOT_FOUND" },
    });
  });

  test("project task-list rollback preserves a domain receipt-not-found response", async () => {
    installFetch(() => ({
      status: 404,
      body: {
        error: "No exact operation-owned task list matches this rollback receipt",
        code: "PROJECT_TASK_LIST_RECEIPT_NOT_FOUND",
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudRollbackProjectTaskListEnsure(client, "project-1", {
      receipt_id: "ptlr_missing",
      expected_task_list_revision: "2026-08-07T10:01:00.000Z",
    })).rejects.toMatchObject({
      status: 404,
      body: { code: "PROJECT_TASK_LIST_RECEIPT_NOT_FOUND" },
    });
  });

  test.each([
    ["a bare ordinary plan", {
      id: "plan-1",
      slug: "dubai-fraud",
      name: "Dubai Fraud",
      project_id: null,
      updated_at: "2026-08-08T00:00:00.000Z",
    }],
    ["a partial linkage envelope", {
      mode: "plan",
      action: "would_link",
      plan: { id: "plan-1", project_id: null, updated_at: "2026-08-08T00:00:00.000Z" },
      project: { id: "project-1", updated_at: "2026-08-08T00:00:00.000Z" },
      tasks: [],
    }],
    ["the wrong operation", {
      mode: "apply",
      action: "linked",
      plan: { id: "plan-1", project_id: "project-1", updated_at: "2026-08-08T00:00:00.000Z" },
      project: { id: "project-1", updated_at: "2026-08-08T00:00:00.000Z" },
      tasks: [],
      receipt: null,
    }],
  ])("plan-project-link rejects HTTP 2xx carrying %s", async (_label, body) => {
    installFetch(() => ({ body }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudPlanPlanProjectLink(client, "plan-1", "project-1"))
      .rejects.toThrow(/REMOTE_API_INCOMPATIBLE:.*todos\.plan-project-link\.v1 plan response/i);
  });

  test("plan-project-link accepts the exact non-mutating response envelope", async () => {
    const plan = planProjectLinkPlanFixture();
    const project = planProjectLinkProjectFixture();
    const task = planProjectLinkTaskFixture();
    installFetch(() => ({
      body: { mode: "plan", action: "would_link", plan, project, tasks: [task], receipt: null },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudPlanPlanProjectLink(client, plan.id, project.id)).resolves.toEqual({
      mode: "plan",
      action: "would_link",
      plan,
      project,
      tasks: [task],
      receipt: null,
    });
  });

  test("plan-project-link accepts a supported task response without created_by", async () => {
    const plan = planProjectLinkPlanFixture();
    const project = planProjectLinkProjectFixture();
    const task = planProjectLinkTaskFixture();
    const legacyTask = { ...task } as Record<string, unknown>;
    delete legacyTask["created_by"];
    installFetch(() => ({
      body: { mode: "plan", action: "would_link", plan, project, tasks: [legacyTask], receipt: null },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudPlanPlanProjectLink(client, plan.id, project.id)).resolves.toEqual({
      mode: "plan",
      action: "would_link",
      plan,
      project,
      tasks: [task],
      receipt: null,
    });
  });

  test("plan-project-link still rejects an invalid present created_by", async () => {
    const plan = planProjectLinkPlanFixture();
    const project = planProjectLinkProjectFixture();
    const task = { ...planProjectLinkTaskFixture(), created_by: 42 };
    installFetch(() => ({
      body: { mode: "plan", action: "would_link", plan, project, tasks: [task], receipt: null },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudPlanPlanProjectLink(client, plan.id, project.id))
      .rejects.toThrow(/tasks\[0\]\.created_by must be a string or null/);
  });

  test.each([
    ["Plan", {
      mode: "plan",
      action: "would_link",
      plan: { ...planProjectLinkPlanFixture(), name: undefined, updated_at: "not-a-date" },
      project: planProjectLinkProjectFixture(),
      tasks: [planProjectLinkTaskFixture()],
      receipt: null,
    }],
    ["Project", {
      mode: "plan",
      action: "would_link",
      plan: planProjectLinkPlanFixture(),
      project: { ...planProjectLinkProjectFixture(), path: undefined, created_at: "not-a-date" },
      tasks: [planProjectLinkTaskFixture()],
      receipt: null,
    }],
    ["Task", {
      mode: "plan",
      action: "would_link",
      plan: planProjectLinkPlanFixture(),
      project: planProjectLinkProjectFixture(),
      tasks: [{ ...planProjectLinkTaskFixture(), title: undefined, updated_at: "not-a-date" }],
      receipt: null,
    }],
  ])("plan-project-link rejects a malformed nested %s entity", async (_label, body) => {
    installFetch(() => ({ body }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudPlanPlanProjectLink(client, "plan-1", "project-1"))
      .rejects.toThrow(/REMOTE_API_INCOMPATIBLE:.*todos\.plan-project-link\.v1 plan response/i);
  });

  test.each([
    ["a mismatched plan identity", { plan_id: "other-plan" }],
    ["a mismatched count", { task_count: 2 }],
    ["a mismatched result revision", { result_plan_revision: "2026-08-08T00:00:01.000Z" }],
    ["a nondeterministic receipt identity", { receipt_id: "pplr_arbitrary" }],
    ["an inconsistent result digest", { result_digest: "0".repeat(64) }],
    ["an invalid creation timestamp", { created_at: "not-a-date" }],
  ] as const)("plan-project-link apply rejects HTTP 2xx carrying %s", async (_label, overrides) => {
    const plan = planProjectLinkPlanFixture({
      project_id: "project-1",
      updated_at: "2026-08-08T00:00:02.000Z",
    });
    const project = planProjectLinkProjectFixture();
    const task = planProjectLinkTaskFixture({ project_id: project.id, updated_at: plan.updated_at });
    const receipt = { ...planProjectLinkReceiptFixture(plan, [task]), ...overrides };
    installFetch(() => ({
      status: 201,
      body: { mode: "apply", action: "linked", plan, project, tasks: [task], receipt },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudApplyPlanProjectLink(client, plan.id, project.id, {
      expected_plan_revision: "2026-08-08T00:00:00.000Z",
      expected_project_revision: project.updated_at,
      idempotency_key: "link-fixture",
    })).rejects.toThrow(/REMOTE_API_INCOMPATIBLE:.*todos\.plan-project-link\.v1 apply response/i);
  });

  test("plan-project-link apply rejects a partial receipt with full nested entities", async () => {
    const plan = planProjectLinkPlanFixture({
      project_id: "project-1",
      updated_at: "2026-08-08T00:00:02.000Z",
    });
    const project = planProjectLinkProjectFixture();
    const task = planProjectLinkTaskFixture({ project_id: project.id, updated_at: plan.updated_at });
    installFetch(() => ({
      status: 201,
      body: {
        mode: "apply",
        action: "linked",
        plan,
        project,
        tasks: [task],
        receipt: { schema_version: "todos.plan-project-link.v1", task_count: 1 },
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudApplyPlanProjectLink(client, plan.id, project.id, {
      expected_plan_revision: "2026-08-08T00:00:00.000Z",
      expected_project_revision: project.updated_at,
      idempotency_key: "link-fixture",
    })).rejects.toThrow(/REMOTE_API_INCOMPATIBLE:.*todos\.plan-project-link\.v1 apply response/i);
  });

  test("plan-project-link apply rejects an HTTP 2xx plan operation", async () => {
    const plan = planProjectLinkPlanFixture();
    const project = planProjectLinkProjectFixture();
    const task = planProjectLinkTaskFixture();
    installFetch(() => ({
      body: { mode: "plan", action: "would_link", plan, project, tasks: [task], receipt: null },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudApplyPlanProjectLink(client, plan.id, project.id, {
      expected_plan_revision: plan.updated_at,
      expected_project_revision: project.updated_at,
      idempotency_key: "link-fixture",
    })).rejects.toThrow(/REMOTE_API_INCOMPATIBLE:.*todos\.plan-project-link\.v1 apply response/i);
  });

  test.each(["linked", "already_linked"] as const)(
    "plan-project-link apply accepts an exact %s response",
    async (action) => {
      const plan = planProjectLinkPlanFixture({
        project_id: "project-1",
        updated_at: "2026-08-08T00:00:02.000Z",
      });
      const project = planProjectLinkProjectFixture();
      const task = planProjectLinkTaskFixture({ project_id: project.id, updated_at: plan.updated_at });
      const receipt = planProjectLinkReceiptFixture(plan, [task]);
      installFetch(() => ({
        status: action === "linked" ? 201 : 200,
        body: { mode: "apply", action, plan, project, tasks: [task], receipt },
      }));
      const client = getTodosCloudClient(CLOUD_ENV)!;

      await expect(cloudApplyPlanProjectLink(client, plan.id, project.id, {
        expected_plan_revision: "2026-08-08T00:00:00.000Z",
        expected_project_revision: project.updated_at,
        idempotency_key: receipt.idempotency_key,
      })).resolves.toMatchObject({ mode: "apply", action, receipt });
    },
  );

  test("plan-project-link apply normalizes the idempotency key before POST and response validation", async () => {
    const plan = planProjectLinkPlanFixture({
      project_id: "project-1",
      updated_at: "2026-08-08T00:00:02.000Z",
    });
    const project = planProjectLinkProjectFixture();
    const task = planProjectLinkTaskFixture({ project_id: project.id, updated_at: plan.updated_at });
    const receipt = planProjectLinkReceiptFixture(plan, [task]);
    const calls = installFetch(() => ({
      status: 201,
      body: { mode: "apply", action: "linked", plan, project, tasks: [task], receipt },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudApplyPlanProjectLink(client, plan.id, project.id, {
      expected_plan_revision: "2026-08-08T00:00:00.000Z",
      expected_project_revision: project.updated_at,
      idempotency_key: `  ${receipt.idempotency_key}  `,
    })).resolves.toMatchObject({ mode: "apply", receipt });
    expect(calls[0]!.body).toMatchObject({ idempotency_key: receipt.idempotency_key });
  });

  test.each([
    ["the wrong schema", {
      schema_version: "wrong",
      action: "restored",
      plan: { id: "plan-1", project_id: null, updated_at: "2026-08-08T00:00:03.000Z" },
      tasks: [],
      accepted_receipt_id: "pplr_fixture",
      rollback_receipt_id: "pplr_inverse_fixture",
      restored_at: "2026-08-08T00:00:03.000Z",
    }],
    ["a mismatched accepted receipt", {
      schema_version: "todos.plan-project-link.v1",
      action: "restored",
      plan: { id: "plan-1", project_id: null, updated_at: "2026-08-08T00:00:03.000Z" },
      tasks: [{ id: "task-1", plan_id: "plan-1", project_id: null }],
      accepted_receipt_id: "other-receipt",
      rollback_receipt_id: "pplr_inverse_fixture",
      restored_at: "2026-08-08T00:00:03.000Z",
    }],
    ["a partial rollback envelope", {
      schema_version: "todos.plan-project-link.v1",
      action: "restored",
    }],
    ["the wrong rollback operation", {
      schema_version: "todos.plan-project-link.v1",
      action: "linked",
      plan: { id: "plan-1", project_id: null, updated_at: "2026-08-08T00:00:03.000Z" },
      tasks: [],
      accepted_receipt_id: "pplr_fixture",
      rollback_receipt_id: "pplr_inverse_fixture",
      restored_at: "2026-08-08T00:00:03.000Z",
    }],
  ])("plan-project-link rollback rejects HTTP 2xx carrying %s", async (_label, body) => {
    installFetch(() => ({ body }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudRollbackPlanProjectLink(client, "plan-1", "project-1", {
      receipt_id: "pplr_fixture",
      expected_plan_revision: "2026-08-08T00:00:02.000Z",
    })).rejects.toThrow(/REMOTE_API_INCOMPATIBLE:.*todos\.plan-project-link\.v1 rollback response/i);
  });

  test("plan-project-link rollback accepts the exact response envelope", async () => {
    const acceptedReceiptId = planProjectLinkReceiptId("link-fixture");
    const body = {
      schema_version: "todos.plan-project-link.v1",
      action: "restored",
      plan: planProjectLinkPlanFixture({ updated_at: "2026-08-08T00:00:03.000Z" }),
      tasks: [planProjectLinkTaskFixture({ updated_at: "2026-08-08T00:00:03.000Z" })],
      accepted_receipt_id: acceptedReceiptId,
      rollback_receipt_id: planProjectLinkRollbackReceiptId(acceptedReceiptId),
      restored_at: "2026-08-08T00:00:03.000Z",
    };
    installFetch(() => ({ body }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudRollbackPlanProjectLink(client, "plan-1", "project-1", {
      receipt_id: body.accepted_receipt_id,
      expected_plan_revision: "2026-08-08T00:00:02.000Z",
    })).resolves.toEqual(body);
  });

  test("task-list resolution preserves exact UUIDs and resolves project-scoped slugs and unique UUID prefixes", async () => {
    const listId = "abcdef12-1111-4111-8111-111111111111";
    const taskList = { id: listId, project_id: "project-1", slug: "release", name: "Release" };
    const calls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname === `/v1/task-lists/${listId}`) {
        return { body: { task_list: taskList } };
      }
      return { body: { task_lists: [taskList] } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudResolveTaskListRef(client, `  ${listId.toUpperCase()}  `))
      .resolves.toBe(listId);
    await expect(cloudResolveTaskListRef(client, "release", "project-1"))
      .resolves.toBe(listId);
    await expect(cloudResolveTaskListRef(
      client,
      `  ${listId.toUpperCase()}  `,
      "project-1",
    ))
      .resolves.toBe(listId);
    await expect(cloudResolveTaskListRef(client, "ABCDEF12"))
      .resolves.toBe(listId);
    expect(calls.map((call) => call.url)).toEqual([
      "https://todos.example.com/v1/task-lists?project_id=project-1",
      `https://todos.example.com/v1/task-lists/${listId}`,
      "https://todos.example.com/v1/task-lists",
    ]);
  });

  test.each([
    ["exact UUID", "09dc7e1d-7c20-4a52-b4fb-7675d7202f90"],
    ["project canonical slug", "todos-swiss-bank-account"],
  ])("resolves a legacy global task list through its owning project by %s", async (_label, ref) => {
    const projectId = "ccb079bb-385d-467c-873d-0bb00978b642";
    const listId = "09dc7e1d-7c20-4a52-b4fb-7675d7202f90";
    const slug = "todos-swiss-bank-account";
    const legacyList = {
      id: listId,
      project_id: null,
      slug,
      name: "Swiss Bank Account",
    };
    const calls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname === `/v1/task-lists/${listId}`) {
        return { body: { task_list: legacyList } };
      }
      if (url.pathname === `/v1/projects/${projectId}`) {
        return {
          body: {
            project: {
              id: projectId,
              name: "swiss-bank-account",
              path: "/workspace/swiss-bank-account",
              task_list_id: slug,
            },
          },
        };
      }
      if (url.pathname === "/v1/task-lists" && url.searchParams.get("project_id") === projectId) {
        return { body: { task_lists: [] } };
      }
      if (url.pathname === "/v1/task-lists") {
        return { body: { task_lists: [legacyList] } };
      }
      return { status: 404, body: { error: "not found" } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudResolveTaskListRef(client, ref, projectId)).resolves.toBe(listId);
    expect(calls.some((call) => call.url.includes(`/v1/projects/${projectId}`))).toBe(true);
  });

  test("does not attach an unrelated legacy global task list to a project", async () => {
    const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const listId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname === `/v1/task-lists/${listId}`) {
        return {
          body: {
            task_list: {
              id: listId,
              project_id: null,
              slug: "other-project",
              name: "Other Project",
            },
          },
        };
      }
      if (url.pathname === `/v1/projects/${projectId}`) {
        return {
          body: {
            project: {
              id: projectId,
              name: "Expected Project",
              path: "/workspace/expected-project",
              task_list_id: "expected-project",
            },
          },
        };
      }
      return { status: 404, body: { error: "not found" } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudResolveTaskListRef(client, listId, projectId))
      .rejects.toThrow(`Task list not found: "${listId}"`);
  });

  test("a rebind source resolves only unscoped — a foreign project scope rejects an unbound list", async () => {
    // `lists --update <id> --project <p>` (PR #260) rebinds the list INTO p.
    // The source list therefore lives OUTSIDE p, so the CLI must resolve the
    // source unscoped: scoping it to the destination would reject an unbound
    // source UUID ("Task list not found") or shadow it with a same-slug list
    // already in the destination. This pair guards that invariant: the scoped
    // form rejects, the unscoped form resolves.
    const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const unboundListId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const calls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname === `/v1/task-lists/${unboundListId}`) {
        return {
          body: {
            task_list: {
              id: unboundListId,
              project_id: null,
              slug: "wanderer",
              name: "Wanderer",
            },
          },
        };
      }
      return { status: 404, body: { error: "not found" } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudResolveTaskListRef(client, unboundListId, projectId))
      .rejects.toThrow(`Task list not found: "${unboundListId}"`);
    await expect(cloudResolveTaskListRef(client, unboundListId))
      .resolves.toBe(unboundListId);
    expect(calls.map((call) => call.url)).toEqual([
      `https://todos.example.com/v1/task-lists/${unboundListId}`,
      `https://todos.example.com/v1/projects/${projectId}`,
    ]);
  });

  test("an in-scope slug update resolves within the destination even when another project shares the slug", async () => {
    // The rebind resolution is scoped-first with an unscoped fallback: a slug
    // update inside the destination project must resolve to THAT project's
    // list even when a second project legally shares the slug (uniqueness is
    // project-scoped), which is why unscoped-first is a regression.
    const projectA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const projectB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const listA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const listB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const scopedCalls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname === `/v1/task-lists/${listA}`) {
        return { body: { task_list: { id: listA, project_id: projectA, slug: "inbox", name: "Inbox A" } } };
      }
      if (url.pathname === `/v1/task-lists/${listB}`) {
        return { body: { task_list: { id: listB, project_id: projectB, slug: "inbox", name: "Inbox B" } } };
      }
      if (url.pathname === "/v1/task-lists" && url.searchParams.get("project_id") === projectA) {
        return { body: { task_lists: [{ id: listA, project_id: projectA, slug: "inbox", name: "Inbox A" }] } };
      }
      if (url.pathname === "/v1/task-lists" && url.searchParams.get("project_id") === projectB) {
        return { body: { task_lists: [{ id: listB, project_id: projectB, slug: "inbox", name: "Inbox B" }] } };
      }
      if (url.pathname === "/v1/task-lists") {
        return { body: { task_lists: [
          { id: listA, project_id: projectA, slug: "inbox", name: "Inbox A" },
          { id: listB, project_id: projectB, slug: "inbox", name: "Inbox B" },
        ] } };
      }
      return { status: 404, body: { error: "not found" } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudResolveTaskListRef(client, "inbox", projectA))
      .resolves.toBe(listA);
    await expect(cloudResolveTaskListRef(client, "inbox", projectB))
      .resolves.toBe(listB);
    // Unscoped, the shared slug is ambiguous — the reason the CLI tries the
    // destination scope before falling back.
    await expect(cloudResolveTaskListRef(client, "inbox"))
      .rejects.toThrow(/not found|ambiguous/i);
    expect(scopedCalls.map((call) => call.url)).toEqual([
      `https://todos.example.com/v1/task-lists?project_id=${projectA}`,
      `https://todos.example.com/v1/task-lists?project_id=${projectB}`,
      `https://todos.example.com/v1/task-lists`,
    ]);
  });

  test("lists --update resolution: scoped miss falls back, transport error never does", async () => {
    // Exercises the production ordering the CLI action calls for
    // `lists --update <ref> --project <p>` (cloudResolveTaskListForUpdate):
    // - a confirmed scoped miss falls back unscoped so an unbound source can
    //   still be rebound;
    // - a scoped HTTP 500 (REMOTE_API_UNAVAILABLE) PROPAGATES — falling back
    //   unscoped there could resolve another project's list and mutate the
    //   wrong target, which the fallback must never do;
    // - a UUID source resolves through the fetch-free unscoped fast path, so
    //   no transport error can even be raised on it.
    const projectA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const unboundListId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const missCalls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname === "/v1/task-lists" && url.searchParams.get("project_id") === projectA) {
        return { body: { task_lists: [] } };
      }
      if (url.pathname === "/v1/task-lists") {
        return { body: { task_lists: [{ id: unboundListId, project_id: null, slug: "wanderer", name: "Wanderer" }] } };
      }
      return { status: 404, body: { error: "not found" } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    // Confirmed scoped miss (empty scope -> not found) falls back unscoped.
    await expect(cloudResolveTaskListForUpdate(client, "wanderer", projectA, true))
      .resolves.toBe(unboundListId);
    expect(missCalls.map((call) => call.url)).toEqual([
      `https://todos.example.com/v1/task-lists?project_id=${projectA}`,
      `https://todos.example.com/v1/projects/${projectA}`,
      `https://todos.example.com/v1/task-lists`,
    ]);

    // Scoped HTTP 500 must propagate: no unscoped retry, no wrong-target PATCH.
    installFetch(() => ({ status: 500, body: { error: "boom" } }));
    await expect(cloudResolveTaskListForUpdate(client, "wanderer", projectA, true))
      .rejects.toThrow(/REMOTE_API_UNAVAILABLE/);

    // UUID source: fetch-free unscoped fast path — resolves even when the
    // authority is erroring, and can never be shadowed by the destination.
    await expect(cloudResolveTaskListForUpdate(client, unboundListId, projectA, true))
      .resolves.toBe(unboundListId);
  });

  test("lists --update resolution: in-scope slug wins, outside-source slug falls back", async () => {
    const projectA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const projectB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const listA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const listB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const calls = installFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname === "/v1/task-lists" && url.searchParams.get("project_id") === projectA) {
        return { body: { task_lists: [{ id: listA, project_id: projectA, slug: "inbox", name: "Inbox A" }] } };
      }
      if (url.pathname === "/v1/task-lists" && url.searchParams.get("project_id") === projectB) {
        return { body: { task_lists: [{ id: listB, project_id: projectB, slug: "inbox", name: "Inbox B" }] } };
      }
      if (url.pathname === "/v1/task-lists") {
        return { body: { task_lists: [
          { id: listA, project_id: projectA, slug: "inbox", name: "Inbox A" },
          { id: listB, project_id: projectB, slug: "roamer", name: "Roamer" },
        ] } };
      }
      return { status: 404, body: { error: "not found" } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;

    // In-scope update: resolves within the destination, never ambiguous even
    // though project B shares the slug.
    await expect(cloudResolveTaskListForUpdate(client, "inbox", projectA, true))
      .resolves.toBe(listA);
    // Rebind of a source genuinely outside the destination: scoped miss in A
    // (A has no list with this slug) falls back unscoped and resolves B's list.
    await expect(cloudResolveTaskListForUpdate(client, "roamer", projectA, true))
      .resolves.toBe(listB);
    // Without an explicit project the scope comes from context; resolution
    // must still work within it.
    await expect(cloudResolveTaskListForUpdate(client, "inbox", projectB, false))
      .resolves.toBe(listB);
    expect(calls.map((call) => call.url)).toEqual([
      `https://todos.example.com/v1/task-lists?project_id=${projectA}`,
      `https://todos.example.com/v1/task-lists?project_id=${projectA}`,
      `https://todos.example.com/v1/projects/${projectA}`,
      `https://todos.example.com/v1/task-lists`,
      `https://todos.example.com/v1/task-lists?project_id=${projectB}`,
    ]);
  });

  test("project-scoped plan resolution rejects an exact UUID from another project", async () => {
    const planId = "77777777-7777-4777-8777-777777777777";
    const calls = installFetch((call) => {
      if (call.url.endsWith(`/plans/${planId}`)) {
        return { body: { plan: { id: planId, project_id: "project-b", slug: "foreign", name: "Foreign" } } };
      }
      return { body: { plans: [] } };
    });
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudResolvePlan(client, planId, "project-a")).resolves.toBeNull();
    expect(calls.map((call) => call.url)).toEqual([
      `https://todos.example.com/v1/plans/${planId}`,
      "https://todos.example.com/v1/plans?project_id=project-a",
    ]);
  });

  test("task-list resolution fails explicitly for missing and ambiguous references", async () => {
    installFetch(() => ({
      body: {
        task_lists: [
          { id: "aaaaaaaa-1111-4111-8111-111111111111", project_id: "project-1", slug: "shared", name: "Shared A" },
          { id: "aaaaaaaa-2222-4222-8222-222222222222", project_id: "project-1", slug: "shared", name: "Shared B" },
        ],
      },
    }));
    const client = getTodosCloudClient(CLOUD_ENV)!;

    await expect(cloudResolveTaskListRef(client, "missing", "project-1"))
      .rejects.toThrow('Task list not found: "missing"');
    await expect(cloudResolveTaskListRef(client, "shared", "project-1"))
      .rejects.toThrow('Task list reference is ambiguous: "shared"');
    await expect(cloudResolveTaskListRef(client, "aaaaaaaa", "project-1"))
      .rejects.toThrow('Task list reference is ambiguous: "aaaaaaaa"');
  });

  test("force unlock sends an explicit force flag instead of spoofing the lock holder", async () => {
    const calls = installFetch(() => ({ body: { success: true } }));
    const client = getTodosCloudClient(CLOUD_ENV)!;
    await expect(cloudUnlockTask(client, "task-1", undefined, true)).resolves.toBe(true);
    expect(calls[0]!.body).toEqual({ force: true });
  });
});

describe("requireTodosRemoteAuthorityEnv", () => {
  test("no longer stamps any storage-mode variable", () => {
    const env = requireTodosRemoteAuthorityEnv(CLOUD_ENV);

    expect("HASNA_TODOS_STORAGE_MODE" in env).toBe(false);
    expect("TODOS_STORAGE_MODE" in env).toBe(false);
  });

  test("leaves the URL rewrite and the key trim untouched", () => {
    // The `/v1` suffix must be stripped back off (the status object appends it
    // and the client re-appends it, so a doubled suffix would point the CLI at
    // /v1/v1), and the key must still be trimmed.
    const env = requireTodosRemoteAuthorityEnv({
      ...CLOUD_ENV,
      HASNA_TODOS_API_KEY: `  ${CLOUD_ENV.HASNA_TODOS_API_KEY}  `,
    });

    expect(env.HASNA_TODOS_API_URL).toBe("https://todos.example.com");
    expect(env.HASNA_TODOS_API_URL).not.toMatch(/\/v1$/);
    expect(env.HASNA_TODOS_API_KEY).toBe(CLOUD_ENV.HASNA_TODOS_API_KEY);
  });

  test("still refuses a half-configured authority", () => {
    // The no-local-fallback guarantee is unchanged: a partial API pair is a
    // hard error naming the missing variable.
    expect(() =>
      requireTodosRemoteAuthorityEnv({
        HASNA_TODOS_API_URL: "https://todos.example.com",
      }),
    ).toThrow(/REMOTE_API_KEY_MISSING/);
    // A retired storage-mode variable is inert: the partial API pair still
    // refuses, naming the missing variable, never the stale fragment.
    expect(() =>
      requireTodosRemoteAuthorityEnv({
        HASNA_TODOS_STORAGE_MODE: "cloud",
        HASNA_TODOS_API_URL: "https://todos.example.com",
      }),
    ).toThrow(/REMOTE_API_KEY_MISSING/);
  });

  test("passes every other variable through unchanged", () => {
    const env = requireTodosRemoteAuthorityEnv({ ...CLOUD_ENV, UNRELATED_VAR: "kept" });

    expect(env.UNRELATED_VAR).toBe("kept");
  });
});

describe("local-fallback notice (incident 715712)", () => {
  // Regression: a harness session-env re-provision dropped HASNA_TODOS_API_URL
  // + HASNA_TODOS_API_KEY and the CLI silently served the on-box SQLite store
  // at rc=0 — tasks appeared gone. Before serving local on the all-unset
  // default branch, the resolver must emit one machine-readable stderr notice
  // naming the mode switch (the same family as the merged secrets fix, PR
  // #681 / incident 715558).

  test("all-unset emits one stderr notice naming the mode switch before serving local", () => {
    resetTodosLocalFallbackNotice();
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const resolution = resolveTodosCliTransport({});
      expect(resolution).toEqual({
        transport: "sqlite",
        selected: false,
        source: "default",
        apiUrlSource: null,
        apiKeySource: null,
        apiUrl: null,
      });
      expect(errSpy).toHaveBeenCalledTimes(1);
      const notice = JSON.parse(errSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
      expect(notice.event).toBe("todos-local-fallback");
      expect(notice.notice).toContain("HASNA_TODOS_API_URL");
      expect(notice.notice).toContain("HASNA_TODOS_API_KEY");
      expect(notice.notice).toContain("local SQLite");
      expect(notice.apiUrlPresent).toBe(false);
      expect(notice.apiKeyPresent).toBe(false);
      // Once-only per process: repeated local resolutions stay silent.
      resolveTodosCliTransport({});
      expect(errSpy).toHaveBeenCalledTimes(1);
    } finally {
      errSpy.mockRestore();
    }
  });

  test("hosted pair selects http and emits no fallback notice", () => {
    resetTodosLocalFallbackNotice();
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const resolution = resolveTodosCliTransport({
        HASNA_TODOS_API_URL: "https://todos.example.test",
        HASNA_TODOS_API_KEY: "fixture-key",
      });
      expect(resolution.transport).toBe("http");
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  test("partial pair still fails closed and emits no notice", () => {
    resetTodosLocalFallbackNotice();
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => resolveTodosCliTransport({ HASNA_TODOS_API_URL: "https://todos.example.test" }))
        .toThrow("REMOTE_API_KEY_MISSING");
      expect(() => resolveTodosCliTransport({ HASNA_TODOS_API_KEY: "fixture-key" }))
        .toThrow("REMOTE_API_URL_MISSING");
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });
});
