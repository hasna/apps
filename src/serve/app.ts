// projects-serve HTTP application (framework-agnostic Bun.serve handler).
//
// Amendment A1 pure-remote: every /v1 request reads/writes cloud Postgres via
// the ProjectsPgStore. Auth is @hasna/contracts API-key verification
// (verifyApiKey), scoped projects:read for reads and projects:write for writes.
//
// TENANCY (R1): after auth succeeds the verified principal is resolved to a
// (tenant_id, user_id) via the kid->tenant bridge (serve/tenancy.ts). The store
// used for the request is scoped to that tenant, so every query is tenant-bound.
// When a real pool is supplied the request runs in a transaction that also sets
// the `app.tenant_id` GUC (RLS pre-staging) — RLS itself is enabled in R2.
// R1 is NOT fail-closed: an unbound valid key resolves to the ROOT tenant.

import { verifyApiKey, type ApiKeyPrincipal, type ApiKeyVerifier, type AuthAuditHook } from "@hasna/contracts/auth";
import type { PoolQueryClient } from "../generated/storage-kit/query.js";
import { NotFoundError, ProjectsPgStore, ValidationError } from "./pg-store.js";
import { buildOpenApiSpec } from "./openapi.js";
import { resolveTenantContext, rootTenantContext, type TenantContext } from "./tenancy.js";

export interface ServeAppOptions {
  /** Static store (tests / simple embedding). Provide this OR `db`. */
  store?: ProjectsPgStore;
  /** Pool client for per-request tenant-scoped transactions (production). */
  db?: PoolQueryClient;
  /** Resolve a verified principal to a tenant context (the kid bridge). */
  resolveTenant?: (principal: ApiKeyPrincipal) => Promise<TenantContext>;
  version: string;
  app?: string;
  signingSecret: string | Buffer;
  isRevoked?: (kid: string) => boolean | Promise<boolean>;
  audit?: AuthAuditHook;
  /** Reported in /health,/ready,/version. Defaults to "cloud". */
  mode?: string;
}

const READ_SCOPE = "projects:read";
const WRITE_SCOPE = "projects:write";

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

function errorResponse(message: string, status: number, reason?: string): Response {
  return jsonResponse(reason ? { error: message, reason } : { error: message }, status);
}

function statusForError(err: unknown): number {
  if (err instanceof NotFoundError) return 404;
  if (err instanceof ValidationError) return 400;
  return 500;
}

function toBool(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function numParam(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    throw new ValidationError("request body must be a JSON object");
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError("invalid JSON body");
  }
}

/** Build the fetch handler used by Bun.serve (and directly testable). */
export function createFetchHandler(options: ServeAppOptions): (req: Request) => Promise<Response> {
  const { version } = options;
  const appName = options.app ?? "projects";
  const mode = options.mode ?? "cloud";
  if (!options.store && !options.db) {
    throw new Error("createFetchHandler requires either `store` or `db`.");
  }
  const baseStore = options.store ?? new ProjectsPgStore(options.db!);
  const verifier: ApiKeyVerifier = verifyApiKey({
    app: appName,
    signingSecret: options.signingSecret,
    ...(options.isRevoked ? { isRevoked: options.isRevoked } : {}),
    ...(options.audit ? { audit: options.audit } : {}),
  });

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();

    // --- unauthenticated probes ---
    if (path === "/health" && method === "GET") {
      return jsonResponse({ status: "ok", version, mode });
    }
    if (path === "/version" && method === "GET") {
      return jsonResponse({ status: "ok", version, mode });
    }
    if (path === "/ready" && method === "GET") {
      try {
        const ok = await baseStore.ping();
        return ok
          ? jsonResponse({ status: "ready", version, mode })
          : jsonResponse({ status: "degraded", version, mode }, 503);
      } catch {
        return jsonResponse({ status: "unavailable", version, mode }, 503);
      }
    }
    if (path === "/openapi.json" && method === "GET") {
      return jsonResponse(buildOpenApiSpec(version));
    }
    if (path === "/" && method === "GET") {
      return jsonResponse({ name: `${appName}-serve`, version, mode, openapi: "/openapi.json" });
    }

    // --- everything under /v1 requires auth ---
    if (!path.startsWith("/v1/")) {
      return errorResponse("Not found", 404);
    }

    const requiredScopes = method === "GET" ? [READ_SCOPE] : [WRITE_SCOPE];
    const decision = await verifier.authenticate(req.headers, { method, path, requiredScopes });
    if (!decision.ok) {
      return errorResponse(decision.message, decision.status, decision.reason);
    }

    // Resolve the tenant context server-side from the verified principal.
    let ctx: TenantContext;
    try {
      ctx = options.resolveTenant
        ? await options.resolveTenant(decision.principal)
        : rootTenantContext(decision.principal.kid);
    } catch {
      ctx = rootTenantContext(decision.principal.kid);
    }

    try {
      // Production path: per-request transaction + RLS GUC pre-staging.
      if (options.db) {
        return await options.db.transaction(async (tx) => {
          await tx.execute("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
          await tx.execute("SELECT set_config('app.principal_type', $1, true)", [ctx.principalType]);
          if (ctx.userId) await tx.execute("SELECT set_config('app.principal_id', $1, true)", [ctx.userId]);
          const scoped = new ProjectsPgStore(tx, { tenantId: ctx.tenantId });
          return route(req, url, path, method, scoped, ctx);
        });
      }
      // Test / embedded path: forTenant clone when available, else the store as-is.
      const scoped =
        typeof baseStore.forTenant === "function" ? baseStore.forTenant(ctx.tenantId) : baseStore;
      return await route(req, url, path, method, scoped, ctx);
    } catch (err) {
      const status = statusForError(err);
      const message = err instanceof Error ? err.message : "internal error";
      if (status === 500) console.error("projects-serve error:", err);
      return errorResponse(message, status);
    }
  };
}

