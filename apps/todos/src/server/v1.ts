/**
 * Versioned `/v1` HTTP API for `todos-serve` (A1 pure-remote).
 *
 * Every handler goes through the repo-native Postgres storage adapter
 * (`getCloudStorageAdapter`) which reads/writes the shared RDS directly. Auth is
 * enforced by the contracts API-key verifier: reads require `todos:read`, writes
 * require `todos:write` (a `todos:*` key satisfies both). This is a real wrapper
 * over the core storage lib — there are NO stubs; unimplemented routes 404.
 */
import { LockError, ProjectNotFoundError, ResourceConflictError } from "../types/index.js";
import type { CreatePlanInput, CreateProjectInput, CreateTaskInput, CreateTaskListInput, CreateTemplateInput, RenameProjectInput, TaskComment, TemplateTaskInput, UpdateTaskInput, UpdateTaskListInput } from "../types/index.js";
import type { TodosStorageContext, TodosStorageSnapshot, TodosTaskCompletionOptions, UpdateTemplateInput } from "../storage/interfaces.js";
import { getCloudStorageAdapter, getCloudVerifier, ensureCloudSchema } from "./cloud.js";
import { redactEvidenceText } from "../lib/redaction.js";
import { isCanonicalSlug, normalizeSlug } from "../lib/slugs.js";

export interface V1RequestDependencies {
  getVerifier?: typeof getCloudVerifier;
  ensureSchema?: typeof ensureCloudSchema;
  getStorageAdapter?: typeof getCloudStorageAdapter;
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;
const DEFAULT_COMMENT_PAGE_SIZE = 100;
const MAX_COMMENT_PAGE_SIZE = 500;
const LEGACY_COMMENT_RESPONSE_LIMIT = 500;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function error(status: number, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...(extra ?? {}) }, status);
}

function validateTaskCompletion(value: unknown):
  | { ok: true; agentId?: string; options: TodosTaskCompletionOptions }
  | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "completion body must be an object" };
  const body = value as Record<string, unknown>;
  const allowed = new Set(["agent_id", "attachment_ids", "files_changed", "test_results", "commit_hash", "notes", "confidence"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return { ok: false, message: `unknown completion field: ${unknown}` };
  if (body.agent_id !== undefined && (typeof body.agent_id !== "string" || !body.agent_id.trim())) {
    return { ok: false, message: "agent_id must be a non-empty string" };
  }
  for (const field of ["attachment_ids", "files_changed"] as const) {
    const value = body[field];
    if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()))) {
      return { ok: false, message: `${field} must be an array of non-empty strings` };
    }
  }
  for (const field of ["test_results", "commit_hash", "notes"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return { ok: false, message: `${field} must be a string` };
    }
  }
  if (body.confidence !== undefined &&
      (typeof body.confidence !== "number" || !Number.isFinite(body.confidence) || body.confidence < 0 || body.confidence > 1)) {
    return { ok: false, message: "confidence must be a number between 0 and 1" };
  }
  return {
    ok: true,
    ...(typeof body.agent_id === "string" ? { agentId: body.agent_id } : {}),
    options: {
      ...(Array.isArray(body.attachment_ids) ? { attachment_ids: body.attachment_ids as string[] } : {}),
      ...(Array.isArray(body.files_changed) ? { files_changed: body.files_changed as string[] } : {}),
      ...(typeof body.test_results === "string" ? { test_results: body.test_results } : {}),
      ...(typeof body.commit_hash === "string" ? { commit_hash: body.commit_hash } : {}),
      ...(typeof body.notes === "string" ? { notes: body.notes } : {}),
      ...(typeof body.confidence === "number" ? { confidence: body.confidence } : {}),
    },
  };
}

function validateProjectPatch(value: unknown):
  | { ok: true; patch: Partial<Pick<CreateProjectInput, "name" | "path" | "description">> }
  | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "project patch must be an object" };
  const body = value as Record<string, unknown>;
  const allowed = new Set(["name", "path", "description"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return { ok: false, message: `unknown project field: ${unknown}` };
  if (Object.keys(body).length === 0) return { ok: false, message: "project patch must not be empty" };
  if (body["name"] !== undefined && (typeof body["name"] !== "string" || !body["name"].trim())) return { ok: false, message: "name must be a non-empty string" };
  if (body["path"] !== undefined && (typeof body["path"] !== "string" || !body["path"].trim())) return { ok: false, message: "path must be a non-empty string" };
  if (body["description"] !== undefined && body["description"] !== null && typeof body["description"] !== "string") return { ok: false, message: "description must be a string or null" };
  return { ok: true, patch: body as never };
}

function validateProjectCreate(value: unknown):
  | { ok: true; input: Pick<CreateProjectInput, "name" | "path" | "description" | "task_list_id" | "task_prefix"> }
  | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "project body must be an object" };
  const body = value as Record<string, unknown>;
  const allowed = new Set(["name", "path", "description", "task_list_id", "task_prefix"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return { ok: false, message: `unknown project field: ${unknown}` };
  if (typeof body["name"] !== "string" || !body["name"].trim()) return { ok: false, message: "name must be a non-empty string" };
  if (!normalizeSlug(body["name"])) return { ok: false, message: "name must produce a non-empty canonical slug" };
  if (typeof body["path"] !== "string" || !body["path"].trim()) return { ok: false, message: "path must be a non-empty string" };
  if (body["description"] !== undefined && typeof body["description"] !== "string") return { ok: false, message: "description must be a string" };
  if (body["task_list_id"] !== undefined && !isCanonicalSlug(body["task_list_id"])) {
    return { ok: false, message: "task_list_id must be non-empty canonical kebab-case" };
  }
  if (body["task_prefix"] !== undefined && (typeof body["task_prefix"] !== "string" || !body["task_prefix"].trim())) {
    return { ok: false, message: "task_prefix must be a non-empty string" };
  }
  return { ok: true, input: body as never };
}

function validatePlanCreate(value: unknown):
  | { ok: true; input: CreatePlanInput }
  | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "plan body must be an object" };
  const body = value as Record<string, unknown>;
  const allowed = new Set(["title", "name", "slug", "description", "project_id", "task_list_id", "agent_id", "status"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return { ok: false, message: `unknown plan field: ${unknown}` };
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) return { ok: false, message: "name must be a non-empty string" };
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) return { ok: false, message: "title must be a non-empty string" };
  if (typeof body.name === "string" && typeof body.title === "string" && body.name !== body.title) {
    return { ok: false, message: "name and title must match when both are provided" };
  }
  const name = (body.name ?? body.title) as string | undefined;
  if (!name) return { ok: false, message: "name is required" };
  for (const field of ["slug", "project_id", "task_list_id", "agent_id"] as const) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || !body[field].trim())) {
      return { ok: false, message: `${field} must be a non-empty string` };
    }
  }
  const slug = typeof body.slug === "string" ? normalizeSlug(body.slug) : undefined;
  if (body.slug !== undefined && !slug) return { ok: false, message: "slug must produce a non-empty canonical slug" };
  if (body.description !== undefined && typeof body.description !== "string") return { ok: false, message: "description must be a string" };
  if (body.status !== undefined &&
      (typeof body.status !== "string" || !["active", "completed", "archived"].includes(body.status))) {
    return { ok: false, message: "status must be active, completed, or archived" };
  }
  return {
    ok: true,
    input: {
      name,
      ...(slug ? { slug } : {}),
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(typeof body.project_id === "string" ? { project_id: body.project_id } : {}),
      ...(typeof body.task_list_id === "string" ? { task_list_id: body.task_list_id } : {}),
      ...(typeof body.agent_id === "string" ? { agent_id: body.agent_id } : {}),
      ...(typeof body.status === "string" ? { status: body.status as CreatePlanInput["status"] } : {}),
    },
  };
}

