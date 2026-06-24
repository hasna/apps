#!/usr/bin/env bun
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { resumeTask, runTask } from "../agent/loop.js";
import { executeComputerAction } from "../agent/policy.js";
import { loadConfig } from "../lib/config.js";
import { listSessions, getSession, getActionLogs, deleteSession, getStats, logAuditEvent } from "../db/index.js";
import type { Provider, DriverAction } from "../types/index.js";
import { handleMcpHttpRequest } from "../mcp/http.js";
import { cancelSession, clearEmergencyStop, getEmergencyStop, pauseSession, requestEmergencyStop } from "../agent/control.js";
import {
  authorizeRequest,
  corsHeadersForRequest,
  corsPreflightHeaders,
  hasDisallowedCorsOrigin,
  isAllowedCorsOrigin,
  isSensitiveRequest,
  resolveSecurityConfig,
  resolveServeHost,
  resolveServePort,
  withCorsHeaders,
} from "./security.js";
import { VERSION } from "../version.js";
import { resolveDashboardFile } from "./static.js";
import { buildSessionTimeline } from "./timeline.js";

const argv = process.argv.slice(2);
if (argv.includes("--version") || argv.includes("-V")) {
  console.log(VERSION);
  process.exit(0);
}
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`computer-serve ${VERSION}

Usage:
  computer-serve

Environment:
  COMPUTER_HOST                    Bind host (default: 127.0.0.1)
  COMPUTER_PORT                    Bind port (default: 19450)
  COMPUTER_API_KEY                 Required for sensitive endpoints unless local unauth is explicitly enabled
  COMPUTER_ALLOW_UNAUTHENTICATED=1 Allow unauthenticated local-loopback development only
  COMPUTER_CORS_ORIGINS            Comma-separated allowed origins

Options:
  -h, --help     Show this help
  -V, --version  Show version`);
  process.exit(0);
}

const PORT = resolveServePort();
const HOST = resolveServeHost();
const SECURITY = resolveSecurityConfig(process.env, PORT);

