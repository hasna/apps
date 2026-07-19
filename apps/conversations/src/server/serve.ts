#!/usr/bin/env bun
/**
 * Dashboard API server.
 * Serves the built dashboard static files and API routes.
 *
 * Usage:
 *   conversations dashboard          # Start dashboard server
 */

import { sendMessage, markRead, deleteMessage, editMessage, pinMessage, unpinMessage, getMessageById } from "../lib/messages.js";
import { getStore } from "../lib/store/index.js";
import { listSessions, getSession } from "../lib/sessions.js";
import { listChannels, getChannel, createChannel, updateChannel, archiveChannel, unarchiveChannel, joinChannel, leaveChannel, getChannelMembers } from "../lib/channels.js";
import { listProjects, getProject, getProjectByName, createProject, updateProject, deleteProject } from "../lib/projects.js";
import { getDb, getDbPath } from "../lib/db.js";
import { listAgents } from "../lib/presence.js";
import { getReactions, getReactionSummary } from "../lib/reactions.js";
import { listHotSessions } from "../lib/hot.js";
import { getRelated, getAgentNetwork, getGraphStats } from "../lib/graph.js";
import { listLocks } from "../lib/locks.js";
import { handleMcpRequest, healthPayload } from "../mcp/http.js";
import { buildServer } from "../mcp/index.js";
import { join, resolve, sep } from "path";
import { existsSync } from "fs";

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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  });
}

