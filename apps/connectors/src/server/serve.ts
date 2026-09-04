/**
 * Reusable local API + OAuth server for connector auth.
 * Used by both the CLI `serve` command and the standalone `connectors-serve` binary.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { registerAgent, listAgents, getAgentByName, deleteAgent, isAgentConflict } from "../db/agents.js";
import { checkRateBudget, getRateBudget } from "../db/rate.js";
import { maybeStrip } from "../lib/strip.js";
import { getLlmConfig, saveLlmConfig, maskKey, LLMClient, type LLMProvider } from "../lib/llm.js";
import { createJob, listJobs, getJobByName, updateJob, deleteJob, listJobRuns, createJobRun, finishJobRun } from "../db/jobs.js";
import { createWorkflow, listWorkflows, getWorkflowByName, deleteWorkflow } from "../db/workflows.js";
import { triggerJob } from "../lib/scheduler.js";
import { runWorkflow } from "../lib/workflow-runner.js";
import { getDatabase, getConnectorsHome } from "../db/database.js";
import { join, basename } from "path";
import {
  CONNECTORS,
  getConnector,
  loadConnectorVersions,
} from "../lib/registry.js";
import { getInstalledConnectors, getConnectorDocs, installConnector, removeConnector } from "../lib/installer.js";
import {
  getConnectorConfigDir,
  getConnectorConfigReadDirs,
  isValidConnectorName,
  listConfiguredConnectorNames,
} from "../lib/connector-resolver.js";
import {
  getConnectorCommandHelp,
  getConnectorOperations,
  hasConnectorCommandSurface,
  runConnectorCommand,
  runConnectorOperation,
} from "../lib/runner.js";
import { getConnectorCapabilityManifest } from "../lib/manifest.js";
import {
  getAuthStatus,
  saveApiKey,
  getOAuthStartUrl,
  exchangeOAuthCode,
  refreshOAuthToken,
  validateOAuthState,
  listProfiles,
  switchProfile,
  deleteProfile,
  type AuthStatus,
} from "./auth.js";
import { handleMcpHttpRequest } from "../mcp/http.js";

// ── Activity Log ──
interface ActivityEntry {
  action: string;
  connector: string;
  timestamp: number;
  detail?: string;
}

const activityLog: ActivityEntry[] = [];
const MAX_ACTIVITY_LOG = 100;

function logActivity(action: string, connector: string, detail?: string) {
  activityLog.unshift({ action, connector, timestamp: Date.now(), detail });
  if (activityLog.length > MAX_ACTIVITY_LOG) {
    activityLog.length = MAX_ACTIVITY_LOG;
  }
}

interface ConnectorWithAuth {
  name: string;
  displayName: string;
  description: string;
  category: string;
  version?: string;
  installed: boolean;
  auth: AuthStatus | null;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function json(data: unknown, status = 200, port?: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": port ? `http://localhost:${port}` : "*",
      ...SECURITY_HEADERS,
    },
  });
}

/** Like json() but passes data through LLM stripping if enabled */
async function jsonStripped(data: unknown, status = 200, port?: number): Promise<Response> {
  const raw = JSON.stringify(data);
  const body = await maybeStrip(raw);
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": port ? `http://localhost:${port}` : "*",
      ...SECURITY_HEADERS,
    },
  });
}

function htmlResponse(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS },
  });
}

/** Max request body size (1MB) */
const MAX_BODY_SIZE = 1024 * 1024;

function getAllConnectorsWithAuth(): ConnectorWithAuth[] {
  const installed = new Set(getInstalledConnectors());
  return CONNECTORS.map((meta) => {
    const isInstalled = installed.has(meta.name);
    const auth = isInstalled ? getAuthStatus(meta.name) : null;
    return {
      name: meta.name,
      displayName: meta.displayName,
      description: meta.description,
      category: meta.category,
      version: meta.version,
      installed: isInstalled,
      auth,
    };
  });
}

