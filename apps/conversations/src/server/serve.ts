#!/usr/bin/env bun
/**
 * Local HTTP + MCP server.
 * Serves JSON API routes backed by the active Store.
 *
 * Usage:
 *   conversations-serve          # Start the API server (PostgreSQL backend)
 *   bun run src/server/serve.ts  # Start the local HTTP server
 */

// Every data read goes through getStore(). Importing the sync helpers from
// ../lib/* directly — as this file did until task d211f560 — makes the dashboard
// local-SQLite-only BY CONSTRUCTION, because those helpers ARE the sqlite path and
// have no knowledge of the cloud transport. That is not a latent risk: on the
// owner's Mac it rendered 358 of the fleet's 1124 channels with no error shown.
import { getDbPath } from "../lib/db.js";
import { getStore, ConversationsStoreConfigError } from "../lib/store/index.js";
import { storeStatusLocation } from "../lib/store/status-location.js";
import {
  resolveAliasedString,
  resolveCollectionQueryOptions,
  resolveExportFormat,
  resolveIso8601Date,
  resolvePresentString,
} from "../lib/strict-query-values.js";
import { handleMcpRequest, healthPayload } from "../mcp/http.js";
import { buildServer } from "../mcp/index.js";

function securityHeaders(base?: HeadersInit): Headers {
  const headers = new Headers(base);
  if (!headers.has("X-Content-Type-Options")) headers.set("X-Content-Type-Options", "nosniff");
  if (!headers.has("X-Frame-Options")) headers.set("X-Frame-Options", "DENY");
  if (!headers.has("Referrer-Policy")) headers.set("Referrer-Policy", "no-referrer");
  if (!headers.has("Permissions-Policy")) {
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  }
  if (!headers.has("Cross-Origin-Resource-Policy")) {
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }
  if (!headers.has("Content-Security-Policy")) {
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'"
    );
  }
  return headers;
}

/**
 * Filter object fields based on ?fields= query param.
 * Usage: /api/messages?fields=id,from_agent,content
 */
function applyFields<T>(data: T, fields?: string | null): unknown {
  if (!fields) return data;
  const keys = fields.split(",").map(s => s.trim()).filter(Boolean);
  if (!keys.length) return data;
  if (Array.isArray(data)) {
    return data.map(item => {
      if (item && typeof item === "object") {
        const out: Record<string, unknown> = {};
        for (const k of keys) if (k in item) out[k] = (item as Record<string, unknown>)[k];
        return out;
      }
      return item;
    });
  }
  if (data && typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (k in (data as object)) out[k] = (data as Record<string, unknown>)[k];
    return out;
  }
  return data;
}

function pageWithFieldFilter<T extends { messages: unknown[] }>(page: T, fields?: string | null): unknown {
  if (!fields) return page;
  return { ...page, messages: applyFields(page.messages, fields) };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  });
}

// ONE path through the Store, exactly as the `status` CLI command does it. These
// counts previously came from five raw `db.prepare("SELECT COUNT(*) ...")` calls
// against local sqlite, so this endpoint reported the on-box database even when the
// client was configured for the hosted service — measured on station06, where it
// answered 2 channels while the hosted service held 1124, with a valid cloud
// configuration present. That is what made the macOS app look like it worked while
// showing a fraction of the fleet's conversations.
//
// The api_url/db_path split is load-bearing, not cosmetic: it makes this endpoint
// say which connection answered it, so an unexpected fallback to local SQLite is
// visible instead of having to be inferred from a channel count.
async function getStatus() {
  const store = getStore();

  const [totalMessages, sessions, channels, projects, totalUnread] = await Promise.all([
    store.countMessages(),
    store.listSessions(),
    store.listChannels({ include_archived: true }),
    store.listProjects(),
    store.countMessages({ unread_only: true }),
  ]);

  return {
    // Shared with `conversations status`, and REDACTED: this body is served by
    // an unauthenticated GET, so the raw API URL that used to appear here was
    // readable by anything that could reach the port.
    ...storeStatusLocation(),
    total_messages: totalMessages,
    total_sessions: sessions.length,
    total_channels: channels.length,
    total_projects: projects.length,
    unread_messages: totalUnread,
  };
}

