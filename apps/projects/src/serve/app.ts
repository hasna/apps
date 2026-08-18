// projects-serve HTTP application (framework-agnostic Bun.serve handler).
//
// Amendment A1 pure-remote: every /v1 request reads/writes cloud Postgres via
// the ProjectsPgStore. Auth is @hasna/contracts API-key verification
// (verifyApiKey), scoped projects:read for reads and projects:write for writes.

import {
  verifyApiKey,
  type ApiKeyStatus,
  type ApiKeyVerifier,
  type AuthAuditHook,
} from "@hasna/contracts/auth";
import {
  NotFoundError,
  ProjectsPgStore,
  ValidationError,
  WORKSPACE_LIST_DEFAULT_LIMIT,
  WORKSPACE_LIST_MAX_LIMIT,
} from "./pg-store.js";
import { buildOpenApiSpec } from "./openapi.js";
import { responseControl } from "../lib/guarded-project-mutation.js";
import {
  attachProjectContact,
  detachProjectContact,
  listProjectContacts,
  type ContactProjectMembershipAuthority,
  ProjectContactLinkOperationError,
} from "../lib/project-contact-links.js";
import { ContactsAuthorityHttpError } from "../lib/contacts-authority-adapter.js";

export interface ServeAppOptions {
  store: ProjectsPgStore;
  contacts?: ContactProjectMembershipAuthority;
  version: string;
  app?: string;
  signingSecret: string | Buffer;
  keyStatus?: (kid: string) => ApiKeyStatus | Promise<ApiKeyStatus>;
  allowUnregisteredKeys?: boolean;
  audit?: AuthAuditHook;
}

const READ_SCOPE = "projects:read";
const WRITE_SCOPE = "projects:write";

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

function boundedJsonResponse(body: unknown, bounds: { response_byte_limit: number; time_budget_ms: number }, startedAtMs: number, status = 200): Response {
  const payload = {
    ...(body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : { data: body }),
  };
  payload["response_control"] = responseControl(payload, bounds, startedAtMs);
  return jsonResponse(payload, status);
}

function guardedJsonResponse(body: unknown, bounds: { response_byte_limit: number; time_budget_ms: number }, startedAtMs: number, status = 200): Response {
  if (body && typeof body === "object" && !Array.isArray(body) && "response_control" in body) {
    return jsonResponse(body, status);
  }
  return boundedJsonResponse(body, bounds, startedAtMs, status);
}

function errorResponse(message: string, status: number, reason?: string): Response {
  return jsonResponse(reason ? { error: message, reason } : { error: message }, status);
}

function statusForError(err: unknown): number {
  if (err instanceof NotFoundError) return 404;
  if (err instanceof ValidationError) return 400;
  if (err instanceof ContactsAuthorityHttpError) return err.status;
  if (err instanceof ProjectContactLinkOperationError) {
    const causeStatus = statusForError(err.cause);
    if (causeStatus !== 500) return causeStatus;
    if (
      err.cause instanceof Error
      && /(not accepted|revision|precondition|conflict|expected[_ ]version)/i.test(err.cause.message)
    ) {
      return 409;
    }
    return 502;
  }
  return 500;
}