function getStatus() {
  const db = getDb();
  const dbPath = getDbPath();
  const totalMessages = (db.prepare("SELECT COUNT(*) as count FROM messages").get() as { count: number }).count;
  const totalSessions = (db.prepare("SELECT COUNT(DISTINCT session_id) as count FROM messages").get() as { count: number }).count;
  const totalUnread = (db.prepare("SELECT COUNT(*) as count FROM messages WHERE read_at IS NULL").get() as { count: number }).count;
  const totalChannels = (db.prepare("SELECT COUNT(*) as count FROM channels").get() as { count: number }).count;
  const totalProjects = (db.prepare("SELECT COUNT(*) as count FROM projects").get() as { count: number }).count;

  return {
    db_path: dbPath,
    total_messages: totalMessages,
    total_sessions: totalSessions,
    total_channels: totalChannels,
    total_projects: totalProjects,
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

function resolveDashboardDist(): string | null {
  const configuredDist = process.env.CONVERSATIONS_DASHBOARD_DIST?.trim();
  const candidates = [
    configuredDist,
    join(import.meta.dir, "../../dashboard/dist"), // source: src/server/serve.ts
    join(import.meta.dir, "../dashboard/dist"), // bundled CLI: bin/index.js
    join(process.cwd(), "dashboard/dist"), // local repo fallback
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(join(resolved, "index.html"))) {
      return resolved;
    }
  }

  return null;
}

export function startDashboardServer(port = 0, host?: string) {
  const resolvedPort = normalizePort(port, 0);
  const resolvedHost = normalizeHost(host ?? process.env.CONVERSATIONS_DASHBOARD_HOST);
  const dashboardDist = resolveDashboardDist();

  const server = Bun.serve({
    port: resolvedPort,
    hostname: resolvedHost,
    async fetch(req) {
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
        return jsonResponse(getStatus());
      }

      if (path === "/api/messages" && req.method === "GET") {
        const session = url.searchParams.get("session") || undefined;
        const channel = url.searchParams.get("channel") || undefined;
        const from = url.searchParams.get("from") || undefined;
        const to = url.searchParams.get("to") || undefined;
        try {
          const page = await getStore().readMessagePreviews({
            session_id: session,
            channel,
            from,
            to,
            limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
            offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
            max_bytes: url.searchParams.get("max_bytes") ? Number(url.searchParams.get("max_bytes")) : undefined,
            preview_bytes: url.searchParams.get("preview_bytes") ? Number(url.searchParams.get("preview_bytes")) : undefined,
            timeout_ms: url.searchParams.get("timeout_ms") ? Number(url.searchParams.get("timeout_ms")) : undefined,
            order: "desc",
          });
          return jsonResponse(applyFields(page.messages, url.searchParams.get("fields")));
        } catch (error) {
          return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
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
          const msg = sendMessage({
            from,
            to,
            content,
            channel,
            priority: priority as any,
          });
          return jsonResponse(msg);
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      if (path === "/api/messages/search" && req.method === "GET") {
        const q = url.searchParams.get("q") || "";
        if (!q.trim()) {
          return jsonResponse({ error: "Query parameter 'q' is required" }, 400);
        }
        const channel = url.searchParams.get("channel") || undefined;
        const from = url.searchParams.get("from") || undefined;
        const to = url.searchParams.get("to") || undefined;
        try {
          const page = await getStore().searchMessagePreviews({
            query: q.trim(),
            channel,
            from,
            to,
            limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
            offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
            max_bytes: url.searchParams.get("max_bytes") ? Number(url.searchParams.get("max_bytes")) : undefined,
            preview_bytes: url.searchParams.get("preview_bytes") ? Number(url.searchParams.get("preview_bytes")) : undefined,
            timeout_ms: url.searchParams.get("timeout_ms") ? Number(url.searchParams.get("timeout_ms")) : undefined,
          });
          return jsonResponse(page.messages);
        } catch (error) {
          return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
      }

      if (path === "/api/export" && req.method === "GET") {
        const channel = url.searchParams.get("channel") || undefined;
        const session = url.searchParams.get("session") || undefined;
        const from = url.searchParams.get("from") || undefined;
        const since = url.searchParams.get("since") || undefined;
        const until = url.searchParams.get("until") || undefined;
        const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
        const artifact = await getStore().exportMessages({
          channel,
          session_id: session,
          from,
          since,
          until,
          format,
          detail: "preview",
          limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
          max_bytes: url.searchParams.get("max_bytes") ? Number(url.searchParams.get("max_bytes")) : undefined,
          preview_bytes: url.searchParams.get("preview_bytes") ? Number(url.searchParams.get("preview_bytes")) : undefined,
          timeout_ms: url.searchParams.get("timeout_ms") ? Number(url.searchParams.get("timeout_ms")) : undefined,
        });
        return jsonResponse({ artifact });
      }

      if (path === "/api/messages/pinned" && req.method === "GET") {
        const channel = url.searchParams.get("channel") || undefined;
        const session_id = url.searchParams.get("session_id") || undefined;
        try {
          const page = await getStore().readMessagePreviews({
            pinned_only: true,
            channel,
            session_id,
            limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
            offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
            max_bytes: url.searchParams.get("max_bytes") ? Number(url.searchParams.get("max_bytes")) : undefined,
            preview_bytes: url.searchParams.get("preview_bytes") ? Number(url.searchParams.get("preview_bytes")) : undefined,
            timeout_ms: url.searchParams.get("timeout_ms") ? Number(url.searchParams.get("timeout_ms")) : undefined,
            order: "desc",
          });
          return jsonResponse(page.messages);
        } catch (error) {
          return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
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
          const msg = pinMessage(messageId);
          if (!msg) return jsonResponse({ error: "Message not found" }, 404);
          return jsonResponse(msg);
        }
        if (req.method === "DELETE") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          const msg = unpinMessage(messageId);
          if (!msg) return jsonResponse({ error: "Message not found" }, 404);
          return jsonResponse(msg);
        }
      }

      // Message delete/edit by ID: /api/messages/:id
      const messageMatch = path.match(/^\/api\/messages\/(\d+)$/);
      if (messageMatch) {
        const messageId = parseInt(messageMatch[1], 10);
        if (req.method === "GET") {
          const message = getMessageById(messageId);
          return message ? jsonResponse(message) : jsonResponse({ error: "Message not found" }, 404);
        }
        if (req.method === "DELETE") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          const from = url.searchParams.get("from") || "";
          if (!from) {
            return jsonResponse({ error: "'from' query parameter is required" }, 400);
          }
          const deleted = deleteMessage(messageId, from);
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
            const msg = editMessage(messageId, from, content);
            if (!msg) return jsonResponse({ error: "Message not found or not your message" }, 404);
            return jsonResponse(msg);
          } catch (e: any) {
            return jsonResponse({ error: e.message }, 400);
          }
        }
      }

      if (path === "/api/sessions") {
        const agent = url.searchParams.get("agent") || undefined;
        return jsonResponse(applyFields(listSessions(agent), url.searchParams.get("fields")));
      }

      if (path === "/api/channels" && req.method === "GET") {
        const projectId = url.searchParams.get("project_id") || undefined;
        const includeArchived = url.searchParams.get("include_archived") === "true";
        const listOpts: { project_id?: string; include_archived?: boolean } = {};
        if (projectId) listOpts.project_id = projectId;
        if (includeArchived) listOpts.include_archived = true;
        return jsonResponse(applyFields(listChannels(Object.keys(listOpts).length > 0 ? listOpts : undefined), url.searchParams.get("fields")));
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
          const sp = createChannel(name, createdBy, { description, topic, project_id });
          return jsonResponse(sp);
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      // Channel update/archive/unarchive by name
      const channelArchiveMatch = path.match(/^\/api\/channels\/([^/]+)\/archive$/);
      if (channelArchiveMatch && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const sp = archiveChannel(decodeURIComponent(channelArchiveMatch[1]));
          return jsonResponse(sp);
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      const channelUnarchiveMatch = path.match(/^\/api\/channels\/([^/]+)\/unarchive$/);
      if (channelUnarchiveMatch && req.method === "POST") {
        if (!isSameOrigin(req)) {
          return jsonResponse({ error: "Invalid origin" }, 403);
        }
        try {
          const sp = unarchiveChannel(decodeURIComponent(channelUnarchiveMatch[1]));
          return jsonResponse(sp);
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      const channelMatch = path.match(/^\/api\/channels\/([^/]+)$/);
      if (channelMatch) {
        const channelName = decodeURIComponent(channelMatch[1]);
        if (req.method === "GET") {
          const sp = getChannel(channelName);
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
            const sp = updateChannel(channelName, updates);
            return jsonResponse(sp);
          } catch (e: any) {
            return jsonResponse({ error: e.message }, 400);
          }
        }
      }

      if (path === "/api/projects" && req.method === "GET") {
        const status = url.searchParams.get("status") as "active" | "archived" | null;
        return jsonResponse(applyFields(listProjects(status ? { status } : undefined), url.searchParams.get("fields")));
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
          const project = createProject({
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
        } catch (e: any) {
          return jsonResponse({ error: e.message }, 400);
        }
      }

      // Project update/delete by ID
      const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
      if (projectMatch) {
        const projectId = projectMatch[1];
        if (req.method === "GET") {
          let project = getProject(projectId);
          if (!project) project = getProjectByName(projectId);
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
            const project = updateProject(projectId, body);
            return jsonResponse(project);
          } catch (e: any) {
            return jsonResponse({ error: e.message }, 400);
          }
        }
        if (req.method === "DELETE") {
          if (!isSameOrigin(req)) {
            return jsonResponse({ error: "Invalid origin" }, 403);
          }
          try {
            const deleted = deleteProject(projectId);
            if (!deleted) return jsonResponse({ error: "Project not found" }, 404);
            return jsonResponse({ id: projectId, deleted: true });
          } catch (e: any) {
            return jsonResponse({ error: e.message }, 400);
          }
        }
      }

      if (path === "/api/agents" && req.method === "GET") {
        const onlineOnly = url.searchParams.get("online_only") === "true";
        const agents = listAgents({ online_only: onlineOnly });
        return jsonResponse(applyFields(agents, url.searchParams.get("fields")));
      }

      // GET /api/sessions/hot[?limit=N&min_score=N&channel=X]
      if (path === "/api/sessions/hot" && req.method === "GET") {
        const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : undefined;
        const min_score = url.searchParams.get("min_score") ? parseInt(url.searchParams.get("min_score")!) : undefined;
        const channel = url.searchParams.get("channel") ?? undefined;
        const project_id = url.searchParams.get("project_id") ?? undefined;
        const sessions = listHotSessions({ limit, min_score, channel, project_id });
        return jsonResponse(sessions);
      }

      // GET /api/graph?entity_type=agent&entity_id=julius
      if (path === "/api/graph" && req.method === "GET") {
        const entityType = url.searchParams.get("entity_type");
        const entityId = url.searchParams.get("entity_id");
        if (entityType && entityId) {
          return jsonResponse(getRelated(entityType, entityId));
        }
        return jsonResponse(getGraphStats());
      }

      // GET /api/graph/agent/:name
      const agentNetMatch = path.match(/^\/api\/graph\/agent\/(.+)$/);
      if (agentNetMatch && req.method === "GET") {
        return jsonResponse(getAgentNetwork(decodeURIComponent(agentNetMatch[1])));
      }

      // GET /api/reactions?message_id=X[&summary=true]
      if (path === "/api/reactions" && req.method === "GET") {
        const messageIdStr = url.searchParams.get("message_id");
        if (!messageIdStr) return jsonResponse({ error: "message_id required" }, 400);
        const messageId = parseInt(messageIdStr);
        if (isNaN(messageId)) return jsonResponse({ error: "message_id must be a number" }, 400);
        const summary = url.searchParams.get("summary") === "true";
        const result = summary ? getReactionSummary(messageId) : getReactions(messageId);
        return jsonResponse(result);
      }

      // GET /api/locks[?resource_type=X&agent_id=Y]
      if (path === "/api/locks" && req.method === "GET") {
        const resource_type = url.searchParams.get("resource_type") ?? undefined;
        const agent_id = url.searchParams.get("agent_id") ?? undefined;
        const locks = listLocks({ resource_type, agent_id });
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

      // ---- Static files (dashboard) ----
      if (dashboardDist) {
        const baseDir = resolve(dashboardDist);
        const safePath = (path === "/" ? "index.html" : path.replace(/^\/+/, ""));
        const filePath = resolve(baseDir, safePath);
        if (!filePath.startsWith(baseDir + sep)) {
          return new Response("Not Found", { status: 404 });
        }

        let file = Bun.file(filePath);
        if (await file.exists()) {
          const headers = securityHeaders();
          if (file.type) headers.set("Content-Type", file.type);
          return new Response(file, { headers });
        }

        // SPA fallback
        file = Bun.file(join(dashboardDist, "index.html"));
        if (await file.exists()) {
          const headers = securityHeaders();
          if (file.type) headers.set("Content-Type", file.type);
          return new Response(file, { headers });
        }
      }

      return new Response("Not Found", {
        status: 404,
        headers: securityHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
      });
    },
  });

  console.log(`Dashboard running at http://localhost:${server.port}`);
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
