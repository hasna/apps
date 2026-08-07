import { describe, expect, test } from "bun:test";
import { mintApiKey } from "@hasna/contracts/auth";
import { createFetchHandler } from "./app.js";
import { NotFoundError, ProjectsPgStore, ValidationError } from "./pg-store.js";
import type { Workspace } from "../types/workspace.js";

const SIGNING_SECRET = "test-signing-secret-projects-0000000000";

function fakeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "wks_test1",
    slug: "demo",
    name: "Demo",
    description: null,
    kind: "generic",
    status: "active",
    root_id: null,
    recipe_id: null,
    canonical_machine: null,
    primary_path: null,
    git_remote: null,
    s3_bucket: null,
    s3_prefix: null,
    tags: [],
    integrations: {},
    metadata: {},
    last_opened_at: null,
    created_at: "2026-07-06 00:00:00",
    updated_at: "2026-07-06 00:00:00",
    synced_at: null,
    ...overrides,
  };
}

/** Minimal fake store — exercises routing/auth without a live Postgres. */
function fakeStore(): ProjectsPgStore {
  const created: Workspace[] = [];
  return {
    async ping() {
      return true;
    },
    async listWorkspaces() {
      return created;
    },
    async countWorkspaces() {
      return created.length;
    },
    async createWorkspace(input: { name: string; slug?: string }) {
      const ws = fakeWorkspace({ id: `wks_${created.length + 1}`, name: input.name, slug: input.slug ?? "demo" });
      created.push(ws);
      return ws;
    },
    async requireWorkspace(id: string) {
      const ws = created.find((w) => w.id === id || w.slug === id);
      if (!ws) throw new NotFoundError(`Workspace not found: ${id}`);
      return ws;
    },
    async recordEvent(input: { workspace_id?: string; event_type: string; source: string }) {
      return {
        id: "evt_1",
        workspace_id: input.workspace_id ?? null,
        agent_id: null,
        event_type: input.event_type,
        source: input.source,
        prompt: null,
        command: null,
        before_json: null,
        after_json: null,
        metadata: {},
        created_at: "2026-07-06 00:00:00",
      };
    },
    async listRoots() {
      return [];
    },
  } as unknown as ProjectsPgStore;
}

function handler() {
  return createFetchHandler({ store: fakeStore(), version: "9.9.9", app: "projects", signingSecret: SIGNING_SECRET });
}

function keyWith(scopes: string[]): string {
  return mintApiKey({ app: "projects", scopes, signingSecret: SIGNING_SECRET }).token;
}

describe("projects-serve probes", () => {
  test("GET /health returns status/version/mode", async () => {
    const res = await handler()(new Request("http://x/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", version: "9.9.9", mode: "cloud" });
  });

  test("GET /version returns version", async () => {
    const res = await handler()(new Request("http://x/version"));
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe("9.9.9");
  });

  test("GET /ready returns ready when db pings", async () => {
    const res = await handler()(new Request("http://x/ready"));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ready");
  });

  test("GET /openapi.json serves the spec", async () => {
    const res = await handler()(new Request("http://x/openapi.json"));
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/v1/projects"]).toBeDefined();
    expect(spec.paths["/v1/projects/{id}/guarded-metadata"].get.operationId).toBe("guardedReadProject");
    expect(spec.paths["/v1/projects/{id}/guarded-metadata"].post.operationId).toBe("guardedUpdateProject");
    expect(spec.paths["/v1/projects/{id}/guarded-metadata/receipts"].get.operationId).toBe("lookupGuardedProjectMutationReceipt");
    expect(spec.paths["/v1/projects/{id}/guarded-metadata/rollback"].post.operationId).toBe("rollbackGuardedProjectMutation");
    expect(spec.components.schemas.GuardedProjectRead.required).toContain("project");
    expect(spec.components.schemas.Workspace.required).toEqual(expect.arrayContaining([
      "s3_bucket",
      "s3_prefix",
      "last_opened_at",
      "synced_at",
    ]));
    expect(spec.components.schemas.GuardedProjectMutationResult.properties.after.anyOf).toEqual([
      { $ref: "#/components/schemas/Workspace" },
      { type: "null" },
    ]);
    expect(spec.components.schemas.GuardedProjectMutationResult.properties.receipt.anyOf).toEqual([
      { $ref: "#/components/schemas/GuardedProjectMutationReceipt" },
      { type: "null" },
    ]);
  });
});

