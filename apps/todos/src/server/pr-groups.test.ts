import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/schema.js";
import { PrGroupLedger } from "../pr-groups/ledger.js";
import { SqlitePrGroupLedgerPersistence } from "../pr-groups/sqlite.js";
import type { PrGroupLedgerPersistence } from "../pr-groups/types.js";
import { TodosV1Client } from "../sdk/v1.generated.js";
import { buildV1OpenApiDocument } from "./openapi.js";
import { handlePrGroupHttpRequest } from "./pr-groups.js";

function remoteLedger(db: Database): PrGroupLedger {
  const local = new SqlitePrGroupLedgerPersistence(db);
  const persistence: PrGroupLedgerPersistence = {
    authority: "remote",
    transaction: (fn) => local.transaction(fn),
    getGroup: (id) => local.getGroup(id),
    listAttempts: (id) => local.listAttempts(id),
    listEvents: (id, options) => local.listEvents(id, options),
    listReceiptEvents: (id, limit) => local.listReceiptEvents(id, limit),
    countEvents: (id) => local.countEvents(id),
    getLatestEvent: (id) => local.getLatestEvent(id),
  };
  return new PrGroupLedger(persistence);
}

async function call(
  ledger: PrGroupLedger,
  prefix: "/api/pr-groups" | "/v1/pr-groups",
  suffix: string,
  method = "GET",
  body?: unknown,
  principal?: { actor_id: string; actor_run_id?: string },
): Promise<Response> {
  const url = new URL(`https://todos.example.test${prefix}${suffix}`);
  return (await handlePrGroupHttpRequest(new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), url, ledger, prefix, principal))!;
}

