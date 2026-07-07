/**
 * Versioned `/v1` HTTP API for `todos-serve` (A1 pure-remote).
 *
 * Every handler goes through the repo-native Postgres storage adapter
 * (`getCloudStorageAdapter`) which reads/writes the shared RDS directly. Auth is
 * enforced by the contracts API-key verifier: reads require `todos:read`, writes
 * require `todos:write` (a `todos:*` key satisfies both). This is a real wrapper
 * over the core storage lib — there are NO stubs; unimplemented routes 404.
 */
import type { CreateProjectInput, CreateTaskInput, UpdateTaskInput } from "../types/index.js";
import type { TodosStorageContext, TodosStorageSnapshot } from "../storage/interfaces.js";
import { getCloudStorageAdapter, getCloudVerifier, ensureCloudSchema } from "./cloud.js";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function error(status: number, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...(extra ?? {}) }, status);
}

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function contextFromPrincipal(principal: { agent: string | null }, body?: { agent_id?: string }): TodosStorageContext {
  const agentId = body?.agent_id || principal.agent || undefined;
  return agentId ? { agentId } : {};
}

/**
 * Coerce an arbitrary request body into a well-formed {@link TodosStorageSnapshot}.
 *
 * Every record array is optional and defaults to `[]`, so a caller can backfill a
 * single object type (e.g. just `tasks`) or a full snapshot. Non-array values for
 * a record key are treated as empty rather than throwing, keeping partial-chunk
 * ingest robust. The returned snapshot is safe to hand straight to
 * `storage.sync.importSnapshot`, which upserts every row by primary key (idempotent).
 */
export function normalizeImportSnapshot(raw: unknown): TodosStorageSnapshot {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    exportedAt: typeof body["exportedAt"] === "string" ? (body["exportedAt"] as string) : new Date().toISOString(),
    source: (typeof body["source"] === "string" ? body["source"] : "sqlite") as TodosStorageSnapshot["source"],
    tasks: arr(body["tasks"]),
    projects: arr(body["projects"]),
    projectMachinePaths: arr(body["projectMachinePaths"]),
    plans: arr(body["plans"]),
    agents: arr(body["agents"]),
    taskLists: arr(body["taskLists"]),
    templates: arr(body["templates"]),
    auditHistory: arr(body["auditHistory"]),
    tombstones: arr(body["tombstones"]),
  };
}

/** Total number of records (across every object type) carried by a snapshot. */
export function countSnapshotRecords(s: TodosStorageSnapshot): number {
  return (
    s.tasks.length +
    s.projects.length +
    (s.projectMachinePaths?.length ?? 0) +
    s.plans.length +
    s.agents.length +
    s.taskLists.length +
    s.templates.length +
    s.auditHistory.length +
    (s.tombstones?.length ?? 0)
  );
}

/**
 * Handle a `/v1/*` request. Returns `null` when the path is not a `/v1` route so
 * the caller can fall through to other handlers.
 */