// Resolve dashboard dist directory
const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIRS = [
  join(__dirname, "..", "..", "dashboard", "dist"),   // dev
  join(__dirname, "..", "dashboard", "dist"),          // installed
];
const DASHBOARD_DIR = DASHBOARD_DIRS.find((d) => existsSync(d));

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS
    if (method === "OPTIONS") {
      if (!isAllowedCorsOrigin(req.headers.get("origin"), SECURITY)) {
        await logHttpAudit(req, "rest", "http.cors", "denied", "CORS origin not allowed");
        return Response.json({ error: "CORS origin not allowed" }, { status: 403 });
      }
      return new Response(null, {
        headers: corsPreflightHeaders(req, SECURITY),
      });
    }
    if (hasDisallowedCorsOrigin(req, SECURITY)) {
      await logHttpAudit(req, "rest", "http.cors", "denied", "CORS origin not allowed");
      return Response.json(
        { error: "CORS origin not allowed" },
        { status: 403, headers: { ...corsHeadersForRequest(req, SECURITY), "Content-Type": "application/json" } }
      );
    }

    const corsHeaders = { ...corsHeadersForRequest(req, SECURITY), "Content-Type": "application/json" };

    try {
      const auth = authorizeRequest(req, SECURITY, isSensitiveRequest(method, path));
      if (!auth.ok) {
        await logHttpAudit(req, path === "/mcp" ? "mcp-http" : "rest", "http.auth", "denied", auth.reason);
        return Response.json({ error: auth.reason }, { status: auth.status, headers: corsHeaders });
      }

      const mcpResponse = await handleMcpHttpRequest(req);
      if (mcpResponse) return withCorsHeaders(mcpResponse, req, SECURITY);

      // POST /run — run a task
      if (method === "POST" && path === "/run") {
        const body = (await req.json()) as Record<string, any>;
        const session = await runTask({
          task: body.task as string,
          provider: (body.provider ?? "anthropic") as Provider,
          model: body.model as string | undefined,
          maxSteps: (body.max_steps as number) ?? 50,
          saveScreenshots: (body.save_screenshots as boolean) ?? false,
        });
        return Response.json(session, { headers: corsHeaders });
      }

      // /emergency-stop — process-local kill switch for direct action execution
      if (path === "/emergency-stop") {
        if (method === "GET") {
          return Response.json(getEmergencyStop(), { headers: corsHeaders });
        }
        if (method === "POST") {
          const body = await safeJson(req);
          const state = requestEmergencyStop(typeof body.reason === "string" ? body.reason : undefined);
          await logHttpAudit(req, "rest", "computer.emergency_stop", "activated", state.reason);
          return Response.json(state, { headers: corsHeaders });
        }
        if (method === "DELETE") {
          const state = clearEmergencyStop();
          await logHttpAudit(req, "rest", "computer.emergency_stop", "cleared");
          return Response.json(state, { headers: corsHeaders });
        }
      }

      // GET /screenshot — take a screenshot
      if (method === "GET" && path === "/screenshot") {
        const config = loadConfig();
        const result = await executeComputerAction(
          { type: "screenshot" },
          { safety: config.safety, transport: "rest", capability: "computer.screenshot" }
        );
        if (!result.success || !result.screenshot) {
          return Response.json({ error: result.error ?? "Screenshot failed" }, { status: 403, headers: corsHeaders });
        }
        const ss = result.screenshot;
        return Response.json(
          { size: ss.size, base64: ss.base64, timestamp: ss.timestamp },
          { headers: corsHeaders }
        );
      }

      // POST /action — execute a single action (with safety check)
      if (method === "POST" && path === "/action") {
        const action = (await req.json()) as DriverAction;
        const config = loadConfig();
        const result = await executeComputerAction(action, {
          safety: config.safety,
          transport: "rest",
          capability: `computer.${action.type}`,
        });
        if (!result.success) {
          return Response.json({ error: result.error ?? "Action blocked" }, { status: 403, headers: corsHeaders });
        }
        return Response.json(result, { headers: corsHeaders });
      }

      // GET /sessions — list sessions
      if (method === "GET" && path === "/sessions") {
        const limit = parseInt(url.searchParams.get("limit") ?? "20");
        const status = url.searchParams.get("status") ?? undefined;
        const sessions = listSessions({ limit, status: status as any });
        return Response.json(sessions, { headers: corsHeaders });
      }

      // POST /sessions/:id/pause — pause an active run before the next action
      if (method === "POST" && path.endsWith("/pause") && path.startsWith("/sessions/")) {
        const id = path.replace("/sessions/", "").replace("/pause", "");
        const body = await safeJson(req);
        const reason = typeof body.reason === "string" ? body.reason : undefined;
        const state = pauseSession(id, reason);
        await logHttpAudit(req, "rest", "computer.session_pause", "requested", reason, { session_id: id });
        return Response.json(state, { headers: corsHeaders });
      }

      // POST /sessions/:id/resume — resume a paused run from persisted state
      if (method === "POST" && path.endsWith("/resume") && path.startsWith("/sessions/")) {
        const id = path.replace("/sessions/", "").replace("/resume", "");
        const body = await safeJson(req);
        const session = await resumeTask(id, {
          provider: body.provider as Provider | undefined,
          model: typeof body.model === "string" ? body.model : undefined,
          maxSteps: typeof body.max_steps === "number" ? body.max_steps : undefined,
          saveScreenshots: Boolean(body.save_screenshots),
          dryRun: Boolean(body.dry_run),
        });
        await logHttpAudit(req, "rest", "computer.session_resume", session.status, undefined, { session_id: id });
        return Response.json(session, { headers: corsHeaders });
      }

      // GET /sessions/:id — get session detail
      if (method === "GET" && path.startsWith("/sessions/")) {
        const id = path.replace("/sessions/", "");
        const session = getSession(id);
        if (!session) return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
        const logs = getActionLogs(id);
        const timeline = buildSessionTimeline(id);
        return Response.json({ session, action_logs: logs, timeline }, { headers: corsHeaders });
      }

      // DELETE /sessions/:id — delete session
      if (method === "DELETE" && path.startsWith("/sessions/")) {
        const id = path.replace("/sessions/", "");
        const deleted = deleteSession(id);
        await logHttpAudit(req, "rest", "computer.session_delete", deleted ? "deleted" : "not_found", undefined, { session_id: id });
        return Response.json({ deleted }, { headers: corsHeaders });
      }

      // POST /sessions/:id/cancel — request cancellation for an active in-process run
      if (method === "POST" && path.endsWith("/cancel") && path.startsWith("/sessions/")) {
        const id = path.replace("/sessions/", "").replace("/cancel", "");
        const body = await safeJson(req);
        const reason = typeof body.reason === "string" ? body.reason : undefined;
        cancelSession(id, reason);
        await logHttpAudit(req, "rest", "computer.session_cancel", "requested", reason);
        return Response.json({ cancelled: true, id }, { headers: corsHeaders });
      }

      // GET /stats
      if (method === "GET" && path === "/stats") {
        return Response.json(getStats(), { headers: corsHeaders });
      }

      // GET /health
      if (method === "GET" && (path === "/health" || path === "/")) {
        return Response.json(
          { status: "ok", name: "computer", version: VERSION, port: PORT },
          { headers: corsHeaders }
        );
      }
      // Serve dashboard static files
      if (DASHBOARD_DIR && method === "GET" && (path.startsWith("/dashboard") || path === "/")) {
        if (path === "/" || path === "/dashboard" || path === "/dashboard/") {
          return new Response(Bun.file(join(DASHBOARD_DIR, "index.html")), {
            headers: { ...corsHeadersForRequest(req, SECURITY), "Content-Type": "text/html" },
          });
        }
        const fullPath = resolveDashboardFile(DASHBOARD_DIR, path);
        if (fullPath && existsSync(fullPath)) {
          return new Response(Bun.file(fullPath), { headers: corsHeadersForRequest(req, SECURITY) });
        }
        // SPA fallback
        return new Response(Bun.file(join(DASHBOARD_DIR, "index.html")), {
          headers: { ...corsHeadersForRequest(req, SECURITY), "Content-Type": "text/html" },
        });
      }

      return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 500, headers: corsHeaders });
    }
  },
});

const authMode = SECURITY.allowUnauthenticated ? "unauthenticated local-dev" : "api-key";
console.log(`computer-serve running on http://${HOST}:${PORT} (${authMode} auth mode)`);

async function logHttpAudit(
  req: Request,
  transport: string,
  capability: string,
  decision: string,
  reason?: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const url = new URL(req.url);
  await logAuditEvent({
    event: capability,
    transport,
    capability,
    decision,
    reason,
    metadata: {
      method: req.method,
      path: url.pathname,
      status: decision,
      origin: req.headers.get("origin") ?? undefined,
      ...metadata,
    },
  });
}

async function safeJson(req: Request): Promise<Record<string, any>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" ? parsed as Record<string, any> : {};
  } catch {
    return {};
  }
}