function normalizeHost(value: unknown): string {
  const host = typeof value === "string" ? value.trim() : "";
  return host.length > 0 ? host : "127.0.0.1";
}

function normalizePort(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? parseInt(value, 10) : value;
  if (!Number.isFinite(parsed)) return fallback;
  const port = parsed as number;
  if (port < 0 || port > 65535) return fallback;
  return port;
}

const NPM_LATEST_URL = "https://registry.npmjs.org/@hasna/conversations/latest";
const DEFAULT_REGISTRY_TIMEOUT_MS = 3000;
const MAX_REGISTRY_TIMEOUT_MS = 30000;

class RegistryTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`npm registry request timed out after ${timeoutMs}ms`);
    this.name = "RegistryTimeoutError";
  }
}

function registryTimeoutMs(): number {
  const raw = process.env.CONVERSATIONS_REGISTRY_TIMEOUT_MS;
  if (!raw) return DEFAULT_REGISTRY_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REGISTRY_TIMEOUT_MS;
  return Math.min(Math.ceil(parsed), MAX_REGISTRY_TIMEOUT_MS);
}

async function fetchLatestPackageVersion(): Promise<string> {
  const timeoutMs = registryTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(NPM_LATEST_URL, {
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`npm registry responded with ${res.status}`);
    }
    const data = await res.json() as { version?: unknown };
    if (typeof data.version !== "string" || !data.version) {
      throw new Error("npm registry response did not include a version");
    }
    return data.version;
  } catch (e: any) {
    if (controller.signal.aborted) {
      throw new RegistryTimeoutError(timeoutMs);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

function registryErrorStatus(e: unknown): number {
  return e instanceof RegistryTimeoutError ? 504 : 500;
}

function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  if (origin === "null") return false;
  return origin === new URL(req.url).origin;
}

/**
 * Turn a store CONFIGURATION refusal into a 503 the client can render.
 *
 * `getStore()` already refuses to guess when the environment is half-configured —
 * an API URL with no key (see
 * `assertUnambiguousStoreEnv`) — because the on-box SQLite store holds a DIFFERENT
 * dataset and answering from it is a wrong answer, not a fallback. Without this
 * boundary that refusal surfaces as an unhandled rejection and a bare 500 with no
 * body, which tells the operator nothing about which variable is missing.
 *
 * Deliberately narrow: only `ConversationsStoreConfigError` is converted, and every
 * other error keeps its existing behaviour. The message names environment VARIABLES
 * only and never a credential value — a property of the store errors themselves,
 * asserted in serve-store.e2e.test.ts rather than assumed here.
 */
/**
 * The 400 a mutation handler returns for a bad request — but never for a store
 * CONFIGURATION refusal.
 *
 * Those handlers wrap `JSON.parse` and the store call in one `try`, so without
 * this a half-configured client got `400 Bad Request` carrying the store's
 * refusal text: the server blaming the caller for its own misconfiguration.
 * Measured on the built bundle before this was added — `GET /api/channels`
 * answered 503 while `POST /api/messages` answered 400 with the identical
 * message. Fail-closed held either way (neither served local data), but the
 * status code is what a client renders and what a monitor keys on, so the two
 * must not disagree.
 *
 * Rethrowing hands it to {@link withStoreErrorBoundary} instead of giving every
 * handler its own copy of the check.
 */
function badRequest(e: unknown): Response {
  if (e instanceof ConversationsStoreConfigError) throw e;
  return jsonResponse({ error: (e as Error).message }, 400);
}

function withStoreErrorBoundary(
  handler: (req: Request) => Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof ConversationsStoreConfigError) {
        return jsonResponse({ error: e.message, code: "store_config" }, 503);
      }
      throw e;
    }
  };
}