describe("shared local and cloud PR-group HTTP contract", () => {
  let localDb: Database;
  let remoteDb: Database;
  let local: PrGroupLedger;
  let remote: PrGroupLedger;

  beforeEach(() => {
    localDb = new Database(":memory:");
    remoteDb = new Database(":memory:");
    for (const db of [localDb, remoteDb]) {
      db.exec("PRAGMA foreign_keys = ON");
      runMigrations(db);
    }
    local = new PrGroupLedger(new SqlitePrGroupLedgerPersistence(localDb));
    remote = remoteLedger(remoteDb);
  });

  afterEach(() => {
    localDb.close();
    remoteDb.close();
  });

  test("uses equivalent authoritative behavior and envelopes for /api and /v1", async () => {
    const input = {
      root_request_id: "request-root",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task",
      dispatch_attempt: "dispatch-1",
      writer_generation: "generation-1",
      worktree: "/tmp/pr-group",
      branch: "feat/pr-group",
      pr_number: 78,
      base_sha: "b".repeat(40),
      provider: "codewith",
      provider_run_id: "run-1",
      profile_alias: "account012",
      admitted_at: "2026-07-23T10:00:00.000Z",
    };
    const [localAdmission, remoteAdmission] = await Promise.all([
      call(local, "/api/pr-groups", "/admit", "POST", input),
      call(remote, "/v1/pr-groups", "/admit", "POST", input),
    ]);
    expect(localAdmission.status).toBe(201);
    expect(remoteAdmission.status).toBe(201);
    const localBody = await localAdmission.json() as Record<string, any>;
    const remoteBody = await remoteAdmission.json() as Record<string, any>;
    expect(remoteBody.view.authority).toBe("remote");
    expect(localBody.view.authority).toBe("local");
    expect(remoteBody.view.group).toEqual(localBody.view.group);
    expect(remoteBody.view.attempts).toEqual(localBody.view.attempts);
    expect(remoteBody.event).toEqual(localBody.event);

    const groupId = localBody.view.group.id as string;
    const attemptId = localBody.view.attempts[0].id as string;
    for (const [ledger, prefix] of [
      [local, "/api/pr-groups"],
      [remote, "/v1/pr-groups"],
    ] as const) {
      expect((await call(ledger, prefix, `/${groupId}/events`, "POST", {
        attempt_id: attemptId,
        writer_generation: "generation-1",
        idempotency_key: "progress-1",
        event_type: "progress",
        created_at: "2026-07-23T10:01:00.000Z",
      })).status).toBe(201);
      const state = await call(ledger, prefix, `/${groupId}`);
      expect(await state.json()).toMatchObject({
        view: { authoritative: true, group: { state: "in_progress" } },
      });
      const history = await call(ledger, prefix, `/${groupId}/events?limit=1`);
      expect(await history.json()).toMatchObject({
        history: { authoritative: true, count: 1, has_more: true },
      });
    }
  });

  test("returns the same stable fenced error instead of partial success", async () => {
    const admit = await call(remote, "/v1/pr-groups", "/admit", "POST", {
      root_request_id: "request-root",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task",
      dispatch_attempt: "dispatch-1",
      writer_generation: "generation-1",
      worktree: "/tmp/pr-group",
      branch: "feat/pr-group",
      pr_number: 78,
      base_sha: "b".repeat(40),
    });
    const body = await admit.json() as Record<string, any>;
    const response = await call(remote, "/v1/pr-groups", `/${body.view.group.id}/events`, "POST", {
      attempt_id: body.view.attempts[0].id,
      writer_generation: "stale-generation",
      idempotency_key: "stale-1",
      event_type: "progress",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "PR_GROUP_WRITER_FENCED",
      authoritative: true,
    });
  });

  test("carries the authenticated server principal into the ledger boundary", async () => {
    const admit = await call(remote, "/v1/pr-groups", "/admit", "POST", {
      root_request_id: "principal-root",
      repository: "hasna/todos",
      leaf_task_id: "principal-leaf",
      dispatch_attempt: "dispatch-1",
      writer_generation: "generation-1",
      worktree: "/tmp/principal",
      branch: "feat/principal",
      pr_number: 78,
      base_sha: "b".repeat(40),
      admitted_at: "2026-07-23T10:00:00.000Z",
    }, { actor_id: "coordinator-1", actor_run_id: "coordinator-run-1" });
    const body = await admit.json() as Record<string, any>;
    const groupId = body.view.group.id as string;
    const attemptId = body.view.attempts[0].id as string;
    const principal = { actor_id: "reviewer-1", actor_run_id: "review-run-1" };
    const append = (event: Record<string, unknown>, auth = principal) =>
      call(remote, "/v1/pr-groups", `/${groupId}/events`, "POST", {
        attempt_id: attemptId,
        writer_generation: "generation-1",
        created_at: "2026-07-23T10:01:00.000Z",
        ...event,
      }, auth);
    expect((await append({ idempotency_key: "start", event_type: "started" })).status).toBe(201);
    expect((await append({ idempotency_key: "handoff", event_type: "handoff" })).status).toBe(201);
    expect((await append({
      idempotency_key: "review-request",
      event_type: "review_requested",
      head_sha: "a".repeat(40),
      repository: "hasna/todos",
      pr_number: 78,
      base_sha: "b".repeat(40),
      actor_id: "reviewer-1",
      actor_run_id: "review-run-1",
      expected_reviewer_id: "reviewer-1",
      expected_reviewer_run_id: "review-run-1",
    })).status).toBe(201);
    const spoofed = await append({
      idempotency_key: "review-spoofed",
      event_type: "review_receipt",
      head_sha: "a".repeat(40),
      repository: "hasna/todos",
      pr_number: 78,
      base_sha: "b".repeat(40),
      actor_id: "reviewer-1",
      actor_run_id: "review-run-1",
      receipt_key: "spoofed-receipt",
      outcome: "approved",
    }, { actor_id: "reviewer-2", actor_run_id: "review-run-2" });
    expect(spoofed.status).toBe(409);
    expect(await spoofed.json()).toMatchObject({ code: "PR_GROUP_IDENTITY_CONFLICT" });
  });

  test("publishes closed authoritative schemas and a complete generated recovery client", async () => {
    const schemas = buildV1OpenApiDocument("test").components.schemas as Record<string, any>;
    expect(schemas.PrGroupStateView).toMatchObject({
      additionalProperties: false,
      required: expect.arrayContaining([
        "group",
        "attempts",
        "latest_event",
        "review_receipts",
        "conditional_merge_receipts",
        "merge_receipts",
        "cleanup_receipts",
      ]),
    });
    expect(schemas.RecoverPrGroupInput).toMatchObject({
      additionalProperties: false,
      required: expect.arrayContaining([
        "root_request_id",
        "repository",
        "leaf_task_id",
        "expected_attempt_id",
        "dispatch_attempt",
        "expected_generation",
        "writer_generation",
        "worktree",
        "branch",
        "pr_number",
        "base_sha",
        "provider",
        "provider_run_id",
        "profile_alias",
        "idempotency_key",
      ]),
    });
    expect(schemas.PrGroupCiProof).toMatchObject({
      additionalProperties: false,
      required: expect.arrayContaining([
        "provider",
        "provider_run_id",
        "status",
        "repository",
        "pr_number",
        "base_sha",
        "head_sha",
      ]),
    });
    expect(schemas.PrGroupEventRecord.required).toContain("ci_proof");
    expect(schemas.AppendPrGroupEventInput.properties.ci_proof).toBeDefined();

    let request: Request | undefined;
    const client = new TodosV1Client({
      baseUrl: "https://todos.example.test",
      fetch: (async (input, init) => {
        request = new Request(input, init);
        return Response.json({});
      }) as typeof fetch,
    });
    const recovery = {
      root_request_id: "root-1",
      repository: "hasna/todos",
      leaf_task_id: "leaf-1",
      expected_attempt_id: "attempt-1",
      dispatch_attempt: "dispatch-1",
      expected_generation: "generation-1",
      writer_generation: "generation-2",
      worktree: "/tmp/pr-group",
      branch: "feat/pr-group",
      pr_number: 78,
      base_sha: "b".repeat(40),
      provider: "codewith",
      provider_run_id: "run-2",
      profile_alias: "account013",
      idempotency_key: "recover-1",
    };
    await client.recoverPrGroup("prg_test", recovery);
    expect(request?.url).toBe("https://todos.example.test/v1/pr-groups/prg_test/recover");
    expect(request?.method).toBe("POST");
    expect(await request?.json()).toEqual(recovery);
  });
});