export async function handleV1Request(req: Request, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/v1" && !path.startsWith("/v1/")) return null;

  const method = req.method.toUpperCase();
  const isWrite = method !== "GET" && method !== "HEAD";
  const requiredScopes = [isWrite ? "todos:write" : "todos:read"];

  // ── Auth (contracts API-key verifier) ──
  let verifier;
  try {
    verifier = getCloudVerifier();
  } catch (e) {
    return error(503, (e as Error).message);
  }
  const decision = await verifier.authenticate(req.headers, { method, path, requiredScopes });
  if (!decision.ok) {
    return error(decision.status, decision.message, { reason: decision.reason });
  }
  const principal = decision.principal;

  // Schema is idempotently ensured on the first authenticated request.
  await ensureCloudSchema();
  const store = getCloudStorageAdapter();

  const segments = path.split("/").filter(Boolean); // ["v1", resource, id?, action?]
  const resource = segments[1];
  const id = segments[2];
  const action = segments[3];

  try {
    // ── /v1/tasks ──
    if (resource === "tasks") {
      if (!id) {
        if (method === "GET") {
          const filter = {
            ...(url.searchParams.get("status") ? { status: url.searchParams.get("status") as never } : {}),
            ...(url.searchParams.get("priority") ? { priority: url.searchParams.get("priority") as never } : {}),
            ...(url.searchParams.get("project_id") ? { project_id: url.searchParams.get("project_id")! } : {}),
            ...(url.searchParams.get("plan_id") ? { plan_id: url.searchParams.get("plan_id")! } : {}),
            ...(url.searchParams.get("assigned_to") ? { assigned_to: url.searchParams.get("assigned_to")! } : {}),
            ...(url.searchParams.get("agent_id") ? { agent_id: url.searchParams.get("agent_id")! } : {}),
            ...(url.searchParams.get("limit") ? { limit: Number(url.searchParams.get("limit")) } : {}),
            ...(url.searchParams.get("offset") ? { offset: Number(url.searchParams.get("offset")) } : {}),
          };
          const tasks = await store.tasks.list(filter);
          // `total` is the full match count for the filter (ignoring limit/offset),
          // so clients can paginate without pulling the whole result set. Both the
          // list and the count are SQL-side now — no O(n) JS materialization.
          const { limit: _l, offset: _o, ...countFilter } = filter;
          const total = await store.tasks.count(countFilter);
          return json({ tasks, count: tasks.length, total });
        }
        if (method === "POST") {
          const body = await readJson<CreateTaskInput>(req);
          if (!body || typeof body.title !== "string" || !body.title.trim()) {
            return error(400, "title is required");
          }
          const task = await store.tasks.create(body, contextFromPrincipal(principal, body));
          return json({ task }, 201);
        }
        return error(405, `method ${method} not allowed on /v1/tasks`);
      }
      // /v1/tasks/:id[/action]
      if (action) {
        const body = (await readJson<{ agent_id?: string; reason?: string }>(req)) ?? {};
        const agentId = body.agent_id || principal.agent || "todos-serve";
        if (action === "start" && method === "POST") {
          return json({ task: await store.tasks.start(id, agentId) });
        }
        if (action === "complete" && method === "POST") {
          return json({ task: await store.tasks.complete(id, agentId, {}) });
        }
        if (action === "fail" && method === "POST") {
          return json({ result: await store.tasks.fail(id, agentId, body.reason ?? "failed", {}) });
        }
        if (action === "claim" && method === "POST") {
          return json({ task: await store.tasks.claimNext(agentId, {}) });
        }
        return error(404, `unknown task action: ${action}`);
      }
      if (method === "GET") {
        const task = await store.tasks.get(id);
        return task ? json({ task }) : error(404, "task not found");
      }
      if (method === "PATCH" || method === "PUT") {
        const body = await readJson<UpdateTaskInput>(req);
        if (!body) return error(400, "invalid JSON body");
        const current = await store.tasks.get(id);
        if (!current) return error(404, "task not found");
        // Optimistic concurrency: honor a client-supplied version, else default
        // to the current record's version (convenience last-write-wins).
        const patch: UpdateTaskInput = {
          ...body,
          version: typeof body.version === "number" ? body.version : (current.version as number),
        };
        try {
          const task = await store.tasks.update(id, patch);
          return task ? json({ task }) : error(404, "task not found");
        } catch (e) {
          const msg = (e as Error).message || "";
          if (msg.includes("version conflict")) return error(409, msg);
          throw e;
        }
      }
      if (method === "DELETE") {
        await store.tasks.delete(id, contextFromPrincipal(principal));
        return json({ deleted: true, id });
      }
      return error(405, `method ${method} not allowed on /v1/tasks/:id`);
    }

    // ── /v1/projects ──
    if (resource === "projects") {
      if (!id) {
        if (method === "GET") {
          const projects = await store.projects.list();
          return json({ projects, count: projects.length });
        }
        if (method === "POST") {
          const body = await readJson<CreateProjectInput>(req);
          if (!body || typeof body.name !== "string" || typeof body.path !== "string") {
            return error(400, "name and path are required");
          }
          const project = await store.projects.create(body, contextFromPrincipal(principal));
          return json({ project }, 201);
        }
        return error(405, `method ${method} not allowed on /v1/projects`);
      }
      if (method === "GET") {
        const project = await store.projects.get(id);
        return project ? json({ project }) : error(404, "project not found");
      }
      if (method === "PATCH" || method === "PUT") {
        const body = await readJson<Partial<CreateProjectInput>>(req);
        if (!body) return error(400, "invalid JSON body");
        const project = await store.projects.update(id, body);
        return project ? json({ project }) : error(404, "project not found");
      }
      if (method === "DELETE") {
        await store.projects.delete(id, contextFromPrincipal(principal));
        return json({ deleted: true, id });
      }
      return error(405, `method ${method} not allowed on /v1/projects/:id`);
    }

    // ── /v1/plans ──
    if (resource === "plans") {
      if (!id && method === "GET") {
        const plans = await store.plans.list(url.searchParams.get("project_id") ?? undefined);
        return json({ plans, count: plans.length });
      }
      if (!id && method === "POST") {
        const body = await readJson<{ title?: string; name?: string; project_id?: string }>(req);
        if (!body || (!body.title && !body.name)) return error(400, "title is required");
        const plan = await store.plans.create(body as never, contextFromPrincipal(principal));
        return json({ plan }, 201);
      }
      if (id && method === "GET") {
        const plan = await store.plans.get(id);
        return plan ? json({ plan }) : error(404, "plan not found");
      }
    }

    // ── /v1/agents ──
    if (resource === "agents") {
      if (!id && method === "GET") {
        const agents = await store.agents.list();
        return json({ agents, count: agents.length });
      }
      if (!id && method === "POST") {
        const body = await readJson<{ name?: string }>(req);
        if (!body || typeof body.name !== "string") return error(400, "name is required");
        const agent = await store.agents.register(body as never, contextFromPrincipal(principal));
        return json({ agent }, 201);
      }
      if (id && method === "GET") {
        const agent = await store.agents.get(id);
        return agent ? json({ agent }) : error(404, "agent not found");
      }
    }

    // ── /v1/stats ──
    if (resource === "stats" && method === "GET") {
      const [tasks, projects] = await Promise.all([store.tasks.count(), store.projects.list()]);
      return json({ tasks, projects: projects.length });
    }

    // ── /v1/import (bulk snapshot ingest / backfill) ──
    // Accepts a full or partial TodosStorageSnapshot and upserts every record by
    // primary key via the storage adapter. Idempotent: re-posting the same rows
    // never duplicates (ON CONFLICT DO UPDATE, guarded by updated_at/version), so
    // large local→cloud backfills can be chunked and safely retried. Requires the
    // `todos:write` scope (enforced above for non-GET methods).
    if (resource === "import") {
      if (method !== "POST") return error(405, `method ${method} not allowed on /v1/import`);
      if (typeof store.sync.importSnapshot !== "function") {
        return error(501, "snapshot import is not supported by this storage backend");
      }
      const raw = await readJson<unknown>(req);
      if (raw === null) return error(400, "invalid JSON body");
      const snapshot = normalizeImportSnapshot(raw);
      const received = countSnapshotRecords(snapshot);
      if (received === 0) {
        return error(400, "empty snapshot: provide at least one record array (tasks/projects/plans/...)");
      }
      const result = await store.sync.importSnapshot(snapshot, contextFromPrincipal(principal));
      return json({ result, received });
    }

    return error(404, `unknown /v1 resource: ${resource ?? "(root)"}`);
  } catch (e) {
    return error(500, (e as Error).message || "internal error");
  }
}