export function startDashboardServer(port = 0, host?: string) {
  const resolvedPort = normalizePort(port, 0);
  const resolvedHost = normalizeHost(host ?? process.env.CONVERSATIONS_DASHBOARD_HOST);

  const server = Bun.serve({
    port: resolvedPort,
    hostname: resolvedHost,
    fetch: withStoreErrorBoundary(async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/health" && req.method === "GET") {
        return jsonResponse(healthPayload("conversations"));
      }
      if (path === "/mcp") {
        return handleMcpRequest(req, () => buildServer(true));
      }

      // ---- API Routes ----
      if (path === "/api/status") {
        return jsonResponse(await getStatus());
      }

      if (path === "/api/messages" && req.method === "GET") {
        try {
          const collection = resolveCollectionQueryOptions(url.searchParams);
          const session = resolveAliasedString(url.searchParams, "session", "session_id");
          const channel = resolvePresentString(url.searchParams.get("channel"), "channel");
          const from = resolvePresentString(url.searchParams.get("from"), "from");
          const to = resolvePresentString(url.searchParams.get("to"), "to");
          const page = await getStore().readMessagePreviews({
            session_id: session,
            channel,
            from,
            to,
            limit: collection.limit,
            offset: collection.offset,
            max_bytes: collection.maxBytes,
            preview_bytes: collection.previewBytes,
            timeout_ms: collection.timeoutMs,
          });
          return jsonResponse(pageWithFieldFilter(page, url.searchParams.get("fields")));
        } catch (e) {
          return badRequest(e);
        }
      }

      if (path === "/api/messages" && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const text = await req.text();
          const body = JSON.parse(text) as { from?: string; to?: string; content?: string; channel?: string; priority?: string };
          const from = typeof body.from === "string" ? body.from.trim() : "";
          const to = typeof body.to === "string" ? body.to.trim() : "";
          const content = typeof body.content === "string" ? body.content.trim() : "";
          const channel = typeof body.channel === "string" ? body.channel.trim() : undefined;
          const priority = typeof body.priority === "string" ? body.priority.trim().toLowerCase() : undefined;

          if (!from || !to || !content) {
            return jsonResponse({ error: "from, to, and content are required" }, 400);
          }
          if (priority && !["low", "normal", "high", "urgent"].includes(priority)) {
            return jsonResponse({ error: "Invalid priority" }, 400);
          }
          const msg = await getStore().sendMessage({
            from,
            to,
            content,
            channel,
            priority: priority as any,
          });
          return jsonResponse(msg);
        } catch (e) {
          return badRequest(e);
        }
      }

      if (path === "/api/messages/search" && req.method === "GET") {
        try {
          const q = resolvePresentString(url.searchParams.get("q"), "q");
          if (!q) return jsonResponse({ error: "Query parameter 'q' is required" }, 400);
          const collection = resolveCollectionQueryOptions(url.searchParams);
          const channel = resolvePresentString(url.searchParams.get("channel"), "channel");
          const from = resolvePresentString(url.searchParams.get("from"), "from");
          const to = resolvePresentString(url.searchParams.get("to"), "to");
          const page = await getStore().searchMessagePreviews({
            query: q,
            channel,
            from,
            to,
            limit: collection.limit,
            offset: collection.offset,
            max_bytes: collection.maxBytes,
            preview_bytes: collection.previewBytes,
            timeout_ms: collection.timeoutMs,
          });
          return jsonResponse(pageWithFieldFilter(page, url.searchParams.get("fields")));
        } catch (e) {
          return badRequest(e);
        }
      }

      if (path === "/api/export" && req.method === "GET") {
        try {
          const channel = resolvePresentString(url.searchParams.get("channel"), "channel");
          const session = resolvePresentString(url.searchParams.get("session"), "session");
          const from = resolvePresentString(url.searchParams.get("from"), "from");
          const since = resolveIso8601Date(url.searchParams.get("since"), "since");
          const until = resolveIso8601Date(url.searchParams.get("until"), "until");
          const format = resolveExportFormat(url.searchParams.get("format"));
          const result = await getStore().exportMessages({ channel, session_id: session, from, since, until, format });
          return jsonResponse({ artifact: result });
        } catch (e) {
          return badRequest(e);
        }
      }

      if (path === "/api/messages/pinned" && req.method === "GET") {
        try {
          const collection = resolveCollectionQueryOptions(url.searchParams);
          const channel = resolvePresentString(url.searchParams.get("channel"), "channel");
          const session_id = resolveAliasedString(url.searchParams, "session_id", "session");
          const page = await getStore().readPinnedMessagePreviews({
            channel,
            session_id,
            limit: collection.limit,
            offset: collection.offset,
            max_bytes: collection.maxBytes,
            preview_bytes: collection.previewBytes,
            timeout_ms: collection.timeoutMs,
          });
          return jsonResponse(pageWithFieldFilter(page, url.searchParams.get("fields")));
        } catch (e) {
          return badRequest(e);
        }
      }

      // Message pin/unpin by ID: /api/messages/:id/pin
      const pinMatch = path.match(/^\/api\/messages\/(\d+)\/pin$/);
      if (pinMatch) {
        const messageId = parseInt(pinMatch[1], 10);
        if (req.method === "POST") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          const msg = await getStore().pinMessage(messageId);
          if (!msg) return jsonResponse({ error: "Message not found" }, 404);
          return jsonResponse(msg);
        }
        if (req.method === "DELETE") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          const msg = await getStore().unpinMessage(messageId);
          if (!msg) return jsonResponse({ error: "Message not found" }, 404);
          return jsonResponse(msg);
        }
      }

      // Message delete/edit by ID: /api/messages/:id
      const messageMatch = path.match(/^\/api\/messages\/(\d+)$/);
      if (messageMatch) {
        const messageId = parseInt(messageMatch[1], 10);
        if (req.method === "DELETE") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          const from = url.searchParams.get("from") || "";
          if (!from) {
            return jsonResponse({ error: "'from' query parameter is required" }, 400);
          }
          const deleted = await getStore().deleteMessage(messageId, from);
          if (!deleted) return jsonResponse({ error: "Message not found or not your message" }, 404);
          return jsonResponse({ id: messageId, deleted: true });
        }
        if (req.method === "PUT") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          try {
            const text = await req.text();
            const body = JSON.parse(text) as { content?: string; from?: string };
            const content = typeof body.content === "string" ? body.content.trim() : "";
            const from = typeof body.from === "string" ? body.from.trim() : "";
            if (!content || !from) {
              return jsonResponse({ error: "content and from are required" }, 400);
            }
            const msg = await getStore().editMessage(messageId, from, content);
            if (!msg) return jsonResponse({ error: "Message not found or not your message" }, 404);
            return jsonResponse(msg);
          } catch (e) {
            return badRequest(e);
          }
        }
      }

      if (path === "/api/sessions") {
        const agent = url.searchParams.get("agent") || undefined;
        return jsonResponse(applyFields(await getStore().listSessions(agent), url.searchParams.get("fields")));
      }

      if (path === "/api/channels" && req.method === "GET") {
        const projectId = url.searchParams.get("project_id") || undefined;
        const includeArchived = url.searchParams.get("include_archived") === "true";
        const listOpts: { project_id?: string; include_archived?: boolean } = {};
        if (projectId) listOpts.project_id = projectId;
        if (includeArchived) listOpts.include_archived = true;
        const channels = await getStore().listChannels(Object.keys(listOpts).length > 0 ? listOpts : undefined);
        return jsonResponse(applyFields(channels, url.searchParams.get("fields")));
      }

      if (path === "/api/channels" && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const text = await req.text();
          const body = JSON.parse(text) as { name?: string; created_by?: string; description?: string; topic?: string; project_id?: string };
          const name = typeof body.name === "string" ? body.name.trim() : "";
          const createdBy = typeof body.created_by === "string" ? body.created_by.trim() : "";
          const description = typeof body.description === "string" ? body.description.trim() : undefined;
          const topic = typeof body.topic === "string" ? body.topic.trim() : undefined;
          const project_id = typeof body.project_id === "string" ? body.project_id.trim() : undefined;
          if (!name || !createdBy) {
            return jsonResponse({ error: "name and created_by are required" }, 400);
          }
          const sp = await getStore().createChannel(name, createdBy, { description, topic, project_id });
          return jsonResponse(sp);
        } catch (e) {
          return badRequest(e);
        }
      }

      const channelMembersMatch = path.match(/^\/api\/channels\/([^/]+)\/members$/);
      if (channelMembersMatch && req.method === "GET") {
        const channelName = decodeURIComponent(channelMembersMatch[1]);
        const store = getStore();
        if (!await store.getChannel(channelName)) {
          return jsonResponse({ error: `Channel not found: ${channelName}` }, 404);
        }
        return jsonResponse(await store.getChannelMembers(channelName));
      }

      // Channel update/archive/unarchive by name
      const channelArchiveMatch = path.match(/^\/api\/channels\/([^/]+)\/archive$/);
      if (channelArchiveMatch && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const sp = await getStore().archiveChannel(decodeURIComponent(channelArchiveMatch[1]));
          return jsonResponse(sp);
        } catch (e) {
          return badRequest(e);
        }
      }

      const channelUnarchiveMatch = path.match(/^\/api\/channels\/([^/]+)\/unarchive$/);
      if (channelUnarchiveMatch && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const sp = await getStore().unarchiveChannel(decodeURIComponent(channelUnarchiveMatch[1]));
          return jsonResponse(sp);
        } catch (e) {
          return badRequest(e);
        }
      }

      const channelMatch = path.match(/^\/api\/channels\/([^/]+)$/);
      if (channelMatch) {
        const channelName = decodeURIComponent(channelMatch[1]);
        if (req.method === "GET") {
          const sp = await getStore().getChannel(channelName);
          if (!sp) return jsonResponse({ error: "Channel not found" }, 404);
          return jsonResponse(sp);
        }
        if (req.method === "PUT") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          try {
            const text = await req.text();
            const body = JSON.parse(text) as { description?: string; topic?: string | null; project_id?: string | null };
            const updates: { description?: string; topic?: string | null; project_id?: string | null } = {};
            if (body.description !== undefined) updates.description = body.description;
            if (body.topic !== undefined) updates.topic = body.topic;
            if (body.project_id !== undefined) updates.project_id = body.project_id;
            const sp = await getStore().updateChannel(channelName, updates);
            return jsonResponse(sp);
          } catch (e) {
            return badRequest(e);
          }
        }
      }

      if (path === "/api/projects" && req.method === "GET") {
        const status = url.searchParams.get("status") as "active" | "archived" | null;
        const projects = await getStore().listProjects(status ? { status } : undefined);
        return jsonResponse(applyFields(projects, url.searchParams.get("fields")));
      }

      if (path === "/api/projects" && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const text = await req.text();
          const body = JSON.parse(text) as {
            name?: string; created_by?: string; description?: string;
            path?: string; repository?: string; tags?: string[]; metadata?: Record<string, unknown>;
            settings?: Record<string, unknown>;
          };
          const name = typeof body.name === "string" ? body.name.trim() : "";
          const createdBy = typeof body.created_by === "string" ? body.created_by.trim() : "";
          if (!name || !createdBy) {
            return jsonResponse({ error: "name and created_by are required" }, 400);
          }
          const project = await getStore().createProject({
            name,
            created_by: createdBy,
            description: body.description,
            path: body.path,
            repository: body.repository,
            tags: body.tags,
            metadata: body.metadata,
            settings: body.settings,
          });
          return jsonResponse(project);
        } catch (e) {
          return badRequest(e);
        }
      }

      // Project update/delete by ID
      const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
      if (projectMatch) {
        const projectId = projectMatch[1];
        if (req.method === "GET") {
          const store = getStore();
          let project = await store.getProject(projectId);
          if (!project) project = await store.getProjectByName(projectId);
          if (!project) return jsonResponse({ error: "Project not found" }, 404);
          return jsonResponse(project);
        }
        if (req.method === "PUT") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          try {
            const text = await req.text();
            const body = JSON.parse(text);
            const project = await getStore().updateProject(projectId, body);
            return jsonResponse(project);
          } catch (e) {
            return badRequest(e);
          }
        }
        if (req.method === "DELETE") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          try {
            const deleted = await getStore().deleteProject(projectId);
            if (!deleted) return jsonResponse({ error: "Project not found" }, 404);
            return jsonResponse({ id: projectId, deleted: true });
          } catch (e) {
            return badRequest(e);
          }
        }
      }

      if (path === "/api/agents" && req.method === "GET") {
        const onlineOnly = url.searchParams.get("online_only") === "true";
        const agents = await getStore().listAgents({ online_only: onlineOnly });
        return jsonResponse(applyFields(agents, url.searchParams.get("fields")));
      }

      // GET /api/sessions/hot[?limit=N&min_score=N&channel=X]
      if (path === "/api/sessions/hot" && req.method === "GET") {
        const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : undefined;
        const min_score = url.searchParams.get("min_score") ? parseInt(url.searchParams.get("min_score")!) : undefined;
        const channel = url.searchParams.get("channel") ?? undefined;
        const project_id = url.searchParams.get("project_id") ?? undefined;
        const sessions = await getStore().listHotSessions({ limit, min_score, channel, project_id });
        return jsonResponse(sessions);
      }

      // GET /api/graph?entity_type=agent&entity_id=julius
      if (path === "/api/graph" && req.method === "GET") {
        const entityType = url.searchParams.get("entity_type");
        const entityId = url.searchParams.get("entity_id");
        const store = getStore();
        if (entityType && entityId) {
          return jsonResponse(await store.getRelated(entityType, entityId));
        }
        return jsonResponse(await store.getGraphStats());
      }

      // GET /api/graph/agent/:name
      const agentNetMatch = path.match(/^\/api\/graph\/agent\/(.+)$/);
      if (agentNetMatch && req.method === "GET") {
        return jsonResponse(await getStore().getAgentNetwork(decodeURIComponent(agentNetMatch[1])));
      }

      // GET /api/reactions?message_id=X[&summary=true]
      if (path === "/api/reactions" && req.method === "GET") {
        const messageIdStr = url.searchParams.get("message_id");
        if (!messageIdStr) return jsonResponse({ error: "message_id required" }, 400);
        const messageId = parseInt(messageIdStr);
        if (isNaN(messageId)) return jsonResponse({ error: "message_id must be a number" }, 400);
        const summary = url.searchParams.get("summary") === "true";
        const store = getStore();
        const result = summary ? await store.getReactionSummary(messageId) : await store.getReactions(messageId);
        return jsonResponse(result);
      }

      // GET /api/locks[?resource_type=X&agent_id=Y]
      if (path === "/api/locks" && req.method === "GET") {
        const resource_type = url.searchParams.get("resource_type") ?? undefined;
        const agent_id = url.searchParams.get("agent_id") ?? undefined;
        const locks = await getStore().listLocks({ resource_type, agent_id });
        return jsonResponse(locks);
      }

      if (path === "/api/version" && req.method === "GET") {
        try {
          const pkg = await import("../../package.json");
          const current = pkg.version;
          const latest = await fetchLatestPackageVersion();
          return jsonResponse({ current, latest, updateAvailable: current !== latest });
        } catch (e: any) {
          return jsonResponse({ error: e.message }, registryErrorStatus(e));
        }
      }

      if (path === "/api/update" && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const pkg = await import("../../package.json");
          const current = pkg.version;
          const latest = await fetchLatestPackageVersion();

          if (current === latest) {
            return jsonResponse({ current, latest, status: "up-to-date" });
          }

          const proc = Bun.spawn(["bun", "install", "-g", `@hasna/conversations@${latest}`], {
            stdout: "pipe",
            stderr: "pipe",
          });
          const exitCode = await proc.exited;
          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();

          if (exitCode === 0) {
            return jsonResponse({ current, latest, status: "updated", stdout });
          } else {
            return jsonResponse({ current, latest, status: "failed", exitCode, stderr }, 500);
          }
        } catch (e: any) {
          return jsonResponse({ error: e.message }, registryErrorStatus(e));
        }
      }

      return new Response("Not Found", {
        status: 404,
        headers: securityHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
      });
    }),
  });

  console.log(`Conversations server running at http://localhost:${server.port}`);
  return server;
}

// If run directly
const isDirectRun = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("serve.ts") ||
  process.argv[1]?.endsWith("serve.js");

if (isDirectRun) {
  const port = normalizePort(process.env.PORT, 0);
  startDashboardServer(port);
}