function toBool(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
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
  const { store, version, contacts } = options;
  const appName = options.app ?? "projects";
  const verifier: ApiKeyVerifier = verifyApiKey({
    app: appName,
    signingSecret: options.signingSecret,
    ...(options.keyStatus ? { keyStatus: options.keyStatus } : {}),
    ...(options.allowUnregisteredKeys ? { allowUnregisteredKeys: true } : {}),
    ...(options.audit ? { audit: options.audit } : {}),
  });

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();

    // --- unauthenticated probes ---
    if (path === "/health" && method === "GET") {
      return jsonResponse({ status: "ok", version });
    }
    if (path === "/version" && method === "GET") {
      return jsonResponse({ status: "ok", version });
    }
    if (path === "/ready" && method === "GET") {
      try {
        const ok = await store.ping();
        return ok
          ? jsonResponse({ status: "ready", version })
          : jsonResponse({ status: "degraded", version }, 503);
      } catch {
        return jsonResponse({ status: "unavailable", version }, 503);
      }
    }
    if (path === "/openapi.json" && method === "GET") {
      return jsonResponse(buildOpenApiSpec(version));
    }
    if (path === "/" && method === "GET") {
      return jsonResponse({ name: `${appName}-serve`, version, openapi: "/openapi.json" });
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

    try {
      return await route(req, url, path, method, store, contacts);
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
  contacts?: ContactProjectMembershipAuthority,
): Promise<Response> {
  const segments = path.split("/").filter(Boolean); // e.g. ["v1","projects","abc","events"]
  const [, resource, id, sub, extra, action] = segments;

  // ---------------- projects ----------------
  if (resource === "projects") {
    if (!id) {
      if (method === "GET") {
        const q = url.searchParams;
        const tag = q.get("tag");
        const filter = {
          ...(q.get("status") ? { status: q.get("status") as never } : {}),
          ...(q.get("kind") ? { kind: q.get("kind") as never } : {}),
          ...(q.get("root_id") ? { root_id: q.get("root_id")! } : {}),
          ...(q.get("query") ? { query: q.get("query")! } : {}),
          ...(tag ? { tags: [tag] } : {}),
          ...(q.get("limit") ? { limit: Number(q.get("limit")) } : {}),
          ...(q.get("offset") ? { offset: Number(q.get("offset")) } : {}),
        };
        const workspaces = await store.listWorkspaces(filter);
        // `count` is the page length and always was; a client comparing it to
        // its requested limit cannot tell a full page from the last page. Report
        // the match `total` and an explicit `has_more` so a bounded response can
        // never again pass for a complete one.
        const offset = Math.max(Number(q.get("offset") ?? 0) || 0, 0);
        const total = await store.countWorkspaces(filter);
        return jsonResponse({
          workspaces,
          count: workspaces.length,
          total,
          offset,
          limit: Math.min(Math.max(filter.limit ?? WORKSPACE_LIST_DEFAULT_LIMIT, 1), WORKSPACE_LIST_MAX_LIMIT),
          has_more: offset + workspaces.length < total,
          complete: offset === 0 && workspaces.length === total,
        });
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

    if (sub === "guarded-metadata" && extra === undefined && method === "GET") {
      const started = Date.now();
      const bounds = {
        response_byte_limit: Number(url.searchParams.get("response_byte_limit")),
        time_budget_ms: Number(url.searchParams.get("time_budget_ms")),
      };
      const result = await store.guardedReadWorkspace({
        project_id: id,
        resource_link_max_items: Number(url.searchParams.get("resource_link_max_items") ?? 1_000),
        ...bounds,
      }, started);
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "guarded-metadata" && extra === undefined && method === "POST") {
      const started = Date.now();
      const body = await readJsonBody(req);
      const bounds = {
        response_byte_limit: Number(body.response_byte_limit),
        time_budget_ms: Number(body.time_budget_ms),
      };
      const result = await store.guardedUpdateWorkspace({ ...body, project_id: id } as never);
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "guarded-metadata" && extra === "receipts" && method === "GET") {
      const started = Date.now();
      const bounds = {
        response_byte_limit: Number(url.searchParams.get("response_byte_limit")),
        time_budget_ms: Number(url.searchParams.get("time_budget_ms")),
      };
      const result = await store.lookupGuardedWorkspaceMutationReceipt({
        project_id: id,
        operation_id: url.searchParams.get("operation_id") ?? "",
        step_id: url.searchParams.get("step_id") ?? "",
        direction: (url.searchParams.get("direction") ?? "forward") as never,
        idempotency_key: url.searchParams.get("idempotency_key") ?? "",
        max_items: Number(url.searchParams.get("max_items")) as 1,
        ...bounds,
      });
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "guarded-metadata" && extra === "rollback" && method === "POST") {
      const started = Date.now();
      const body = await readJsonBody(req);
      const bounds = {
        response_byte_limit: Number(body.response_byte_limit),
        time_budget_ms: Number(body.time_budget_ms),
      };
      const result = await store.rollbackGuardedWorkspaceMutation({ ...body, project_id: id } as never);
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "resource-links" && extra === undefined && method === "GET") {
      const started = Date.now();
      const bounds = {
        response_byte_limit: Number(url.searchParams.get("response_byte_limit")),
        time_budget_ms: Number(url.searchParams.get("time_budget_ms")),
      };
      const result = await store.readProjectResourceLinks({
        project_id: id,
        max_items: Number(url.searchParams.get("max_items")),
        ...bounds,
      }, started);
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "resource-links" && (extra === "add" || extra === "reconcile") && method === "POST") {
      const started = Date.now();
      const body = await readJsonBody(req);
      const bounds = {
        response_byte_limit: Number(body.response_byte_limit),
        time_budget_ms: Number(body.time_budget_ms),
      };
      const result = await store.mutateProjectResourceLinks({
        ...body,
        project_id: id,
        mode: extra,
      } as never);
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "resource-links" && extra === "rollback" && method === "POST") {
      const started = Date.now();
      const body = await readJsonBody(req);
      const bounds = {
        response_byte_limit: Number(body.response_byte_limit),
        time_budget_ms: Number(body.time_budget_ms),
      };
      const result = await store.rollbackProjectResourceLinks({ ...body, project_id: id } as never);
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "duplicate-quarantine" && extra === undefined && method === "GET") {
      const started = Date.now();
      const bounds = {
        response_byte_limit: Number(url.searchParams.get("response_byte_limit")),
        time_budget_ms: Number(url.searchParams.get("time_budget_ms")),
      };
      const result = await store.readDuplicateProjectQuarantinePreimage({
        project_id: id,
        resource_link_max_items: Number(url.searchParams.get("resource_link_max_items")),
        workspace_location_max_items: Number(url.searchParams.get("workspace_location_max_items")),
        ...bounds,
      }, started);
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "duplicate-quarantine" && extra === undefined && method === "POST") {
      const started = Date.now();
      const body = await readJsonBody(req);
      const bounds = {
        response_byte_limit: Number(body.response_byte_limit),
        time_budget_ms: Number(body.time_budget_ms),
      };
      const result = await store.quarantineDuplicateProject({ ...body, project_id: id } as never);
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "duplicate-quarantine" && extra === "rollback" && method === "POST") {
      const started = Date.now();
      const body = await readJsonBody(req);
      const bounds = {
        response_byte_limit: Number(body.response_byte_limit),
        time_budget_ms: Number(body.time_budget_ms),
      };
      const result = await store.rollbackDuplicateProjectQuarantine({ ...body, project_id: id } as never);
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "resource-link-migrations" && extra === "plan" && action === undefined && method === "POST") {
      const started = Date.now();
      const body = await readJsonBody(req);
      const bounds = {
        response_byte_limit: Number(body.response_byte_limit),
        time_budget_ms: Number(body.time_budget_ms),
      };
      const result = await store.planProjectResourceLinkMigration({ ...body, project_id: id } as never);
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "resource-link-migrations" && extra && action === undefined && method === "GET") {
      const started = Date.now();
      const bounds = {
        response_byte_limit: Number(url.searchParams.get("response_byte_limit")),
        time_budget_ms: Number(url.searchParams.get("time_budget_ms")),
      };
      const result = await store.readProjectResourceLinkMigration({
        project_id: id,
        manifest_id: extra,
        max_items: Number(url.searchParams.get("max_items")),
        ...bounds,
      });
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "resource-link-migrations" && extra && action === "advance" && method === "POST") {
      const started = Date.now();
      const body = await readJsonBody(req);
      const bounds = {
        response_byte_limit: Number(body.response_byte_limit),
        time_budget_ms: Number(body.time_budget_ms),
      };
      const result = await store.advanceProjectResourceLinkMigration({
        ...body,
        project_id: id,
        manifest_id: extra,
      } as never);
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "resource-link-migrations" && extra && action === "rollback" && method === "POST") {
      const started = Date.now();
      const body = await readJsonBody(req);
      const bounds = {
        response_byte_limit: Number(body.response_byte_limit),
        time_budget_ms: Number(body.time_budget_ms),
      };
      const result = await store.rollbackProjectResourceLinkMigration({
        ...body,
        project_id: id,
        manifest_id: extra,
      } as never);
      return guardedJsonResponse(result, bounds, started);
    }
    if (sub === "contacts") {
      if (!contacts) return errorResponse("Contacts authority is not configured", 503);
      if (extra === undefined && method === "GET") {
        const started = Date.now();
        const bounds = {
          max_items: Number(url.searchParams.get("max_items")),
          response_byte_limit: Number(url.searchParams.get("response_byte_limit")),
          time_budget_ms: Number(url.searchParams.get("time_budget_ms")),
        };
        const result = await listProjectContacts({ projects: store, contacts }, {
          project_id: id,
          ...bounds,
        });
        return boundedJsonResponse(result, bounds, started);
      }
      if (extra && (action === "attach" || action === "detach") && method === "POST") {
        const started = Date.now();
        const body = await readJsonBody(req);
        const bounds = {
          max_items: Number(body.max_items),
          response_byte_limit: Number(body.response_byte_limit),
          time_budget_ms: Number(body.time_budget_ms),
        };
        const mutation = action === "attach" ? attachProjectContact : detachProjectContact;
        const result = await mutation({ projects: store, contacts }, {
          project_id: id,
          contact_id: extra,
          operation_id: String(body.operation_id ?? ""),
          ...(body.labels && typeof body.labels === "object" ? { labels: body.labels as never } : {}),
          ...bounds,
          source: "system",
          command: `${method} ${path}`,
        });
        return boundedJsonResponse(result, bounds, started);
      }
      return errorResponse("Method not allowed", 405);
    }

    if (sub === "archive" && method === "POST") return jsonResponse(await store.archiveWorkspace(id));
    if (sub === "unarchive" && method === "POST") return jsonResponse(await store.unarchiveWorkspace(id));
    if (sub === "events" && method === "GET") {
      const ws = await store.requireWorkspace(id);
      const limit = url.searchParams.get("limit");
      const events = await store.listWorkspaceEvents(ws.id, limit ? Number(limit) : undefined);
      return jsonResponse({ events, count: events.length });
    }
    if (sub === "locations" && method === "GET") {
      const ws = await store.requireWorkspace(id);
      const locations = await store.listWorkspaceLocations(ws.id);
      return jsonResponse({ locations, count: locations.length });
    }
    if (sub === "events" && method === "POST") {
      const ws = await store.requireWorkspace(id);
      const body = await readJsonBody(req);
      if (typeof body.event_type !== "string" || !body.event_type.trim()) {
        throw new ValidationError("event_type is required");
      }
      const event = await store.recordEvent({
        workspace_id: ws.id,
        agent_id: typeof body.agent_id === "string" ? body.agent_id : undefined,
        event_type: body.event_type,
        source: (typeof body.source === "string" ? body.source : "system") as never,
        prompt: typeof body.prompt === "string" ? body.prompt : undefined,
        command: typeof body.command === "string" ? body.command : undefined,
        before: (body.before ?? undefined) as never,
        after: (body.after ?? undefined) as never,
        metadata: (body.metadata ?? undefined) as never,
      });
      return jsonResponse({ event }, 201);
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

  if (resource === "machines") {
    if (id) return errorResponse("Not found", 404);
    if (method === "GET") {
      const machines = await store.listMachines();
      return jsonResponse({ machines, count: machines.length });
    }
    return errorResponse("Method not allowed", 405);
  }

  return errorResponse("Not found", 404);
}