function validateTemplateTask(value: unknown): TemplateTaskInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const allowed = new Set(["position", "title_pattern", "description", "priority", "tags", "task_type", "condition", "include_template_id", "depends_on", "depends_on_positions", "metadata"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  if (typeof body.title_pattern !== "string" || !body.title_pattern.trim()) return null;
  if (body.position !== undefined && (typeof body.position !== "number" || !Number.isSafeInteger(body.position) || body.position < 0)) return null;
  if (body.description !== undefined && body.description !== null && typeof body.description !== "string") return null;
  if (body.priority !== undefined && (typeof body.priority !== "string" || !["low", "medium", "high", "critical"].includes(body.priority))) return null;
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== "string" || !tag.trim()))) return null;
  for (const field of ["task_type", "condition", "include_template_id"] as const) {
    if (body[field] !== undefined && body[field] !== null && (typeof body[field] !== "string" || !body[field].trim())) return null;
  }
  if (body.depends_on !== undefined && body.depends_on_positions !== undefined) return null;
  const dependencies = body.depends_on ?? body.depends_on_positions;
  if (dependencies !== undefined && (!Array.isArray(dependencies) || dependencies.some((position) => !Number.isSafeInteger(position) || position < 0))) return null;
  if (body.metadata !== undefined && (!body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata))) return null;
  return {
    title_pattern: body.title_pattern,
    ...(typeof body.description === "string" ? { description: body.description } : {}),
    ...(typeof body.priority === "string" ? { priority: body.priority as TemplateTaskInput["priority"] } : {}),
    ...(Array.isArray(body.tags) ? { tags: body.tags as string[] } : {}),
    ...(typeof body.task_type === "string" ? { task_type: body.task_type } : {}),
    ...(typeof body.condition === "string" ? { condition: body.condition } : {}),
    ...(typeof body.include_template_id === "string" ? { include_template_id: body.include_template_id } : {}),
    ...(Array.isArray(dependencies) ? { depends_on: dependencies as number[] } : {}),
    ...(body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? { metadata: body.metadata as Record<string, unknown> } : {}),
  };
}

function validateTemplateCreate(value: unknown):
  | { ok: true; input: CreateTemplateInput }
  | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "template body must be an object" };
  const body = value as Record<string, unknown>;
  const allowed = new Set(["name", "title_pattern", "description", "priority", "tags", "variables", "project_id", "plan_id", "metadata", "tasks"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return { ok: false, message: `unknown template field: ${unknown}` };
  if (typeof body.name !== "string" || !body.name.trim()) return { ok: false, message: "name must be a non-empty string" };
  if (typeof body.title_pattern !== "string" || !body.title_pattern.trim()) return { ok: false, message: "title_pattern must be a non-empty string" };
  if (body.description !== undefined && body.description !== null && typeof body.description !== "string") return { ok: false, message: "description must be a string or null" };
  if (body.priority !== undefined && (typeof body.priority !== "string" || !["low", "medium", "high", "critical"].includes(body.priority))) return { ok: false, message: "priority must be low, medium, high, or critical" };
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== "string" || !tag.trim()))) return { ok: false, message: "tags must be an array of non-empty strings" };
  if (body.variables !== undefined && (!Array.isArray(body.variables) || body.variables.some((variable) => !variable || typeof variable !== "object" || Array.isArray(variable) ||
    typeof (variable as Record<string, unknown>).name !== "string" || !(variable as Record<string, unknown>).name ||
    typeof (variable as Record<string, unknown>).required !== "boolean" ||
    ((variable as Record<string, unknown>).default !== undefined && typeof (variable as Record<string, unknown>).default !== "string") ||
    ((variable as Record<string, unknown>).description !== undefined && typeof (variable as Record<string, unknown>).description !== "string")))) {
    return { ok: false, message: "variables must be valid template variable objects" };
  }
  for (const field of ["project_id", "plan_id"] as const) {
    if (body[field] !== undefined && body[field] !== null && (typeof body[field] !== "string" || !body[field].trim())) return { ok: false, message: `${field} must be a non-empty string or null` };
  }
  if (body.metadata !== undefined && (!body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata))) return { ok: false, message: "metadata must be an object" };
  const tasks = body.tasks === undefined ? [] : Array.isArray(body.tasks) ? body.tasks.map(validateTemplateTask) : null;
  if (tasks === null || tasks.some((task) => task === null)) return { ok: false, message: "tasks must be valid template task objects" };
  const taskInputs = tasks as TemplateTaskInput[];
  for (const [position, task] of taskInputs.entries()) {
    if ((task.depends_on ?? []).some((dependency) => dependency >= position)) {
      return { ok: false, message: "template task dependencies must reference earlier task positions" };
    }
  }
  return {
    ok: true,
    input: {
      name: body.name,
      title_pattern: body.title_pattern,
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(typeof body.priority === "string" ? { priority: body.priority as CreateTemplateInput["priority"] } : {}),
      ...(Array.isArray(body.tags) ? { tags: body.tags as string[] } : {}),
      ...(Array.isArray(body.variables) ? { variables: body.variables as CreateTemplateInput["variables"] } : {}),
      ...(typeof body.project_id === "string" ? { project_id: body.project_id } : {}),
      ...(typeof body.plan_id === "string" ? { plan_id: body.plan_id } : {}),
      ...(body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? { metadata: body.metadata as Record<string, unknown> } : {}),
      tasks: taskInputs,
    },
  };
}