describe("projects-serve auth", () => {
  test("/v1 without a key is 401", async () => {
    const res = await handler()(new Request("http://x/v1/projects"));
    expect(res.status).toBe(401);
  });

  test("/v1 with a wrong-app key is rejected", async () => {
    const token = mintApiKey({ app: "todos", scopes: ["todos:*"], signingSecret: SIGNING_SECRET }).token;
    const res = await handler()(new Request("http://x/v1/projects", { headers: { "x-api-key": token } }));
    expect(res.status).toBe(401);
  });

  test("read scope allows GET but not POST", async () => {
    const h = handler();
    const token = keyWith(["projects:read"]);
    const listRes = await h(new Request("http://x/v1/projects", { headers: { "x-api-key": token } }));
    expect(listRes.status).toBe(200);
    const postRes = await h(
      new Request("http://x/v1/projects", {
        method: "POST",
        headers: { "x-api-key": token, "content-type": "application/json" },
        body: JSON.stringify({ name: "Nope" }),
      }),
    );
    expect(postRes.status).toBe(403);
  });

  test("wildcard key can create and read back a project", async () => {
    const h = handler();
    const token = keyWith(["projects:*"]);
    const create = await h(
      new Request("http://x/v1/projects", {
        method: "POST",
        headers: { "x-api-key": token, "content-type": "application/json" },
        body: JSON.stringify({ name: "Alpha", slug: "alpha" }),
      }),
    );
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.name).toBe("Alpha");

    const get = await h(new Request(`http://x/v1/projects/${created.id}`, { headers: { "x-api-key": token } }));
    expect(get.status).toBe(200);
    expect((await get.json()).slug).toBe("alpha");
  });

  test("POST /v1/projects/:id/events records an event (write scope)", async () => {
    const h = handler();
    const token = keyWith(["projects:*"]);
    const create = await h(
      new Request("http://x/v1/projects", {
        method: "POST",
        headers: { "x-api-key": token, "content-type": "application/json" },
        body: JSON.stringify({ name: "Beta", slug: "beta" }),
      }),
    );
    const created = await create.json();
    const post = await h(
      new Request(`http://x/v1/projects/${created.id}/events`, {
        method: "POST",
        headers: { "x-api-key": token, "content-type": "application/json" },
        body: JSON.stringify({ event_type: "note", source: "mcp", metadata: { k: 1 } }),
      }),
    );
    expect(post.status).toBe(201);
    expect((await post.json()).event.event_type).toBe("note");
  });

  test("POST events requires event_type and write scope", async () => {
    const h = handler();
    const writeToken = keyWith(["projects:*"]);
    const create = await h(
      new Request("http://x/v1/projects", {
        method: "POST",
        headers: { "x-api-key": writeToken, "content-type": "application/json" },
        body: JSON.stringify({ name: "Gamma", slug: "gamma" }),
      }),
    );
    const created = await create.json();
    const missingType = await h(
      new Request(`http://x/v1/projects/${created.id}/events`, {
        method: "POST",
        headers: { "x-api-key": writeToken, "content-type": "application/json" },
        body: JSON.stringify({ source: "mcp" }),
      }),
    );
    expect(missingType.status).toBe(400);
    const readToken = keyWith(["projects:read"]);
    const forbidden = await h(
      new Request(`http://x/v1/projects/${created.id}/events`, {
        method: "POST",
        headers: { "x-api-key": readToken, "content-type": "application/json" },
        body: JSON.stringify({ event_type: "note", source: "mcp" }),
      }),
    );
    expect(forbidden.status).toBe(403);
  });

  test("POST guarded metadata mutation returns explicit bounded complete JSON envelope", async () => {
    const calls: Array<{ project_id: string; operation_id: string }> = [];
    const store = {
      async ping() {
        return true;
      },
      async guardedUpdateWorkspace(input: { project_id: string; operation_id: string; response_byte_limit: number; time_budget_ms: number }) {
        calls.push({ project_id: input.project_id, operation_id: input.operation_id });
        return {
          ok: true,
          dry_run: false,
          outcome: "accepted",
          idempotency_key: "gpm_test",
          request_digest: "req",
          precondition_digest: "pre",
          project_id: input.project_id,
          expected_revision: "2026-08-07 00:00:00.000",
          current_revision: "2026-08-07 00:00:00.000",
          before: fakeWorkspace({ id: input.project_id, name: "Before" }),
          after: fakeWorkspace({ id: input.project_id, name: "After" }),
          receipt: {
            receipt_id: "gpmr_test",
            operation_id: input.operation_id,
            step_id: "rename",
            direction: "forward",
            idempotency_key: "gpm_test",
            target_id: input.project_id,
            request_digest: "req",
            precondition_digest: "pre",
            expected_revision: "2026-08-07 00:00:00.000",
            outcome: "accepted",
            reason: null,
            result_project_id: input.project_id,
            duplicate_of_receipt_id: null,
            before: {},
            after: {},
            post_revision: "2026-08-07 00:00:01.000",
            created_at: "2026-08-07 00:00:01.000",
          },
          response_control: {
            response_byte_limit: input.response_byte_limit,
            time_budget_ms: input.time_budget_ms,
            response_bytes: 1,
            elapsed_ms: 0,
            complete: true,
            truncated: false,
          },
        };
      },
    } as unknown as ProjectsPgStore;
    const h = createFetchHandler({ store, version: "9.9.9", app: "projects", signingSecret: SIGNING_SECRET });
    const token = keyWith(["projects:*"]);
    const res = await h(
      new Request("http://x/v1/projects/wks_httpguarded0001/guarded-metadata", {
        method: "POST",
        headers: { "x-api-key": token, "content-type": "application/json" },
        body: JSON.stringify({
          operation_id: "op-http",
          step_id: "rename",
          expected_revision: "2026-08-07 00:00:00.000",
          patch: { name: "After" },
          response_byte_limit: 50_000,
          time_budget_ms: 2_000,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(calls).toEqual([{ project_id: "wks_httpguarded0001", operation_id: "op-http" }]);
    expect(body.outcome).toBe("accepted");
    expect(body.response_control.complete).toBe(true);
    expect(body.response_control.truncated).toBe(false);
    expect(body.response_control.response_bytes).toBeGreaterThan(0);
    expect(body.response_control.response_byte_limit).toBe(50_000);
  });

  test("GET guarded metadata receipt lookup returns the exact receipt instead of the guarded-read envelope", async () => {
    const projectId = "wks_httpguarded0001";
    const receiptId = "gpmr_57183a0201f44adbc903011493be510f";
    const lookupCalls: Array<Record<string, unknown>> = [];
    let guardedReadCalls = 0;
    const store = {
      async ping() {
        return true;
      },
      async guardedReadWorkspace() {
        guardedReadCalls += 1;
        throw new Error("guarded read route must not handle receipt lookup");
      },
      async lookupGuardedWorkspaceMutationReceipt(input: Record<string, unknown>) {
        lookupCalls.push(input);
        return {
          receipt: {
            receipt_id: receiptId,
            operation_id: input.operation_id,
            step_id: input.step_id,
            direction: input.direction,
            idempotency_key: input.idempotency_key,
            target_id: input.project_id,
            request_digest: "req",
            precondition_digest: "pre",
            expected_revision: "2026-08-07 11:41:58.001",
            outcome: "accepted",
            reason: null,
            result_project_id: input.project_id,
            duplicate_of_receipt_id: null,
            before: { name: "Monthly Accounting" },
            after: { name: "Monthly Filing" },
            post_revision: "2026-08-07 11:42:01.569",
            created_at: "2026-08-07 11:42:01.570",
          },
          response_control: {
            response_byte_limit: input.response_byte_limit,
            time_budget_ms: input.time_budget_ms,
            response_bytes: 1,
            elapsed_ms: 0,
            complete: true,
            truncated: false,
          },
        };
      },
    } as unknown as ProjectsPgStore;
    const h = createFetchHandler({ store, version: "9.9.9", app: "projects", signingSecret: SIGNING_SECRET });
    const token = keyWith(["projects:read"]);
    const query = new URLSearchParams({
      operation_id: "project-rename-wks_httpguarded0001-20260807",
      step_id: "metadata-to-monthly-filing",
      direction: "forward",
      idempotency_key: "gpm_project-rename-wks_httpguarded0001-20260807",
      max_items: "1",
      response_byte_limit: "16384",
      time_budget_ms: "5000",
    });
    const res = await h(new Request(
      `http://x/v1/projects/${projectId}/guarded-metadata/receipts?${query}`,
      { headers: { "x-api-key": token } },
    ));

    expect(res.status).toBe(200);
    expect(guardedReadCalls).toBe(0);
    expect(lookupCalls).toEqual([{
      project_id: projectId,
      operation_id: "project-rename-wks_httpguarded0001-20260807",
      step_id: "metadata-to-monthly-filing",
      direction: "forward",
      idempotency_key: "gpm_project-rename-wks_httpguarded0001-20260807",
      max_items: 1,
      response_byte_limit: 16_384,
      time_budget_ms: 5_000,
    }]);
    const body = await res.json();
    expect(body.receipt.receipt_id).toBe(receiptId);
    expect(body.receipt.post_revision).toBe("2026-08-07 11:42:01.569");
    expect(body.project_id).toBeUndefined();
    expect(body.current_revision).toBeUndefined();
    expect(body.response_control.complete).toBe(true);
    expect(body.response_control.truncated).toBe(false);
  });

  test("GET guarded metadata receipt lookup preserves not-found, cardinality, and bounds failures", async () => {
    const failures = [
      "guarded receipt lookup expected exactly one terminal receipt, found 0",
      "guarded receipt lookup expected exactly one terminal result, found 2",
      "guarded receipt lookup max_items must be exactly 1",
      "guarded mutation response byte budget exceeded",
    ];
    const token = keyWith(["projects:read"]);

    for (const message of failures) {
      let guardedReadCalls = 0;
      const store = {
        async ping() {
          return true;
        },
        async guardedReadWorkspace() {
          guardedReadCalls += 1;
          throw new Error("guarded read route must not handle receipt lookup failures");
        },
        async lookupGuardedWorkspaceMutationReceipt() {
          throw new ValidationError(message);
        },
      } as unknown as ProjectsPgStore;
      const h = createFetchHandler({ store, version: "9.9.9", app: "projects", signingSecret: SIGNING_SECRET });
      const query = new URLSearchParams({
        operation_id: "op-http",
        step_id: "rename",
        direction: "forward",
        idempotency_key: "gpm_http",
        max_items: "1",
        response_byte_limit: "16384",
        time_budget_ms: "5000",
      });
      const res = await h(new Request(
        `http://x/v1/projects/wks_httpguarded0001/guarded-metadata/receipts?${query}`,
        { headers: { "x-api-key": token } },
      ));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: message });
      expect(guardedReadCalls).toBe(0);
    }
  });

  test("GET guarded metadata reads one exact id with producer bounds and revision envelope", async () => {
    const projectId = "wks_httpguarded0001";
    const calls: Array<{ project_id: string; response_byte_limit: number; time_budget_ms: number }> = [];
    const store = {
      async ping() {
        return true;
      },
      async guardedReadWorkspace(input: { project_id: string; response_byte_limit: number; time_budget_ms: number }) {
        calls.push(input);
        return {
          ok: true,
          project_id: input.project_id,
          project: fakeWorkspace({ id: input.project_id, slug: "guarded-read", name: "Guarded Read" }),
          current_revision: "2026-08-07 00:00:01",
          response_control: {
            response_byte_limit: input.response_byte_limit,
            time_budget_ms: input.time_budget_ms,
            response_bytes: 512,
            elapsed_ms: 1,
            complete: true,
            truncated: false,
          },
        };
      },
    } as unknown as ProjectsPgStore;
    const h = createFetchHandler({ store, version: "9.9.9", app: "projects", signingSecret: SIGNING_SECRET });
    const token = keyWith(["projects:read"]);
    const res = await h(new Request(
      `http://x/v1/projects/${projectId}/guarded-metadata?response_byte_limit=16384&time_budget_ms=5000`,
      { headers: { "x-api-key": token } },
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(calls).toEqual([{ project_id: projectId, response_byte_limit: 16_384, time_budget_ms: 5_000 }]);
    expect(body.project_id).toBe(projectId);
    expect(body.project).toMatchObject({ id: projectId, slug: "guarded-read", name: "Guarded Read" });
    expect(body.current_revision).toBe("2026-08-07 00:00:01");
    expect(body.response_control.complete).toBe(true);
    expect(body.response_control.truncated).toBe(false);
  });

  test("POST guarded metadata rollback is not shadowed by the generic guarded update route", async () => {
    const projectId = "wks_httpguarded0001";
    let guardedUpdateCalls = 0;
    const rollbackCalls: Array<Record<string, unknown>> = [];
    const store = {
      async ping() {
        return true;
      },
      async guardedUpdateWorkspace() {
        guardedUpdateCalls += 1;
        throw new Error("guarded update route must not handle rollback");
      },
      async rollbackGuardedWorkspaceMutation(input: Record<string, unknown>) {
        rollbackCalls.push(input);
        return {
          ok: true,
          dry_run: false,
          outcome: "accepted",
          idempotency_key: "gpm_inverse",
          request_digest: "req-inverse",
          precondition_digest: "pre-inverse",
          project_id: input.project_id,
          expected_revision: input.expected_current_revision,
          current_revision: input.expected_current_revision,
          before: fakeWorkspace({ id: projectId, name: "Monthly Filing" }),
          after: fakeWorkspace({ id: projectId, name: "Monthly Accounting" }),
          receipt: {
            receipt_id: "gpmr_inverse",
            operation_id: input.operation_id,
            step_id: input.step_id,
            direction: "inverse",
            idempotency_key: "gpm_inverse",
            target_id: input.project_id,
            request_digest: "req-inverse",
            precondition_digest: "pre-inverse",
            expected_revision: input.expected_current_revision,
            outcome: "accepted",
            reason: null,
            result_project_id: input.project_id,
            duplicate_of_receipt_id: null,
            before: {},
            after: {},
            post_revision: "2026-08-07 11:43:00.000",
            created_at: "2026-08-07 11:43:00.001",
          },
          response_control: {
            response_byte_limit: input.response_byte_limit,
            time_budget_ms: input.time_budget_ms,
            response_bytes: 1,
            elapsed_ms: 0,
            complete: true,
            truncated: false,
          },
        };
      },
    } as unknown as ProjectsPgStore;
    const h = createFetchHandler({ store, version: "9.9.9", app: "projects", signingSecret: SIGNING_SECRET });
    const token = keyWith(["projects:*"]);
    const body = {
      operation_id: "project-rollback-wks_httpguarded0001-20260807",
      step_id: "metadata-from-monthly-filing",
      accepted_receipt_id: "gpmr_57183a0201f44adbc903011493be510f",
      expected_current_revision: "2026-08-07 11:42:01.569",
      response_byte_limit: 16_384,
      time_budget_ms: 5_000,
    };
    const res = await h(new Request(
      `http://x/v1/projects/${projectId}/guarded-metadata/rollback`,
      {
        method: "POST",
        headers: { "x-api-key": token, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ));

    expect(res.status).toBe(200);
    expect(guardedUpdateCalls).toBe(0);
    expect(rollbackCalls).toEqual([{ ...body, project_id: projectId }]);
    expect((await res.json()).outcome).toBe("accepted");
  });

  test("Authorization: Bearer scheme is accepted", async () => {
    const token = keyWith(["projects:read"]);
    const res = await handler()(
      new Request("http://x/v1/roots", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(res.status).toBe(200);
  });

  test("missing resource under /v1 is 404 (authenticated)", async () => {
    const token = keyWith(["projects:*"]);
    const res = await handler()(new Request("http://x/v1/nope", { headers: { "x-api-key": token } }));
    expect(res.status).toBe(404);
  });
});

// Regression for dc3ba294: the list envelope carried only `count` (the page
// length), so a client had no way to tell a server-capped page from the whole
// set — `projects list --json` returned 939 of 2399 rows with rc=0 and no
// signal. The response now reports the match total and an explicit has_more.
describe("projects-serve list envelope (truncation must be detectable)", () => {
  function pagedHandler(total: number, cap: number) {
    const rows = Array.from({ length: total }, (_, i) => fakeWorkspace({ id: `wks_${i}`, slug: `p-${i}` }));
    const store = {
      async ping() {
        return true;
      },
      async listWorkspaces(filter: { limit?: number; offset?: number } = {}) {
        const limit = Math.min(Math.max(filter.limit ?? 100, 1), cap);
        const offset = Math.max(filter.offset ?? 0, 0);
        return rows.slice(offset, offset + limit);
      },
      async countWorkspaces() {
        return rows.length;
      },
    } as unknown as ProjectsPgStore;
    return createFetchHandler({ store, version: "9.9.9", app: "projects", signingSecret: SIGNING_SECRET });
  }

  test("a capped page reports total and has_more, not just count", async () => {
    const res = await pagedHandler(2399, 1000)(
      new Request("http://x/v1/projects?limit=100000", { headers: { "x-api-key": keyWith(["projects:read"]) } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1000);
    expect(body.total).toBe(2399);
    expect(body.limit).toBe(1000); // the clamp is reported, not hidden
    expect(body.has_more).toBe(true);
  });

  test("the final page reports has_more false", async () => {
    const res = await pagedHandler(2399, 1000)(
      new Request("http://x/v1/projects?limit=1000&offset=2000", {
        headers: { "x-api-key": keyWith(["projects:read"]) },
      }),
    );
    const body = await res.json();
    expect(body.count).toBe(399);
    expect(body.total).toBe(2399);
    expect(body.offset).toBe(2000);
    expect(body.has_more).toBe(false);
  });
});