function oauthPage(type: "success" | "error" | "warning", title: string, message: string, hint?: string, extra?: { script?: string }): string {
  const icons: Record<string, string> = {
    success: `<div class="icon icon-success"><svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></div>`,
    error: `<div class="icon icon-error"><svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></div>`,
    warning: `<div class="icon icon-warning"><svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg></div>`,
  };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:ui-sans-serif,system-ui,-apple-system,sans-serif; display:flex; justify-content:center; align-items:center; min-height:100vh; background:#09090b; color:#fafafa; }
      .card { background:#18181b; border:1px solid #27272a; border-radius:12px; padding:48px 40px; max-width:420px; width:100%; text-align:center; }
      .icon { width:64px; height:64px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 24px; }
      .icon svg { width:32px; height:32px; }
      .icon-success { background:#052e16; }
      .icon-success svg { color:#22c55e; }
      .icon-error { background:#450a0a; }
      .icon-error svg { color:#ef4444; }
      .icon-warning { background:#422006; }
      .icon-warning svg { color:#eab308; }
      h2 { font-size:24px; font-weight:600; margin-bottom:8px; color:#fafafa; }
      .subtitle { color:#a1a1aa; font-size:15px; margin-top:12px; line-height:1.5; }
      .connector { color:#22c55e; font-weight:600; }
      .hint { color:#52525b; font-size:13px; margin-top:24px; }
      code, .cmd { background:#27272a; color:#e4e4e7; padding:2px 8px; border-radius:4px; font-family:ui-monospace,monospace; font-size:12px; }
    </style>
  </head><body>
    <div class="card">
      ${icons[type]}
      <h2>${title}</h2>
      <p class="subtitle">${message}</p>
      ${hint ? `<p class="hint">${hint}</p>` : ""}
      ${extra?.script ? `<script>${extra.script}</script>` : ""}
    </div>
  </body></html>`;
}


export interface ServeOptions {
  port: number;
}

async function findAvailablePort(preferred: number, strict = false): Promise<number> {
  if (strict) {
    try {
      const server = Bun.serve({ port: preferred, fetch() { return new Response(); } });
      server.stop(true);
      return preferred;
    } catch {
      throw new Error(
        `Port ${preferred} is already in use. OAuth requires a fixed port.\n` +
        `Free the port and try again: lsof -ti :${preferred} | xargs kill`
      );
    }
  }
  for (let port = preferred; port < preferred + 100; port++) {
    try {
      const server = Bun.serve({ port, fetch() { return new Response(); } });
      server.stop(true);
      return port;
    } catch {
      // Port in use, try next
    }
  }
  throw new Error(`No available port found in range ${preferred}-${preferred + 99}`);
}

export async function startServer(requestedPort: number, options?: { strict?: boolean }): Promise<number> {
  const strict = options?.strict ?? false;
  loadConnectorVersions();

  const port = await findAvailablePort(requestedPort, strict);
  if (port !== requestedPort) {
    console.log(`Port ${requestedPort} is in use, using port ${port} instead`);
  }

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      const mcpResponse = await handleMcpHttpRequest(req);
      if (mcpResponse) return mcpResponse;

      // ── API Routes ──

      // GET /api/connectors[?compact=true][?fields=name,category,installed]
      if (path === "/api/connectors" && method === "GET") {
        const compact = url.searchParams.get("compact") === "true";
        const fieldsParam = url.searchParams.get("fields");
        const fields = fieldsParam ? new Set(fieldsParam.split(",").map((f) => f.trim())) : null;

        const data = getAllConnectorsWithAuth();

        if (compact) {
          // Compact: name + category + installed only (~61% smaller)
          return jsonStripped(data.map((c) => ({ name: c.name, category: c.category, installed: c.installed })), 200, port);
        }

        if (fields) {
          // Field filtering: return only requested fields
          return jsonStripped(data.map((c) => {
            const out: Record<string, unknown> = {};
            for (const f of fields) {
              if (f in c) out[f] = (c as unknown as Record<string, unknown>)[f];
            }
            return out;
          }), 200, port);
        }

        return jsonStripped(data, 200, port);
      }

      // GET /api/connectors/manifest
      if (path === "/api/connectors/manifest" && method === "GET") {
        const connectorNames = url.searchParams.get("connectors")
          ?.split(",")
          .map((name) => name.trim())
          .filter(Boolean);
        const includeOperations = url.searchParams.get("includeOperations") === "true";

        const manifest = await getConnectorCapabilityManifest({
          includeOperations,
          ...(connectorNames ? { connectorNames } : {}),
        });
        return json(manifest, 200, port);
      }

      // GET /api/connectors/:name
      const singleMatch = path.match(/^\/api\/connectors\/([^/]+)$/);
      if (singleMatch && method === "GET") {
        const name = singleMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        const meta = getConnector(name);
        if (!meta) return json({ error: `Connector '${name}' not found` }, 404, port);

        const auth = getAuthStatus(name);
        const docs = getConnectorDocs(name);
        return json({
          name: meta.name,
          displayName: meta.displayName,
          description: meta.description,
          category: meta.category,
          version: meta.version,
          auth,
          overview: docs?.overview || null,
        }, 200, port);
      }

      // GET /api/connectors/:name/operations
      const operationsMatch = path.match(/^\/api\/connectors\/([^/]+)\/operations$/);
      if (operationsMatch && method === "GET") {
        const name = operationsMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        const meta = getConnector(name);
        if (!meta) return json({ error: `Connector '${name}' not found` }, 404, port);
        if (!hasConnectorCommandSurface(name)) {
          return json(
            { error: `Connector '${name}' does not expose runnable operations` },
            404,
            port
          );
        }

        const ops = await getConnectorOperations(name);
        return json(
          {
            connector: name,
            displayName: meta.displayName,
            auth: getAuthStatus(name),
            commands: ops.commands,
            operations: ops.operations,
            helpText: ops.helpText,
          },
          200,
          port
        );
      }

      // GET /api/connectors/:name/operations/:command
      const operationHelpMatch = path.match(
        /^\/api\/connectors\/([^/]+)\/operations\/([^/]+)$/
      );
      if (operationHelpMatch && method === "GET") {
        const name = operationHelpMatch[1];
        const command = decodeURIComponent(operationHelpMatch[2]);
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        const meta = getConnector(name);
        if (!meta) return json({ error: `Connector '${name}' not found` }, 404, port);
        if (!hasConnectorCommandSurface(name)) {
          return json(
            { error: `Connector '${name}' does not expose runnable operations` },
            404,
            port
          );
        }

        const help = await getConnectorCommandHelp(name, command);
        return json({ connector: name, displayName: meta.displayName, command, help }, 200, port);
      }

      // POST /api/connectors/:name/operations/run
      const operationRunMatch = path.match(/^\/api\/connectors\/([^/]+)\/operations\/run$/);
      if (operationRunMatch && method === "POST") {
        const name = operationRunMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        const meta = getConnector(name);
        if (!meta) return json({ error: `Connector '${name}' not found` }, 404, port);
        if (!hasConnectorCommandSurface(name)) {
          return json(
            { error: `Connector '${name}' does not expose runnable operations` },
            404,
            port
          );
        }

        try {
          const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
          if (contentLength > MAX_BODY_SIZE) {
            return json({ error: "Request body too large" }, 413, port);
          }

          const body = (await req.json()) as {
            args?: unknown;
            operation?: unknown;
            input?: Record<string, unknown>;
            profile?: string;
            format?: "json" | "pretty";
            timeout?: number;
            parseJson?: boolean;
          };

          if (typeof body.operation === "string" && body.operation.trim()) {
            const result = await runConnectorOperation({
              connector: name,
              operation: body.operation,
              input: body.input,
              profile: body.profile,
              timeoutMs: body.timeout ?? 30000,
              parseJson: body.parseJson,
            });

            if (!result.success) {
              return json({ displayName: meta.displayName, ...result }, 400, port);
            }

            return json({ displayName: meta.displayName, ...result }, 200, port);
          }

          const args = Array.isArray(body.args)
            ? body.args.filter((value): value is string => typeof value === "string")
            : [];

          if (args.length === 0) {
            return json({ error: "Missing connector command arguments" }, 400, port);
          }

          const finalArgs = [...args];
          if (body.format && !args.includes("--format") && !args.includes("-f")) {
            finalArgs.push("--format", body.format);
          }

          const result = await runConnectorCommand(name, finalArgs, body.timeout ?? 30000);
          const combinedOutput = `${result.stdout}\n${result.stderr}`;
          const looksLikeHelp = /Usage:|Commands:|Options:/i.test(combinedOutput);

          if (!result.success && !looksLikeHelp) {
            return json(
              {
                connector: name,
                displayName: meta.displayName,
                success: false,
                error: result.stderr || result.stdout || "Command failed",
                exitCode: result.exitCode,
              },
              400,
              port
            );
          }

          return json(
            {
              connector: name,
              displayName: meta.displayName,
              success: true,
              output: looksLikeHelp
                ? (result.stdout || result.stderr).trim()
                : result.stdout,
            },
            200,
            port
          );
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to execute connector operation",
            },
            500,
            port
          );
        }
      }

      // POST /api/connectors/:name/key
      const keyMatch = path.match(/^\/api\/connectors\/([^/]+)\/key$/);
      if (keyMatch && method === "POST") {
        const name = keyMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        try {
          const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
          if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);
          const body = (await req.json()) as { key: string; field?: string };
          if (!body.key) return json({ error: "Missing 'key' in request body" }, 400, port);
          await saveApiKey(name, body.key, body.field);
          logActivity("key_saved", name, body.field ? `Field: ${body.field}` : undefined);
          return json({ success: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to save key" }, 500, port);
        }
      }

      // POST /api/connectors/:name/refresh
      const refreshMatch = path.match(/^\/api\/connectors\/([^/]+)\/refresh$/);
      if (refreshMatch && method === "POST") {
        const name = refreshMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        try {
          const tokens = await refreshOAuthToken(name);
          logActivity("token_refreshed", name, tokens.expiresAt ? `Expires: ${new Date(tokens.expiresAt).toISOString()}` : undefined);
          return json({ success: true, expiresAt: tokens.expiresAt }, 200, port);
        } catch (e) {
          return json(
            { success: false, error: e instanceof Error ? e.message : "Failed to refresh" },
            500, port
          );
        }
      }

      // POST /api/connectors/:name/install
      const installMatch = path.match(/^\/api\/connectors\/([^/]+)\/install$/);
      if (installMatch && method === "POST") {
        const name = installMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        const meta = getConnector(name);
        if (!meta) return json({ error: `Connector '${name}' not found` }, 404, port);
        try {
          const result = installConnector(name);
          if (!result.success) {
            return json({ error: result.error || "Failed to install connector" }, 500, port);
          }
          logActivity("installed", name);
          return json({ success: true, name }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to install connector" }, 500, port);
        }
      }

      // POST /api/connectors/:name/uninstall
      const uninstallMatch = path.match(/^\/api\/connectors\/([^/]+)\/uninstall$/);
      if (uninstallMatch && method === "POST") {
        const name = uninstallMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        try {
          const removed = removeConnector(name);
          if (!removed) {
            return json({ error: `Connector '${name}' is not installed` }, 404, port);
          }
          logActivity("uninstalled", name);
          return json({ success: true, name }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to uninstall connector" }, 500, port);
        }
      }

      // POST /api/update — re-install all installed connectors from package
      if (path === "/api/update" && method === "POST") {
        try {
          const installed = getInstalledConnectors();
          if (installed.length === 0) {
            return json({ updated: [], count: 0 }, 200, port);
          }
          const results = installed.map((name) =>
            installConnector(name, { overwrite: true })
          );
          return json({
            results,
            count: results.filter((r) => r.success).length,
            total: installed.length,
          }, 200, port);
        } catch (e) {
          return json(
            { error: e instanceof Error ? e.message : "Failed to update" },
            500, port
          );
        }
      }

      // GET /api/activity
      if (path === "/api/activity" && method === "GET") {
        return json(activityLog, 200, port);
      }

      // ── Hot Connectors Routes ──

      // GET /api/hot
      if (path === "/api/hot" && method === "GET") {
        const { getTopConnectors } = await import("../db/usage.js");
        const { getPromotedConnectors } = await import("../db/promotions.js");
        const limit = parseInt(url.searchParams.get("limit") || "10", 10);
        const days = parseInt(url.searchParams.get("days") || "7", 10);
        const db = getDatabase();
        const top = getTopConnectors(limit, days, db);
        const promoted = new Set(getPromotedConnectors(db));
        return json(top.map((t: { connector: string; count: number }) => ({ ...t, promoted: promoted.has(t.connector) })), 200, port);
      }

      // POST /api/connectors/:name/promote
      const promoteMatch = path.match(/^\/api\/connectors\/([^/]+)\/promote$/);
      if (promoteMatch && method === "POST") {
        const name = promoteMatch[1];
        if (!getConnector(name)) return json({ error: "Connector not found" }, 404, port);
        const { promoteConnector } = await import("../db/promotions.js");
        promoteConnector(name, getDatabase());
        return json({ success: true, connector: name }, 200, port);
      }

      // DELETE /api/connectors/:name/promote
      if (promoteMatch && method === "DELETE") {
        const { demoteConnector } = await import("../db/promotions.js");
        const removed = demoteConnector(promoteMatch[1], getDatabase());
        return json({ success: removed, connector: promoteMatch[1] }, 200, port);
      }

      // ── LLM Routes ──

      // GET /api/llm
      if (path === "/api/llm" && method === "GET") {
        const config = getLlmConfig();
        if (!config) return json({ configured: false }, 200, port);
        return json({ configured: true, provider: config.provider, model: config.model, key: maskKey(config.api_key), strip: config.strip }, 200, port);
      }

      // POST /api/llm
      if (path === "/api/llm" && method === "POST") {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const validProviders: LLMProvider[] = ["cerebras", "groq", "openai", "anthropic"];
        const provider = body.provider as LLMProvider;
        if (!provider || !validProviders.includes(provider)) return json({ error: "provider must be one of: " + validProviders.join(", ") }, 400, port);
        const api_key = body.api_key as string;
        if (!api_key) return json({ error: "api_key is required" }, 400, port);
        const model = (body.model as string) || getLlmConfig()?.model || "qwen-3-32b";
        const strip = typeof body.strip === "boolean" ? body.strip : getLlmConfig()?.strip ?? false;
        saveLlmConfig({ provider, model, api_key, strip });
        return json({ success: true, provider, model, strip }, 200, port);
      }

      // POST /api/llm/test
      if (path === "/api/llm/test" && method === "POST") {
        const config = getLlmConfig();
        if (!config) return json({ error: "No LLM configured" }, 400, port);
        try {
          const client = new LLMClient(config);
          const result = await client.complete('Respond with exactly: {"status":"ok"}', "ping");
          return json({ success: true, provider: result.provider, model: result.model, latency_ms: result.latency_ms, response: result.content }, 200, port);
        } catch (e) {
          return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500, port);
        }
      }

      // ── Jobs Routes ──

      if (path === "/api/jobs" && method === "GET") {
        return json(listJobs(getDatabase()), 200, port);
      }
      if (path === "/api/jobs" && method === "POST") {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        if (!body.name || !body.connector || !body.command || !body.cron) return json({ error: "name, connector, command, cron required" }, 400, port);
        const job = createJob({ name: body.name as string, connector: body.connector as string, command: body.command as string, args: (body.args as string[] | undefined) ?? [], cron: body.cron as string, strip: !!body.strip }, getDatabase());
        return json(job, 201, port);
      }
      const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
      if (jobMatch) {
        const db = getDatabase();
        const job = getJobByName(jobMatch[1]) ?? (getDatabase().query("SELECT * FROM connector_jobs WHERE id = ?").get(jobMatch[1]) as null);
        if (!job && method !== "DELETE") return json({ error: "Job not found" }, 404, port);
        if (method === "GET") return json(listJobRuns((job as { id: string }).id, 20, db), 200, port);
        if (method === "DELETE") {
          const j = getJobByName(jobMatch[1], db);
          if (!j) return json({ error: "Job not found" }, 404, port);
          deleteJob(j.id, db);
          return json({ success: true }, 200, port);
        }
        if (method === "PATCH") {
          const body = await req.json().catch(() => ({})) as Record<string, unknown>;
          const j = getJobByName(jobMatch[1], db)!;
          const updated = updateJob(j.id, { enabled: typeof body.enabled === "boolean" ? body.enabled : undefined, strip: typeof body.strip === "boolean" ? body.strip : undefined }, db);
          return json(updated, 200, port);
        }
      }
      const jobRunMatch = path.match(/^\/api\/jobs\/([^/]+)\/run$/);
      if (jobRunMatch && method === "POST") {
        const db = getDatabase();
        const job = getJobByName(jobRunMatch[1], db);
        if (!job) return json({ error: "Job not found" }, 404, port);
        const result = await triggerJob(job, db);
        return json(result, 200, port);
      }

      // ── Workflows Routes ──

      if (path === "/api/workflows" && method === "GET") {
        return json(listWorkflows(getDatabase()), 200, port);
      }
      if (path === "/api/workflows" && method === "POST") {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        if (!body.name || !body.steps) return json({ error: "name and steps required" }, 400, port);
        const wf = createWorkflow({ name: body.name as string, steps: body.steps as Parameters<typeof createWorkflow>[0]["steps"] }, getDatabase());
        return json(wf, 201, port);
      }
      const wfMatch = path.match(/^\/api\/workflows\/([^/]+)$/);
      if (wfMatch) {
        const db = getDatabase();
        const wf = getWorkflowByName(wfMatch[1], db);
        if (!wf) return json({ error: "Workflow not found" }, 404, port);
        if (method === "GET") return json(wf, 200, port);
        if (method === "DELETE") { deleteWorkflow(wf.id, db); return json({ success: true }, 200, port); }
      }
      const wfRunMatch = path.match(/^\/api\/workflows\/([^/]+)\/run$/);
      if (wfRunMatch && method === "POST") {
        const wf = getWorkflowByName(wfRunMatch[1], getDatabase());
        if (!wf) return json({ error: "Workflow not found" }, 404, port);
        const result = await runWorkflow(wf);
        return json(result, 200, port);
      }

      // ── Agent Routes ──

      // GET /api/agents
      if (path === "/api/agents" && method === "GET") {
        return json(listAgents(), 200, port);
      }

      // POST /api/agents/register
      if (path === "/api/agents/register" && method === "POST") {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const name = typeof body.name === "string" ? body.name : null;
        if (!name) return json({ error: "name is required" }, 400, port);
        const result = registerAgent({
          name,
          session_id: typeof body.session_id === "string" ? body.session_id : undefined,
          role: typeof body.role === "string" ? body.role : undefined,
        });
        if (isAgentConflict(result)) return json(result, 409, port);
        return json(result, 200, port);
      }

      // DELETE /api/agents/:name
      if (path.startsWith("/api/agents/") && method === "DELETE") {
        const agentName = path.slice("/api/agents/".length);
        const agent = getAgentByName(agentName);
        if (!agent) return json({ error: "Agent not found" }, 404, port);
        deleteAgent(agent.id);
        return json({ success: true }, 200, port);
      }


      // GET /api/rate/:agent_id/:connector?limit=N
      const rateMatch = path.match(/^\/api\/rate\/([^/]+)\/([^/]+)$/);
      if (rateMatch && method === 'GET') {
        const [, agentId, connector] = rateMatch;
        const limit = parseInt(url.searchParams.get('limit') || '60', 10);
        const consume = url.searchParams.get('consume') === 'true';
        const result = consume
          ? checkRateBudget(agentId, connector, limit)
          : getRateBudget(agentId, connector, limit);
        return json(result, 200, port);
      }

      // ── Profile Routes ──

      // GET /api/connectors/:name/profiles
      const profilesMatch = path.match(/^\/api\/connectors\/([^/]+)\/profiles$/);
      if (profilesMatch && method === "GET") {
        const name = profilesMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        try {
          const profiles = listProfiles(name);
          let current = "default";
          for (const configDir of getConnectorConfigReadDirs(name)) {
            const currentProfileFile = join(configDir, "current_profile");
            if (existsSync(currentProfileFile)) {
              try { current = readFileSync(currentProfileFile, "utf-8").trim() || "default"; } catch { /* default */ }
              break;
            }
          }
          return json({ current, profiles }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to list profiles" }, 500, port);
        }
      }

      // POST /api/connectors/:name/profiles/switch
      const profileSwitchMatch = path.match(/^\/api\/connectors\/([^/]+)\/profiles\/switch$/);
      if (profileSwitchMatch && method === "POST") {
        const name = profileSwitchMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        try {
          const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
          if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);
          const body = (await req.json()) as { profile: string };
          if (!body.profile) return json({ error: "Missing 'profile' in request body" }, 400, port);
          switchProfile(name, body.profile);
          logActivity("profile_switch", name, `Switched to profile: ${body.profile}`);
          return json({ success: true, profile: body.profile }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to switch profile" }, 500, port);
        }
      }

      // DELETE /api/connectors/:name/profiles/:profile
      const profileDeleteMatch = path.match(/^\/api\/connectors\/([^/]+)\/profiles\/([^/]+)$/);
      if (profileDeleteMatch && method === "DELETE") {
        const name = profileDeleteMatch[1];
        const profile = profileDeleteMatch[2];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        if (profile === "default") return json({ error: "Cannot delete the default profile" }, 400, port);
        try {
          const deleted = deleteProfile(name, profile);
          if (!deleted) return json({ error: `Profile '${profile}' not found` }, 404, port);
          logActivity("profile_delete", name, `Deleted profile: ${profile}`);
          return json({ success: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to delete profile" }, 500, port);
        }
      }

      // ── Export/Import Routes ──

      // GET /api/export — Export all connector credentials (excluding OAuth tokens)
      if (path === "/api/export" && method === "GET") {
        try {
          const connectDir = getConnectorsHome();
          const result: Record<string, { profiles: Record<string, unknown> }> = {};

          if (existsSync(connectDir)) {
            for (const connectorName of listConfiguredConnectorNames(connectDir)) {
              const profiles: Record<string, unknown> = {};
              for (const configDir of [...getConnectorConfigReadDirs(connectorName, connectDir)].reverse()) {
                const profilesDir = join(configDir, "profiles");
                if (!existsSync(profilesDir)) continue;

                const profileEntries = readdirSync(profilesDir, { withFileTypes: true });
                for (const pEntry of profileEntries) {
                  // Pattern 1: profiles/<name>.json (flat file)
                  if (pEntry.isFile() && pEntry.name.endsWith(".json")) {
                    const profileName = basename(pEntry.name, ".json");
                    try {
                      const config = JSON.parse(readFileSync(join(profilesDir, pEntry.name), "utf-8"));
                      profiles[profileName] = config;
                    } catch { /* skip unreadable */ }
                  }
                  // Pattern 2: profiles/<name>/config.json (directory)
                  if (pEntry.isDirectory()) {
                    const configPath = join(profilesDir, pEntry.name, "config.json");
                    if (existsSync(configPath)) {
                      try {
                        const config = JSON.parse(readFileSync(configPath, "utf-8"));
                        profiles[pEntry.name] = config;
                      } catch { /* skip unreadable */ }
                    }
                  }
                }
              }

              if (Object.keys(profiles).length > 0) {
                result[connectorName] = { profiles };
              }
            }
          }

          const exportData = { connectors: result, exportedAt: new Date().toISOString() };
          return new Response(JSON.stringify(exportData, null, 2), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Content-Disposition": `attachment; filename="connectors-backup-${new Date().toISOString().slice(0, 10)}.json"`,
              "Access-Control-Allow-Origin": port ? `http://localhost:${port}` : "*",
              ...SECURITY_HEADERS,
            },
          });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to export credentials" }, 500, port);
        }
      }

      // POST /api/import — Import connector credentials from backup JSON
      if (path === "/api/import" && method === "POST") {
        try {
          const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
          if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);

          const body = (await req.json()) as { connectors: Record<string, { profiles: Record<string, unknown> }> };
          if (!body.connectors || typeof body.connectors !== "object") {
            return json({ error: "Invalid import format: missing 'connectors' object" }, 400, port);
          }

          let imported = 0;
          const connectDir = getConnectorsHome();

          for (const [connectorName, data] of Object.entries(body.connectors)) {
            if (!isValidConnectorName(connectorName)) continue;
            if (!data.profiles || typeof data.profiles !== "object") continue;

            const connectorDir = getConnectorConfigDir(connectorName, connectDir);
            const profilesDir = join(connectorDir, "profiles");

            for (const [profileName, config] of Object.entries(data.profiles)) {
              if (!config || typeof config !== "object") continue;

              mkdirSync(profilesDir, { recursive: true });
              const profileFile = join(profilesDir, `${profileName}.json`);
              writeFileSync(profileFile, JSON.stringify(config, null, 2));
              imported++;
            }
          }

          logActivity("credentials_imported", "all", `Imported ${imported} profiles`);
          return json({ success: true, imported }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to import credentials" }, 500, port);
        }
      }

      // ── OAuth Routes ──

      // GET /oauth/:name/start
      const oauthStartMatch = path.match(/^\/oauth\/([^/]+)\/start$/);
      if (oauthStartMatch && method === "GET") {
        const name = oauthStartMatch[1];
        const redirectUri = `http://localhost:${port}/oauth/${name}/callback`;
        const authUrl = getOAuthStartUrl(name, redirectUri);

        if (!authUrl) {
          return htmlResponse(oauthPage(
            "warning",
            "OAuth Not Available",
            `No OAuth client credentials found for <span class="connector">${name}</span>.`,
            `Run <code>connectors auth ${name}</code> or add credentials at <code>~/.hasna/connectors/${name}/credentials.json</code>`
          ));
        }

        return Response.redirect(authUrl, 302);
      }

      // GET /oauth/:name/callback
      const oauthCallbackMatch = path.match(/^\/oauth\/([^/]+)\/callback$/);
      if (oauthCallbackMatch && method === "GET") {
        const name = oauthCallbackMatch[1];
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const state = url.searchParams.get("state");

        if (error) {
          return htmlResponse(oauthPage("error", "Authentication Failed", error, "You can close this window."));
        }

        if (!validateOAuthState(state, name)) {
          return htmlResponse(oauthPage(
            "error",
            "Invalid State",
            "CSRF validation failed. The OAuth state parameter is missing or invalid.",
            "Please try again."
          ));
        }

        if (!code) {
          return htmlResponse(oauthPage(
            "error",
            "Missing Authorization Code",
            "No code received from the OAuth provider.",
            "You can close this window and try again."
          ));
        }

        try {
          const redirectUri = `http://localhost:${port}/oauth/${name}/callback`;
          await exchangeOAuthCode(name, code, redirectUri);
          logActivity("oauth_connected", name);

          return htmlResponse(oauthPage(
            "success",
            "Connected!",
            `<span class="connector">${name}</span> is now authenticated and ready to use.`,
            `You can close this window.<br>Try <code>connectors run ${name} --help</code>`,
            { script: `if(window.opener){window.opener.postMessage({type:'oauth-complete',connector:'${name}'},'http://localhost:${port}');}` }
          ));
        } catch (e) {
          return htmlResponse(oauthPage(
            "error",
            "Authentication Failed",
            e instanceof Error ? e.message : "Unknown error",
            "You can close this window."
          ));
        }
      }

      // ── CORS ──
      if (method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": `http://localhost:${port}`,
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }


      return json({ error: "Not found" }, 404, port);
    },
  });

  // Graceful shutdown
  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start job scheduler
  const { startScheduler } = await import("../lib/scheduler.js");
  const { getDatabase } = await import("../db/database.js");
  startScheduler(getDatabase());

  const url = `http://localhost:${port}`;
  console.log(`Connectors API + OAuth server running at ${url}`);

  return port;
}