function validateTemplatePatch(value: unknown):
  | { ok: true; patch: UpdateTemplateInput }
  | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "template patch must be an object" };
  const body = value as Record<string, unknown>;
  const allowed = new Set(["name", "title_pattern", "description", "priority", "tags", "variables", "project_id", "plan_id", "metadata"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return { ok: false, message: `unknown template field: ${unknown}` };
  if (Object.keys(body).length === 0) return { ok: false, message: "template patch must not be empty" };
  const templateLike = { name: body.name ?? "template", title_pattern: body.title_pattern ?? "template", ...body };
  const validated = validateTemplateCreate(templateLike);
  if (!validated.ok) return validated;
  const { name: _name, title_pattern: _title, tasks: _tasks, ...patch } = validated.input;
  return { ok: true, patch: {
    ...(body.name !== undefined ? { name: validated.input.name } : {}),
    ...(body.title_pattern !== undefined ? { title_pattern: validated.input.title_pattern } : {}),
    ...patch,
  } };
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

async function readOptionalJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const text = await req.text();
    if (!text.trim()) return { ok: true, value: {} };
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function contextFromPrincipal(principal: { agent: string | null }, body?: { agent_id?: string }): TodosStorageContext {
  const agentId = body?.agent_id || principal.agent || undefined;
  return agentId ? { agentId } : {};
}

function redactComment(comment: TaskComment): TaskComment {
  return { ...comment, content: redactEvidenceText(comment.content) };
}

function encodeCommentCursor(comment: Pick<TaskComment, "created_at" | "id">): string {
  return Buffer.from(JSON.stringify({ created_at: comment.created_at, id: comment.id }), "utf8").toString("base64url");
}

function decodeCommentCursor(value: string): { created_at: string; id: string } {
  if (value.length > 1_024) throw new Error("invalid comment cursor");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid comment cursor");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid comment cursor");
  const cursor = parsed as Record<string, unknown>;
  if (typeof cursor["created_at"] !== "string" || cursor["created_at"].length > 64 ||
      !Number.isFinite(Date.parse(cursor["created_at"])) ||
      typeof cursor["id"] !== "string" || !cursor["id"] || cursor["id"].length > 256) {
    throw new Error("invalid comment cursor");
  }
  return { created_at: cursor["created_at"], id: cursor["id"] };
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
export async function handleV1Request(
  req: Request,
  url: URL,
  dependencies: V1RequestDependencies = {},
): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/v1" && !path.startsWith("/v1/")) return null;

  const method = req.method.toUpperCase();
  const isWrite = method !== "GET" && method !== "HEAD";
  const requiredScopes = [isWrite ? "todos:write" : "todos:read"];

  // ── Auth (contracts API-key verifier) ──
  let verifier;
  try {
    verifier = (dependencies.getVerifier ?? getCloudVerifier)();
  } catch (e) {
    return error(503, (e as Error).message);
  }
  const decision = await verifier.authenticate(req.headers, { method, path, requiredScopes });
  if (!decision.ok) {
    return error(decision.status, decision.message, { reason: decision.reason });
  }
  const principal = decision.principal;

  // Schema is idempotently ensured on the first authenticated request.
  await (dependencies.ensureSchema ?? ensureCloudSchema)();
  const store = (dependencies.getStorageAdapter ?? getCloudStorageAdapter)();

  const segments = path.split("/").filter(Boolean); // ["v1", resource, id?, action?, subId?]
  const resource = segments[1];
  const id = segments[2];
  const action = segments[3];
  const subId = segments[4];

  try {
    // ── /v1/tasks ──
    if (resource === "tasks") {
      // ── POST /v1/tasks/exists — bulk existence check for parity verification ──
      // Body: { ids: string[] }. Returns which task ids are present (live, NOT
      // tombstoned) in cloud vs missing, in a SINGLE SQL `payload->>'id' IN (...)`
      // query (include_subtasks so parent tasks AND subtasks are both counted).
      // This lets a fleet-union backfill be proven complete without thousands of
      // rate-limited GET-by-id calls (the previous verify approach hit HTTP 429).
      if (id === "exists" && !action) {
        if (method !== "POST") return error(405, `method ${method} not allowed on /v1/tasks/exists`);
        const body = await readJson<{ ids?: unknown }>(req);
        const ids = Array.isArray(body?.ids)
          ? Array.from(new Set(body!.ids.filter((v): v is string => typeof v === "string" && v.length > 0)))
          : [];
        if (ids.length === 0) return error(400, "provide a non-empty string array `ids`");
        if (ids.length > 5000) return error(400, `too many ids (${ids.length}); max 5000 per request`);
        const found = await store.tasks.list({ ids, include_subtasks: true, limit: ids.length } as never);
        const presentSet = new Set(found.map((t) => t.id));
        const present = ids.filter((i) => presentSet.has(i));
        const missing = ids.filter((i) => !presentSet.has(i));
        return json({
          requested: ids.length,
          present_count: present.length,
          missing_count: missing.length,
          missing,
        });
      }
      // ── POST /v1/tasks/upsert — idempotent create-or-update by fingerprint ──
      // The CLI `task upsert` previously wrote the task to this machine's LOCAL
      // sqlite by fingerprint, so on a flipped (cloud) machine the row was absent
      // from the shared /v1 dataset — a split-brain write. Routing the dedupe here
      // resolves the fingerprint against the SHARED dataset so create-or-update is
      // authoritative for every agent.
      if (id === "upsert" && !action) {
        if (method !== "POST") return error(405, `method ${method} not allowed on /v1/tasks/upsert`);
        if (typeof store.tasks.getByFingerprint !== "function") {
          return error(501, "fingerprint upsert is not supported by this storage backend");
        }
        const body = ((await readJson<CreateTaskInput & { fingerprint?: string; version?: number }>(req)) ??
          {}) as CreateTaskInput & { fingerprint?: string; version?: number };
        const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint.trim() : "";
        if (!fingerprint) return error(400, "fingerprint is required");
        if (typeof body.title !== "string" || !body.title.trim()) return error(400, "title is required");
        const existing = await store.tasks.getByFingerprint(fingerprint);
        const metadata = {
          ...(existing?.metadata ?? {}),
          ...(body.metadata ?? {}),
          fingerprint,
        };
        // Only pass through fields the caller actually set so an update never
        // clobbers a stored value with an accidental undefined→default.
        const fields: Record<string, unknown> = { metadata };
        for (const key of [
          "title", "description", "priority", "status", "project_id", "assigned_to",
          "working_dir", "plan_id", "task_list_id", "tags", "due_at", "estimated_minutes",
          "sla_minutes", "requires_approval", "recurrence_rule", "task_type",
        ] as const) {
          const bag = body as unknown as Record<string, unknown>;
          if (bag[key] !== undefined) fields[key] = bag[key];
        }
        if (!existing) {
          const task = await store.tasks.create(
            { ...(fields as unknown as CreateTaskInput), title: body.title },
            contextFromPrincipal(principal, body),
          );
          return json({ task, created: true }, 201);
        }
        try {
          const task = await store.tasks.update(
            existing.id,
            { ...(fields as unknown as UpdateTaskInput), version: existing.version as number },
            contextFromPrincipal(principal, body),
          );
          return json({ task, created: false });
        } catch (e) {
          const msg = (e as Error).message || "";
          if (msg.includes("version conflict")) return error(409, msg);
          throw e;
        }
      }
      if (!id) {
        if (method === "GET") {
          const includeSubtasks = url.searchParams.get("include_subtasks");
          if (includeSubtasks !== null && includeSubtasks !== "true" && includeSubtasks !== "false") {
            return error(400, "include_subtasks must be true or false");
          }
          const hasParentFilter = url.searchParams.has("parent_id");
          const filter = {
            ...(url.searchParams.get("status") ? {
              status: (url.searchParams.get("status")!.includes(",")
                ? url.searchParams.get("status")!.split(",")
                : url.searchParams.get("status")) as never,
            } : {}),
            ...(url.searchParams.get("priority") ? {
              priority: (url.searchParams.get("priority")!.includes(",")
                ? url.searchParams.get("priority")!.split(",")
                : url.searchParams.get("priority")) as never,
            } : {}),
            ...(url.searchParams.get("project_id") ? { project_id: url.searchParams.get("project_id")! } : {}),
            ...(hasParentFilter
              ? { parent_id: url.searchParams.get("parent_id") || null, include_subtasks: true }
              : includeSubtasks !== null ? { include_subtasks: includeSubtasks === "true" } : {}),
            ...(url.searchParams.get("plan_id") ? { plan_id: url.searchParams.get("plan_id")! } : {}),
            ...(url.searchParams.get("task_list_id") ? { task_list_id: url.searchParams.get("task_list_id")! } : {}),
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
        // ── /v1/tasks/:id/comments — task comments (add/list) ──
        // The comment path is the only task sub-resource that carries a richer body
        // (content/type/progress) and must validate the parent task exists so a
        // comment on a missing cloud task 404s loudly (parity with local, which
        // throws TaskNotFoundError) instead of silently writing an orphan row.
        if (action === "comments") {
          if (method === "GET") {
            if (!(await store.tasks.get(id))) return error(404, "task not found");
            const rawLimit = url.searchParams.get("limit");
            const cursor = url.searchParams.get("cursor");
            // Mixed-version bridge: predecessor clients send neither `limit`
            // nor `cursor` and cannot understand truncation metadata. Preserve
            // their complete response only while it remains bounded; otherwise
            // fail loudly instead of presenting an incomplete history. Rollout
            // upgrades clients first, then the server (see the operator runbook).
            if (rawLimit === null && cursor === null) {
              const storageContext = contextFromPrincipal(principal);
              const legacyPage = (await (store.audit.getCommentsPage
                ? store.audit.getCommentsPage(id, { limit: LEGACY_COMMENT_RESPONSE_LIMIT + 1 }, storageContext)
                : store.audit.getComments(id, storageContext))).map(redactComment);
              if (legacyPage.length > LEGACY_COMMENT_RESPONSE_LIMIT) {
                return error(
                  426,
                  "task has too many comments for this client; upgrade @hasna/todos to use cursor pagination",
                );
              }
              return json({
                comments: legacyPage,
                count: legacyPage.length,
                has_more: false,
                next_cursor: null,
              });
            }
            const limit = rawLimit === null ? DEFAULT_COMMENT_PAGE_SIZE : Number(rawLimit);
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_COMMENT_PAGE_SIZE) {
              return error(400, `limit must be an integer between 1 and ${MAX_COMMENT_PAGE_SIZE}`);
            }
            let before: { created_at: string; id: string } | undefined;
            if (cursor) {
              try {
                before = decodeCommentCursor(cursor);
              } catch {
                return error(400, "invalid comment cursor");
              }
            }
            if (!store.audit.getCommentsPage) {
              return error(426, "storage adapter must be upgraded to support cursor-paginated comments");
            }
            const page = (await store.audit.getCommentsPage(
              id,
              { limit: limit + 1, ...(before ? { before } : {}) },
              contextFromPrincipal(principal),
            )).map(redactComment);
            const hasMore = page.length > limit;
            const comments = hasMore ? page.slice(1) : page;
            return json({
              comments,
              count: comments.length,
              has_more: hasMore,
              next_cursor: hasMore && comments[0] ? encodeCommentCursor(comments[0]) : null,
            });
          }
          if (method === "POST") {
            const body = (await readJson<{
              content?: string;
              agent_id?: string;
              session_id?: string;
              type?: TaskComment["type"];
              progress_pct?: number;
            }>(req)) ?? {};
            if (typeof body.content !== "string" || !body.content.trim()) {
              return error(400, "content is required");
            }
            const target = await store.tasks.get(id);
            if (!target) return error(404, "task not found");
            const comment = await store.audit.addComment(
              {
                task_id: id,
                content: body.content,
                agent_id: body.agent_id ?? principal.agent ?? undefined,
                session_id: body.session_id,
                type: body.type,
                progress_pct: body.progress_pct,
              },
              contextFromPrincipal(principal, body),
            );
            return json({ comment: redactComment(comment) }, 201);
          }
          return error(405, `method ${method} not allowed on /v1/tasks/:id/comments`);
        }
        // ── /v1/tasks/:id/history — per-task audit trail ──
        // The CLI `history` command read this machine's LOCAL sqlite task_history,
        // so a flipped (cloud) machine reported "No history" for a cloud task whose
        // audit trail lives in the shared dataset. Serve the shared history here.
        if (action === "history") {
          if (method !== "GET") return error(405, `method ${method} not allowed on /v1/tasks/:id/history`);
          if (!(await store.tasks.get(id))) return error(404, "task not found");
          const history = await store.audit.getTaskHistory(id);
          return json({ history, count: history.length });
        }
        // ── /v1/tasks/:id/lock and /unlock — exclusive task locking ──
        // Locking is a task-field (`locked_by`/`locked_at`) operation resolved on
        // the shared cloud dataset so a flipped machine coordinates on the SAME
        // lock as every other agent. The previous CLI/MCP path read LOCAL sqlite
        // and 404'd cloud tasks ("Task not found").
        if (action === "lock" || action === "unlock") {
          if (method !== "POST") return error(405, `method ${method} not allowed on /v1/tasks/:id/${action}`);
          const body = (await readJson<{ agent_id?: string; force?: boolean }>(req)) ?? {};
          if (!(await store.tasks.get(id))) return error(404, "task not found");
          if (action === "lock") {
            if (typeof store.tasks.lock !== "function") return error(501, "task locking is not supported by this storage backend");
            const agentId = body.agent_id || principal.agent || "todos-serve";
            return json({ result: await store.tasks.lock(id, agentId) });
          }
          if (typeof store.tasks.unlock !== "function") return error(501, "task unlocking is not supported by this storage backend");
          if (body.force === true) {
            if (!principal.scopes.includes("todos:*")) return error(403, "force unlock requires todos:* scope");
            const released = await store.tasks.unlock(id);
            return json({ success: released });
          }
          if (body.agent_id && principal.agent && body.agent_id !== principal.agent && !principal.scopes.includes("todos:*")) {
            return error(403, "unlock agent_id must match the authenticated agent");
          }
          const agentId = principal.agent || body.agent_id;
          if (!agentId) return error(403, "unlock requires an agent-bound key or force=true");
          const released = await store.tasks.unlock(id, agentId);
          return json({ success: released });
        }
        // ── /v1/tasks/:id/dependencies[/:dep] — dependency edges ──
        if (action === "dependencies") {
          if (!store.dependencies) return error(501, "dependencies are not supported by this storage backend");
          if (method === "GET") {
            if (!(await store.tasks.get(id))) return error(404, "task not found");
            const edges = await store.dependencies.list(id);
            return json(edges);
          }
          if (method === "POST") {
            const body = (await readJson<{ depends_on?: string }>(req)) ?? {};
            if (typeof body.depends_on !== "string" || !body.depends_on.trim()) {
              return error(400, "depends_on is required");
            }
            try {
              const dependency = await store.dependencies.add(id, body.depends_on, contextFromPrincipal(principal));
              return json({ dependency }, 201);
            } catch (e) {
              const msg = (e as Error).message || "";
              if (msg.includes("not found")) return error(404, msg);
              if (msg.includes("cycle") || msg.includes("itself")) return error(409, msg);
              throw e;
            }
          }
          if (method === "DELETE") {
            if (!subId) return error(400, "dependency target id is required (/v1/tasks/:id/dependencies/:dep)");
            const removed = await store.dependencies.remove(id, subId);
            return json({ removed });
          }
          return error(405, `method ${method} not allowed on /v1/tasks/:id/dependencies`);
        }
        // ── /v1/tasks/:id/verifications — verification records ──
        if (action === "verifications") {
          if (!store.verifications) return error(501, "verifications are not supported by this storage backend");
          if (method === "GET") {
            if (!(await store.tasks.get(id))) return error(404, "task not found");
            const verifications = await store.verifications.list(id);
            return json({ verifications, count: verifications.length });
          }
          if (method === "POST") {
            const body = (await readJson<{
              command?: string;
              status?: "passed" | "failed" | "unknown";
              output_summary?: string;
              artifact_path?: string;
              agent_id?: string;
            }>(req)) ?? {};
            if (typeof body.command !== "string" || !body.command.trim()) {
              return error(400, "command is required");
            }
            try {
              const verification = await store.verifications.add(
                {
                  task_id: id,
                  command: body.command,
                  status: body.status,
                  output_summary: body.output_summary,
                  artifact_path: body.artifact_path,
                  agent_id: body.agent_id,
                },
                contextFromPrincipal(principal, body),
              );
              return json({ verification }, 201);
            } catch (e) {
              const msg = (e as Error).message || "";
              if (msg.includes("not found")) return error(404, msg);
              throw e;
            }
          }
          return error(405, `method ${method} not allowed on /v1/tasks/:id/verifications`);
        }
        // ── /v1/tasks/:id/commits — git commit links ──
        // The previous CLI/MCP `link-commit` wrote to LOCAL sqlite where the cloud
        // task does not exist, tripping a FOREIGN KEY constraint. Routing here
        // attaches the link to the REAL task in the shared dataset.
        if (action === "commits") {
          if (!store.commits) return error(501, "commit links are not supported by this storage backend");
          if (method === "GET") {
            if (!(await store.tasks.get(id))) return error(404, "task not found");
            const commits = await store.commits.list(id);
            return json({ commits, count: commits.length });
          }
          if (method === "POST") {
            const body = (await readJson<{
              sha?: string;
              message?: string;
              author?: string;
              files_changed?: string[];
            }>(req)) ?? {};
            if (typeof body.sha !== "string" || !body.sha.trim()) return error(400, "sha is required");
            try {
              const commit = await store.commits.add(
                {
                  task_id: id,
                  sha: body.sha,
                  message: body.message,
                  author: body.author,
                  files_changed: Array.isArray(body.files_changed) ? body.files_changed : undefined,
                },
                contextFromPrincipal(principal),
              );
              return json({ commit }, 201);
            } catch (e) {
              const msg = (e as Error).message || "";
              if (msg.includes("not found")) return error(404, msg);
              throw e;
            }
          }
          return error(405, `method ${method} not allowed on /v1/tasks/:id/commits`);
        }
        // ── /v1/tasks/:id/refs — git branch / pull-request links ──
        if (action === "refs") {
          if (!store.gitRefs) return error(501, "git ref links are not supported by this storage backend");
          if (method === "GET") {
            if (!(await store.tasks.get(id))) return error(404, "task not found");
            const refs = await store.gitRefs.list(id);
            return json({ refs, count: refs.length });
          }
          if (method === "POST") {
            const body = (await readJson<{
              ref_type?: string;
              name?: string;
              url?: string;
              provider?: string;
              metadata?: Record<string, unknown>;
            }>(req)) ?? {};
            const refType = body.ref_type === "pull_request" || body.ref_type === "branch" ? body.ref_type : "branch";
            if (typeof body.name !== "string" || !body.name.trim()) return error(400, "name is required");
            try {
              const ref = await store.gitRefs.add(
                {
                  task_id: id,
                  ref_type: refType,
                  name: body.name,
                  url: body.url,
                  provider: body.provider,
                  metadata: body.metadata,
                },
                contextFromPrincipal(principal),
              );
              return json({ ref }, 201);
            } catch (e) {
              const msg = (e as Error).message || "";
              if (msg.includes("not found")) return error(404, msg);
              throw e;
            }
          }
          return error(405, `method ${method} not allowed on /v1/tasks/:id/refs`);
        }
        const actionJson = await readOptionalJson(req);
        if (!actionJson.ok) return error(400, "invalid JSON body");
        const body = actionJson.value && typeof actionJson.value === "object" && !Array.isArray(actionJson.value)
          ? actionJson.value as Record<string, unknown>
          : {};
        const agentId = typeof body.agent_id === "string" ? body.agent_id : principal.agent || "todos-serve";
        if (action === "start" && method === "POST") {
          return json({ task: await store.tasks.start(id, agentId) });
        }
        if (action === "complete" && method === "POST") {
          const parsed = validateTaskCompletion(actionJson.value);
          if (!parsed.ok) return error(400, parsed.message);
          return json({
            task: await store.tasks.complete(
              id,
              parsed.agentId || principal.agent || "todos-serve",
              parsed.options,
              contextFromPrincipal(principal, body),
            ),
          });
        }
        if (action === "fail" && method === "POST") {
          return json({ result: await store.tasks.fail(id, agentId, typeof body.reason === "string" ? body.reason : "failed", {}) });
        }
        if (action === "claim" && method === "POST") {
          return json({ task: await store.tasks.claimNext(agentId, {}) });
        }
        return error(404, `unknown task action: ${action}`);
      }
      if (method === "GET") {
        let task = await store.tasks.get(id);
        // Bounded server-side resolution of a non-UUID reference (exact short_id or
        // a unique task-id prefix). Without this the CLI paged every task over HTTP
        // to expand a short ref, which hung on large shared datasets. resolveRef is
        // a single indexed lookup; it is only consulted when the exact-id get misses.
        if (!task && typeof store.tasks.resolveRef === "function") {
          try {
            task = await store.tasks.resolveRef(id);
          } catch (e) {
            const msg = (e as Error).message || "";
            if (/ambiguous/i.test(msg)) return error(409, msg);
            throw e;
          }
        }
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
          const body = await readJson<unknown>(req);
          if (!body) return error(400, "invalid JSON body");
          const validated = validateProjectCreate(body);
          if (!validated.ok) return error(400, validated.message);
          const project = await store.projects.create(validated.input, contextFromPrincipal(principal));
          return json({ project }, 201);
        }
        return error(405, `method ${method} not allowed on /v1/projects`);
      }
      if (action === "rename") {
        if (method !== "POST") return error(405, `method ${method} not allowed on /v1/projects/:id/rename`);
        const body = await readJson<RenameProjectInput>(req);
        if (!body || typeof body.new_slug !== "string" || !body.new_slug.trim() || !normalizeSlug(body.new_slug)) {
          return error(400, "new_slug must be a non-empty string");
        }
        if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) {
          return error(400, "name must be a non-empty string");
        }
        const unknownField = Object.keys(body).find((key) => !["new_slug", "name"].includes(key));
        if (unknownField) return error(400, `unknown project rename field: ${unknownField}`);
        return json(await store.projects.rename(id, body, contextFromPrincipal(principal)));
      }
      if (method === "GET") {
        const project = await store.projects.get(id);
        return project ? json({ project }) : error(404, "project not found");
      }
      if (method === "PATCH" || method === "PUT") {
        const body = await readJson<unknown>(req);
        if (!body) return error(400, "invalid JSON body");
        const validated = validateProjectPatch(body);
        if (!validated.ok) return error(400, validated.message);
        if (!(await store.projects.get(id))) return error(404, "project not found");
        const project = await store.projects.update(id, validated.patch);
        return json({ project });
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
        const body = await readJson<unknown>(req);
        const validated = validatePlanCreate(body);
        if (!validated.ok) return error(400, validated.message);
        if (validated.input.slug) {
          const scope = validated.input.project_id ?? null;
          const duplicate = (await store.plans.list(validated.input.project_id))
            .find((plan) => plan.project_id === scope && plan.slug === validated.input.slug);
          if (duplicate) {
            return error(409, `Plan slug already exists in this scope: ${validated.input.slug}`, {
              code: "PLAN_SLUG_CONFLICT",
              conflict: true,
            });
          }
        }
        const plan = await store.plans.create(validated.input, contextFromPrincipal(principal, validated.input));
        return json({ plan }, 201);
      }
      if (id && method === "GET") {
        const plan = await store.plans.get(id);
        return plan ? json({ plan }) : error(404, "plan not found");
      }
      if (id && (method === "PATCH" || method === "PUT")) {
        const body = await readJson<Record<string, unknown>>(req);
        if (!body || Object.keys(body).length === 0) return error(400, "plan patch is required");
        const allowed = new Set(["name", "slug", "description", "status", "task_list_id", "agent_id"]);
        const unknownField = Object.keys(body).find((key) => !allowed.has(key));
        if (unknownField) return error(400, `unknown plan field: ${unknownField}`);
        for (const field of ["name", "slug", "task_list_id", "agent_id"] as const) {
          if (body[field] !== undefined && (typeof body[field] !== "string" || !body[field].trim())) {
            return error(400, `${field} must be a non-empty string`);
          }
        }
        if (typeof body.slug === "string") {
          const slug = normalizeSlug(body.slug);
          if (!slug) return error(400, "slug must produce a non-empty canonical slug");
          body.slug = slug;
        }
        if (body.description !== undefined && typeof body.description !== "string") {
          return error(400, "description must be a string");
        }
        if (body.status !== undefined &&
            (typeof body.status !== "string" || !["active", "completed", "archived"].includes(body.status))) {
          return error(400, "status must be active, completed, or archived");
        }
        const existing = await store.plans.get(id);
        if (!existing) return error(404, "plan not found");
        if (typeof body.slug === "string") {
          const duplicate = (await store.plans.list(existing.project_id ?? undefined))
            .find((plan) => plan.id !== id && plan.project_id === existing.project_id && plan.slug === body.slug);
          if (duplicate) {
            return error(409, `Plan slug already exists in this scope: ${body.slug}`, {
              code: "PLAN_SLUG_CONFLICT",
              conflict: true,
            });
          }
        }
        const plan = await store.plans.update(id, body as never);
        return json({ plan });
      }
      if (id && method === "DELETE") {
        if (!(await store.plans.delete(id, contextFromPrincipal(principal)))) return error(404, "plan not found");
        return json({ deleted: true, id });
      }
      if (id) return error(405, `method ${method} not allowed on /v1/plans/:id`);
    }

    // ── /v1/templates ──
    if (resource === "templates") {
      if (!id && method === "GET") {
        const projectId = url.searchParams.get("project_id");
        const templates = (await store.templates.list()).filter((template) => projectId === null || template.project_id === projectId);
        return json({ templates, count: templates.length });
      }
      if (!id && method === "POST") {
        const body = await readJson<unknown>(req);
        const validated = validateTemplateCreate(body);
        if (!validated.ok) return error(400, validated.message);
        const template = await store.templates.create(validated.input, contextFromPrincipal(principal));
        return json({ template: await store.templates.getWithTasks(template.id) }, 201);
      }
      if (!id) return error(405, `method ${method} not allowed on /v1/templates`);
      if (method === "GET") {
        const template = await store.templates.getWithTasks(id);
        return template ? json({ template }) : error(404, "template not found");
      }
      if (method === "PATCH" || method === "PUT") {
        const body = await readJson<unknown>(req);
        const validated = validateTemplatePatch(body);
        if (!validated.ok) return error(400, validated.message);
        const template = await store.templates.update(id, validated.patch, contextFromPrincipal(principal));
        return template ? json({ template: await store.templates.getWithTasks(id) }) : error(404, "template not found");
      }
      if (method === "DELETE") {
        const deleted = await store.templates.delete(id, contextFromPrincipal(principal));
        return deleted ? json({ deleted: true, id }) : error(404, "template not found");
      }
      return error(405, `method ${method} not allowed on /v1/templates/:id`);
    }

    // ── /v1/agents ──
    if (resource === "agents") {
      if (!id && method === "GET") {
        const agents = await store.agents.list();
        return json({ agents, count: agents.length });
      }
      if (!id && method === "POST") {
        const body = await readJson<{ name?: string }>(req);
        if (!body || typeof body.name !== "string" || !body.name.trim()) return error(400, "name is required");
        const result = await store.agents.register(body as never, contextFromPrincipal(principal));
        // register() returns a conflict envelope when the name is actively held by
        // another session — surface it as 409 so the client sees a real conflict
        // instead of a 201 wrapping a non-agent object.
        if (result && typeof result === "object" && "conflict" in result) {
          return error(409, (result as { message?: string }).message ?? "agent name conflict", { conflict: true });
        }
        return json({ agent: result }, 201);
      }
      // ── /v1/agents/:id/heartbeat and /release — session lifecycle ──
      // Resolved against the SHARED cloud roster (by id OR name) so a flipped
      // machine heartbeats/releases the same agent every other agent sees. The
      // previous CLI/MCP path read LOCAL sqlite and 404'd cloud-only agents
      // ("Agent not found").
      if (id && action === "heartbeat") {
        if (method !== "POST") return error(405, `method ${method} not allowed on /v1/agents/:id/heartbeat`);
        if (typeof store.agents.heartbeat !== "function") {
          return error(501, "agent heartbeat is not supported by this storage backend");
        }
        const agent = await store.agents.heartbeat(id, contextFromPrincipal(principal));
        return agent ? json({ agent }) : error(404, "agent not found");
      }
      if (id && action === "release") {
        if (method !== "POST") return error(405, `method ${method} not allowed on /v1/agents/:id/release`);
        if (typeof store.agents.release !== "function") {
          return error(501, "agent release is not supported by this storage backend");
        }
        const body = (await readJson<{ session_id?: string }>(req)) ?? {};
        const result = await store.agents.release(id, body.session_id, contextFromPrincipal(principal));
        if (!result) return error(404, "agent not found");
        if (!result.released) {
          return error(409, "release denied: session_id does not match agent's current session", { released: false });
        }
        return json({ agent: result.agent, released: true });
      }
      if (id && method === "GET") {
        const agent = await store.agents.get(id);
        return agent ? json({ agent }) : error(404, "agent not found");
      }
    }

    // ── /v1/activity — recent task-history entries ──
    // Read-only feed powering the CLI `log` and `burndown` views on a flipped
    // machine. Previously those read this box's local sqlite task_history, so a
    // self_hosted box reported its private island instead of the shared ledger.
    if (resource === "activity" && !id) {
      if (method !== "GET") return error(405, `method ${method} not allowed on /v1/activity`);
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? Math.max(1, Math.min(10000, Number(limitParam) || 50)) : 50;
      const activity = await store.audit.getRecentActivity(limit);
      return json({ activity, count: activity.length });
    }

    // ── /v1/task-lists — task lists (optionally scoped to a project) ──
    if (resource === "task-lists") {
      if (!id && method === "GET") {
        const projectId = url.searchParams.get("project_id") ?? undefined;
        const taskLists = await store.taskLists.list(projectId);
        return json({ task_lists: taskLists, count: taskLists.length });
      }
      if (!id && method === "POST") {
        const body = await readJson<CreateTaskListInput>(req);
        if (!body || typeof body.name !== "string" || !body.name.trim()) return error(400, "name is required");
        const unknownField = Object.keys(body).find((key) => !["name", "slug", "project_id", "description", "metadata"].includes(key));
        if (unknownField) return error(400, `unsupported task-list create field: ${unknownField}`);
        if (body.slug !== undefined && typeof body.slug !== "string") return error(400, "slug must be a string");
        if (body.project_id !== undefined && (typeof body.project_id !== "string" || !body.project_id.trim())) return error(400, "project_id must be a non-empty string");
        if (body.description !== undefined && typeof body.description !== "string") return error(400, "description must be a string");
        if (body.metadata !== undefined && (!body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata))) {
          return error(400, "metadata must be an object");
        }
        if (!normalizeSlug(body.slug === undefined ? body.name : body.slug)) {
          return error(400, "task-list slug must be non-empty kebab-case");
        }
        const taskList = await store.taskLists.create(body, contextFromPrincipal(principal));
        return json({ task_list: taskList }, 201);
      }
      if (id && method === "GET") {
        const taskList = await store.taskLists.get(id);
        return taskList ? json({ task_list: taskList }) : error(404, "task list not found");
      }
      if (id && (method === "PATCH" || method === "PUT")) {
        const body = await readJson<UpdateTaskListInput>(req);
        if (!body) return error(400, "invalid JSON body");
        const unknownField = Object.keys(body).find((key) => !["slug", "name", "description", "metadata"].includes(key));
        if (unknownField) return error(400, `unsupported task-list update field: ${unknownField}`);
        if (Object.keys(body).length === 0) return error(400, "task-list update must not be empty");
        if (body.slug !== undefined && (typeof body.slug !== "string" || !normalizeSlug(body.slug))) return error(400, "slug must be a non-empty string");
        if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) return error(400, "name must be a non-empty string");
        if (body.description !== undefined && typeof body.description !== "string") return error(400, "description must be a string");
        if (body.metadata !== undefined && (!body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata))) {
          return error(400, "metadata must be an object");
        }
        if (!await store.taskLists.get(id)) return error(404, "task list not found");
        const taskList = await store.taskLists.update(id, body);
        return json({ task_list: taskList });
      }
      if (id && method === "DELETE") {
        const deleted = await store.taskLists.delete(id, contextFromPrincipal(principal));
        return deleted ? json({ deleted: true, id }) : error(404, "task list not found");
      }
      return error(405, `method ${method} not allowed on /v1/task-lists${id ? "/:id" : ""}`);
    }

    // ── /v1/dependencies — every dependency edge in the dataset ──
    // Edges are far fewer than tasks, so the whole set is cheap to return; the CLI
    // derives blocked/ready/sprint/recap dependency analytics from it client-side
    // instead of reading local sqlite.
    if (resource === "dependencies" && !id) {
      if (method !== "GET") return error(405, `method ${method} not allowed on /v1/dependencies`);
      if (typeof store.dependencies?.listAll !== "function") {
        return error(501, "dependency edge listing is not supported by this storage backend");
      }
      const dependencies = await store.dependencies.listAll();
      return json({ dependencies, count: dependencies.length });
    }

    // ── /v1/commits/:sha — find the task that explains a commit SHA ──
    if (resource === "commits" && id) {
      if (method !== "GET") return error(405, `method ${method} not allowed on /v1/commits/:sha`);
      if (!store.commits) return error(501, "commit links are not supported by this storage backend");
      const commit = await store.commits.find(id);
      return json({ commit: commit ?? null });
    }

    // ── /v1/refs/:ref — find tasks linked to a branch / pull request ──
    if (resource === "refs" && id) {
      if (method !== "GET") return error(405, `method ${method} not allowed on /v1/refs/:ref`);
      if (!store.gitRefs) return error(501, "git ref links are not supported by this storage backend");
      const refs = await store.gitRefs.find(id);
      return json({ refs, count: refs.length });
    }

    // ── /v1/next — the best pending task to work on next ──
    // Priority-ranked pick from the shared queue (parity with the CLI `next`
    // command's local getNextTask). Returns `{ task: null }` when the queue is empty.
    if (resource === "next" && !id) {
      if (method !== "GET") return error(405, `method ${method} not allowed on /v1/next`);
      const agent = url.searchParams.get("agent") ?? undefined;
      const filters = {
        ...(url.searchParams.get("project_id") ? { project_id: url.searchParams.get("project_id")! } : {}),
        ...(url.searchParams.get("task_list_id") ? { task_list_id: url.searchParams.get("task_list_id")! } : {}),
        ...(url.searchParams.get("plan_id") ? { plan_id: url.searchParams.get("plan_id")! } : {}),
      };
      const task = await store.tasks.getNext(agent, filters as never);
      return json({ task: task ?? null });
    }

    // ── /v1/stats ──
    // `tasks` keeps its historical meaning (top-level tasks, subtasks excluded) for
    // back-compat, while `tasks_all` is the TRUE row count including subtasks —
    // the number to compare against a local sqlite `count(*) from tasks` when
    // proving fleet-union parity (the top-level count structurally under-reports).
    if (resource === "stats" && method === "GET") {
      const [tasks, tasksAll, projects] = await Promise.all([
        store.tasks.count(),
        store.tasks.count({ include_subtasks: true } as never),
        store.projects.list(),
      ]);
      return json({ tasks, tasks_all: tasksAll, subtasks: tasksAll - tasks, projects: projects.length });
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
    if (e instanceof LockError) return error(409, e.message, { code: LockError.code });
    if (e instanceof ResourceConflictError) return error(409, e.message, { code: e.code, conflict: true });
    if (e instanceof ProjectNotFoundError) return error(404, e.message, { code: ProjectNotFoundError.code });
    return error(500, (e as Error).message || "internal error");
  }
}