async function route(
  req: Request,
  url: URL,
  path: string,
  method: string,
  store: ProjectsPgStore,
  ctx: TenantContext,
): Promise<Response> {
  const segments = path.split("/").filter(Boolean); // e.g. ["v1","projects","abc","events"]
  const [, resource, id, sub, subId] = segments;

  // ---------------- projects ----------------
  if (resource === "projects") {
    if (!id) {
      if (method === "GET") {
        const q = url.searchParams;
        const tag = q.get("tag");
        const workspaces = await store.listWorkspaces({
          ...(q.get("status") ? { status: q.get("status") as never } : {}),
          ...(q.get("kind") ? { kind: q.get("kind") as never } : {}),
          ...(q.get("root_id") ? { root_id: q.get("root_id")! } : {}),
          ...(q.get("query") ? { query: q.get("query")! } : {}),
          ...(tag ? { tags: [tag] } : {}),
          ...(numParam(q.get("limit")) !== undefined ? { limit: numParam(q.get("limit")) } : {}),
          ...(numParam(q.get("offset")) !== undefined ? { offset: numParam(q.get("offset")) } : {}),
        });
        return jsonResponse({ workspaces, count: workspaces.length });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        const workspace = await store.createWorkspace(body as never);
        return jsonResponse(workspace, 201);
      }
      return errorResponse("Method not allowed", 405);
    }

    if (!sub) {
      if (method === "GET") return jsonResponse(await store.requireWorkspace(id));
      if (method === "PATCH" || method === "PUT") {
        const body = await readJsonBody(req);
        return jsonResponse(await store.updateWorkspace(id, body as never));
      }
      if (method === "DELETE") {
        const hard = toBool(url.searchParams.get("hard"));
        const result = await store.deleteWorkspace(id, { hard });
        return jsonResponse({ deleted: true, hard: result.hard, id: result.workspace.id });
      }
      return errorResponse("Method not allowed", 405);
    }

    if (sub === "archive" && method === "POST") return jsonResponse(await store.archiveWorkspace(id));
    if (sub === "unarchive" && method === "POST") return jsonResponse(await store.unarchiveWorkspace(id));
    if (sub === "events" && method === "GET") {
      const ws = await store.requireWorkspace(id);
      const limit = numParam(url.searchParams.get("limit"));
      const events = await store.listWorkspaceEvents(ws.id, limit);
      return jsonResponse({ events, count: events.length });
    }
    if (sub === "locations") {
      const ws = await store.requireWorkspace(id);
      if (method === "GET") {
        const locations = await store.listWorkspaceLocations(ws.id);
        return jsonResponse({ locations, count: locations.length });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        const location = await store.addWorkspaceLocation({ ...(body as object), workspace_id: ws.id } as never);
        return jsonResponse(location, 201);
      }
      return errorResponse("Method not allowed", 405);
    }
    if (sub === "agents") {
      const ws = await store.requireWorkspace(id);
      if (method === "GET") {
        const agents = await store.listWorkspaceAgents(ws.id);
        return jsonResponse({ agents, count: agents.length });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        const assignment = await store.assignWorkspaceAgent({ ...(body as object), workspace_id: ws.id } as never);
        return jsonResponse(assignment, 201);
      }
      return errorResponse("Method not allowed", 405);
    }
    if (sub === "sessions") {
      const ws = await store.requireWorkspace(id);
      if (method === "GET") {
        const sessions = await store.listWorkspaceTmuxSessions(ws.id);
        return jsonResponse({ sessions, count: sessions.length });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        const session = await store.recordWorkspaceTmuxSession({ ...(body as object), workspace_id: ws.id } as never);
        return jsonResponse(session, 201);
      }
      return errorResponse("Method not allowed", 405);
    }
    if (sub === "locks" && method === "GET") {
      const ws = await store.requireWorkspace(id);
      const locks = await store.listWorkspaceLocks(ws.id);
      return jsonResponse({ locks, count: locks.length });
    }
    return errorResponse("Not found", 404);
  }

  // ---------------- roots ----------------
  if (resource === "roots") {
    if (!id) {
      if (method === "GET") {
        const roots = await store.listRoots();
        return jsonResponse({ roots, count: roots.length });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        return jsonResponse(await store.createRoot(body as never), 201);
      }
      return errorResponse("Method not allowed", 405);
    }
    if (method === "GET") {
      const root = await store.getRoot(id);
      if (!root) return errorResponse(`Root not found: ${id}`, 404);
      return jsonResponse(root);
    }
    if (method === "PATCH" || method === "PUT") {
      const body = await readJsonBody(req);
      return jsonResponse(await store.updateRoot(id, body as never));
    }
    if (method === "DELETE") {
      const detach = toBool(url.searchParams.get("detach"));
      const result = await store.deleteRoot(id, detach);
      return jsonResponse({ deleted: true, id: result.root.id, detached_workspaces: result.detached_workspaces });
    }
    return errorResponse("Method not allowed", 405);
  }

  // ---------------- agents ----------------
  if (resource === "agents") {
    if (!id) {
      if (method === "GET") {
        const agents = await store.listAgents();
        return jsonResponse({ agents, count: agents.length });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        return jsonResponse(await store.createAgent(body as never), 201);
      }
      return errorResponse("Method not allowed", 405);
    }
    if (method === "GET") {
      const agent = await store.getAgent(id);
      if (!agent) return errorResponse(`Agent not found: ${id}`, 404);
      return jsonResponse(agent);
    }
    return errorResponse("Method not allowed", 405);
  }

  // ---------------- recipes ----------------
  if (resource === "recipes") {
    if (!id) {
      if (method === "GET") {
        const recipes = await store.listRecipes();
        return jsonResponse({ recipes, count: recipes.length });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        return jsonResponse(await store.createRecipe(body as never), 201);
      }
      return errorResponse("Method not allowed", 405);
    }
    if (method === "GET") {
      const recipe = await store.getRecipe(id);
      if (!recipe) return errorResponse(`Recipe not found: ${id}`, 404);
      return jsonResponse(recipe);
    }
    return errorResponse("Method not allowed", 405);
  }

  // ---------------- agent runs ----------------
  if (resource === "runs") {
    if (!id) {
      if (method === "GET") {
        const q = url.searchParams;
        const runs = await store.listAgentRuns({
          ...(q.get("workspace_id") ? { workspace_id: q.get("workspace_id")! } : {}),
          ...(q.get("agent_id") ? { agent_id: q.get("agent_id")! } : {}),
          ...(q.get("status") ? { status: q.get("status")! } : {}),
          ...(numParam(q.get("limit")) !== undefined ? { limit: numParam(q.get("limit")) } : {}),
          ...(numParam(q.get("offset")) !== undefined ? { offset: numParam(q.get("offset")) } : {}),
        });
        return jsonResponse({ runs, count: runs.length });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        return jsonResponse(await store.createAgentRun(body as never), 201);
      }
      return errorResponse("Method not allowed", 405);
    }
    if (method === "GET") {
      const run = await store.getAgentRun(id);
      if (!run) return errorResponse(`Agent run not found: ${id}`, 404);
      return jsonResponse(run);
    }
    if (method === "PATCH" || method === "PUT") {
      const body = await readJsonBody(req);
      return jsonResponse(await store.updateAgentRun(id, body as never));
    }
    return errorResponse("Method not allowed", 405);
  }

  // ---------------- budgets ----------------
  if (resource === "budgets") {
    if (!id) {
      if (method === "GET") {
        const q = url.searchParams;
        const budgets = await store.listBudgets({
          ...(q.get("scope_type") ? { scope_type: q.get("scope_type")! } : {}),
          ...(q.get("scope_id") ? { scope_id: q.get("scope_id")! } : {}),
          ...(numParam(q.get("limit")) !== undefined ? { limit: numParam(q.get("limit")) } : {}),
          ...(numParam(q.get("offset")) !== undefined ? { offset: numParam(q.get("offset")) } : {}),
        });
        return jsonResponse({ budgets, count: budgets.length });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        return jsonResponse(await store.createBudget(body as never), 201);
      }
      return errorResponse("Method not allowed", 405);
    }
    if (method === "GET") {
      const budget = await store.getBudget(id);
      if (!budget) return errorResponse(`Budget not found: ${id}`, 404);
      return jsonResponse(budget);
    }
    if (method === "DELETE") {
      const budget = await store.deleteBudget(id);
      return jsonResponse({ deleted: true, id: budget.id });
    }
    return errorResponse("Method not allowed", 405);
  }

  // ---------------- budget spend ----------------
  if (resource === "spend") {
    if (!id) {
      if (method === "GET") {
        const q = url.searchParams;
        const spend = await store.listSpend({
          ...(q.get("workspace_id") ? { workspace_id: q.get("workspace_id")! } : {}),
          ...(q.get("run_id") ? { run_id: q.get("run_id")! } : {}),
          ...(numParam(q.get("limit")) !== undefined ? { limit: numParam(q.get("limit")) } : {}),
          ...(numParam(q.get("offset")) !== undefined ? { offset: numParam(q.get("offset")) } : {}),
        });
        return jsonResponse({ spend, count: spend.length });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        return jsonResponse(await store.recordSpend(body as never), 201);
      }
      return errorResponse("Method not allowed", 405);
    }
    return errorResponse("Method not allowed", 405);
  }

  // ---------------- tmux profiles ----------------
  if (resource === "tmux-profiles") {
    if (!id) {
      if (method === "GET") {
        const profiles = await store.listTmuxProfiles();
        return jsonResponse({ profiles, count: profiles.length });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        return jsonResponse(await store.createTmuxProfile(body as never), 201);
      }
      return errorResponse("Method not allowed", 405);
    }
    if (!sub) {
      if (method === "GET") {
        const profile = await store.getTmuxProfile(id);
        if (!profile) return errorResponse(`Tmux profile not found: ${id}`, 404);
        return jsonResponse(profile);
      }
      return errorResponse("Method not allowed", 405);
    }
    if (sub === "windows") {
      const profile = await store.getTmuxProfile(id);
      if (!profile) return errorResponse(`Tmux profile not found: ${id}`, 404);
      if (method === "GET") {
        const windows = await store.listTmuxProfileWindows(profile.id);
        return jsonResponse({ windows, count: windows.length });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        return jsonResponse(await store.addTmuxProfileWindow(profile.id, body as never), 201);
      }
      return errorResponse("Method not allowed", 405);
    }
    return errorResponse("Not found", 404);
  }

  // ---------------- locks ----------------
  if (resource === "locks") {
    if (!id) {
      if (method === "GET") {
        const q = url.searchParams;
        const locks = await store.listWorkspaceLocks(q.get("workspace_id") ?? undefined);
        return jsonResponse({ locks, count: locks.length });
      }
      if (method === "POST") {
        const body = await readJsonBody(req);
        return jsonResponse(await store.acquireWorkspaceLock(body as never), 201);
      }
      return errorResponse("Method not allowed", 405);
    }
    if (method === "DELETE") {
      const released = await store.releaseWorkspaceLock(id);
      return jsonResponse({ released, lock_key: id });
    }
    return errorResponse("Method not allowed", 405);
  }

  // ---------------- child deletes ----------------
  if (resource === "locations" && id && method === "DELETE") {
    await store.deleteWorkspaceLocation(id);
    return jsonResponse({ deleted: true, id });
  }
  if (resource === "workspace-agents" && id && method === "DELETE") {
    await store.removeWorkspaceAgent(id);
    return jsonResponse({ deleted: true, id });
  }
  if (resource === "sessions" && id && method === "DELETE") {
    await store.deleteWorkspaceTmuxSession(id);
    return jsonResponse({ deleted: true, id });
  }

  void subId;
  void ctx;
  return errorResponse("Not found", 404);
}
