import { appendFileSync } from "node:fs";

const CANONICAL_CREATE_ID = "2c4b7a7f-658e-424c-bcaf-475c3206f76e";
const CREATE_SHORT_ID = "IAP9-00378";

// NOTE: the create response returns the CANONICAL task row. The old open-todos
// contract returned a transient id from POST and relied on the CLI to resolve
// the canonical row afterwards; apps/todos fails closed instead
// (TASK_CREATE_PERSISTENCE_UNVERIFIED) when a GET readback of the returned id
// does not reproduce the same stored row, so the transient-id shape is no
// longer expressible by this fixture.

const requestLog = process.env["TODOS_CREATE_IDENTITY_REQUEST_LOG"];

const canonicalTask = {
  id: CANONICAL_CREATE_ID,
  short_id: CREATE_SHORT_ID,
  project_id: null,
  parent_id: null,
  plan_id: null,
  task_list_id: null,
  title: "Stable create identity regression",
  description: null,
  status: "pending",
  priority: "medium",
  agent_id: "identity-regression",
  assigned_to: "identity-regression",
  session_id: null,
  working_dir: process.cwd(),
  tags: [],
  metadata: {},
  version: 1,
  locked_by: null,
  locked_at: null,
  created_at: "2026-08-07T18:04:31.000Z",
  updated_at: "2026-08-07T18:04:31.000Z",
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
  assigned_by: "identity-regression",
  created_by: "identity-regression",
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
  machine_id: null,
  synced_at: null,
  archived_at: null,
};

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  if (requestLog) appendFileSync(requestLog, `${request.method} ${url.pathname}\n`);

  if (url.pathname === "/v1/openapi.json" && request.method === "GET") {
    return Response.json({
      paths: {
        "/v1/tasks/{id}/refs": { get: {}, post: {} },
        "/v1/refs/{ref}": { get: {} },
      },
    });
  }

  if (url.pathname.match(/^\/v1\/tasks\/[^/]+\/refs$/) && request.method === "GET") {
    return Response.json({ refs: [], count: 0 });
  }

  if (url.pathname === "/v1/tasks" && request.method === "POST") {
    const body = await request.json() as { title?: string };
    return Response.json({
      task: {
        ...canonicalTask,
        title: body.title ?? canonicalTask.title,
      },
    }, { status: 201 });
  }

  if (url.pathname === "/v1/tasks" && request.method === "GET") {
    return Response.json({ tasks: [canonicalTask], count: 1, total: 1 });
  }

  if (url.pathname === `/v1/tasks/${CANONICAL_CREATE_ID}/comments` && request.method === "GET") {
    return Response.json({ comments: [], count: 0, limit: 100, has_more: false, next_cursor: null });
  }

  if (url.pathname === `/v1/tasks/${CANONICAL_CREATE_ID}/dependencies` && request.method === "GET") {
    return Response.json({ dependencies: [], blocked_by: [], blocks: [] });
  }

  const match = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
  if (match && request.method === "GET") {
    const ref = decodeURIComponent(match[1]!).toLowerCase();
    if (ref === CANONICAL_CREATE_ID || ref === CREATE_SHORT_ID.toLowerCase()) {
      return Response.json({ task: canonicalTask });
    }
    return Response.json({ error: "task not found" }, { status: 404 });
  }

  return Response.json({ error: "not found" }, { status: 404 });
}) as typeof fetch;
