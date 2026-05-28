#!/usr/bin/env bun
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { runTask } from "../agent/loop.js";
import { captureScreenshot } from "../drivers/mac/screenshot.js";
import { executeAction } from "../drivers/mac/input.js";
import { checkAction } from "../agent/safety.js";
import { loadConfig } from "../lib/config.js";
import { listSessions, getSession, getActionLogs, deleteSession, getStats } from "../db/index.js";
import type { Provider, DriverAction } from "../types/index.js";
import { handleMcpHttpRequest } from "../mcp/http.js";

const PORT = parseInt(process.env.COMPUTER_PORT ?? "19450");

// Resolve dashboard dist directory
const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIRS = [
  join(__dirname, "..", "..", "dashboard", "dist"),   // dev
  join(__dirname, "..", "dashboard", "dist"),          // installed
];
const DASHBOARD_DIR = DASHBOARD_DIRS.find((d) => existsSync(d));

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS
    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

    try {
      const mcpResponse = await handleMcpHttpRequest(req);
      if (mcpResponse) return mcpResponse;

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

      // GET /screenshot — take a screenshot
      if (method === "GET" && path === "/screenshot") {
        const ss = await captureScreenshot();
        return Response.json(
          { size: ss.size, base64: ss.base64, timestamp: ss.timestamp },
          { headers: corsHeaders }
        );
      }

      // POST /action — execute a single action (with safety check)
      if (method === "POST" && path === "/action") {
        const action = (await req.json()) as DriverAction;
        const config = loadConfig();
        const safety = checkAction(action, config.safety);
        if (!safety.allowed) {
          return Response.json({ error: `Blocked: ${safety.reason}` }, { status: 403, headers: corsHeaders });
        }
        const result = await executeAction(action);
        return Response.json(result, { headers: corsHeaders });
      }

      // GET /sessions — list sessions
      if (method === "GET" && path === "/sessions") {
        const limit = parseInt(url.searchParams.get("limit") ?? "20");
        const status = url.searchParams.get("status") ?? undefined;
        const sessions = listSessions({ limit, status: status as any });
        return Response.json(sessions, { headers: corsHeaders });
      }

      // GET /sessions/:id — get session detail
      if (method === "GET" && path.startsWith("/sessions/")) {
        const id = path.replace("/sessions/", "");
        const session = getSession(id);
        if (!session) return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
        const logs = getActionLogs(id);
        return Response.json({ session, action_logs: logs }, { headers: corsHeaders });
      }

      // DELETE /sessions/:id — delete session
      if (method === "DELETE" && path.startsWith("/sessions/")) {
        const id = path.replace("/sessions/", "");
        const deleted = deleteSession(id);
        return Response.json({ deleted }, { headers: corsHeaders });
      }

      // GET /stats
      if (method === "GET" && path === "/stats") {
        return Response.json(getStats(), { headers: corsHeaders });
      }

      // GET /health
      if (method === "GET" && (path === "/health" || path === "/")) {
        return Response.json(
          { status: "ok", name: "computer", version: "0.1.0", port: PORT },
          { headers: corsHeaders }
        );
      }
      // Serve dashboard static files
      if (DASHBOARD_DIR && method === "GET" && (path.startsWith("/dashboard") || path === "/")) {
        if (path === "/" || path === "/dashboard" || path === "/dashboard/") {
          return new Response(Bun.file(join(DASHBOARD_DIR, "index.html")), {
            headers: { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" },
          });
        }
        const filePath = path.replace("/dashboard", "");
        const fullPath = join(DASHBOARD_DIR, filePath);
        if (existsSync(fullPath)) {
          return new Response(Bun.file(fullPath), { headers: { "Access-Control-Allow-Origin": "*" } });
        }
        // SPA fallback
        return new Response(Bun.file(join(DASHBOARD_DIR, "index.html")), {
          headers: { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" },
        });
      }

      return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 500, headers: corsHeaders });
    }
  },
});

console.log(`computer-serve running on http://localhost:${PORT}`);
