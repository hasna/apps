/**
 * HTTP server for the MCP registry dashboard.
 * Serves the Vite-built React/shadcn dashboard from dashboard/dist/.
 * Provides API routes for managing MCP servers.
 */

import { existsSync } from "fs";
import { join, dirname, extname, resolve, relative, sep } from "path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "url";
import {
  listServers,
  getServer,
  addServer,
  removeServer,
  enableServer,
  disableServer,
  getCachedTools,
  getToolCounts,
  updateServer,
  setServerEnv,
  unsetServerEnv,
} from "../lib/registry.js";
import {
  listSources,
  addSource,
  removeSource,
  enableSource,
  disableSource,
  findServers,
} from "../lib/sources.js";
import { diagnoseServer } from "../lib/doctor.js";
import { connectToServer, callTool, disconnectServer } from "../lib/proxy.js";
import { getDb, closeDb } from "../lib/db.js";
import {
  assertLocalCommandConsent,
  LocalCommandConsentError,
  type LocalCommandConsent,
} from "../lib/local-command-consent.js";
import { CredentialReferenceError, normalizeCredentialRefs, redactServerCredentials } from "../lib/credentials.js";
import type { CredentialReferenceMap } from "../types.js";

interface ServerWithToolCount {
  id: string;
  name: string;
  description: string | null;
  command: string;
  args: string[];
  env: Record<string, string>;
  transport: string;
  url: string | null;
  source: string;
  enabled: boolean;
  toolCount: number;
  created_at: string;
  updated_at: string;
}

function redactServer<T extends { env: Record<string, string>; credentialRefs?: CredentialReferenceMap }>(server: T): T {
  return { ...redactServerCredentials(server), env: {} };
}

function resolveDashboardDir(): string {
  const candidates: string[] = [];

  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(scriptDir, "..", "dashboard", "dist"));
    candidates.push(join(scriptDir, "..", "..", "dashboard", "dist"));
  } catch {
    // import.meta.url may not resolve in all contexts
  }

  if (process.argv[1]) {
    const mainDir = dirname(process.argv[1]);
    candidates.push(join(mainDir, "..", "dashboard", "dist"));
    candidates.push(join(mainDir, "..", "..", "dashboard", "dist"));
  }

  candidates.push(join(process.cwd(), "dashboard", "dist"));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return join(process.cwd(), "dashboard", "dist");
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

function json(data: unknown, status = 200, port?: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": port ? `http://localhost:${port}` : "*",
      ...SECURITY_HEADERS,
    },
  });
}

function isValidId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

const MAX_BODY_SIZE = 1024 * 1024;

function consentFromInput(input: {
  allow_local_stdio?: unknown;
  allow_risky_command?: unknown;
  allowLocalStdio?: unknown;
  allowRiskyCommand?: unknown;
}): LocalCommandConsent {
  return {
    approved: input.allow_local_stdio === true || input.allowLocalStdio === true,
    allowRisky: input.allow_risky_command === true || input.allowRiskyCommand === true,
    source: "api",
  };
}

function consentFromSearchParams(params: URLSearchParams): LocalCommandConsent {
  return {
    approved: params.get("allow_local_stdio") === "1" || params.get("allow_local_stdio") === "true",
    allowRisky: params.get("allow_risky_command") === "1" || params.get("allow_risky_command") === "true",
    source: "api",
  };
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function isAllowedOrigin(req: Request, port: number, host: string): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    const url = new URL(origin);
    if (url.port && url.port !== String(port)) return false;
    if (isLoopbackHost(url.hostname)) return true;
    const normalizedHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    return url.hostname === normalizedHost;
  } catch {
    return false;
  }
}

function isAuthorized(req: Request, host: string): boolean {
  const token = process.env.MCPS_API_TOKEN;
  if (!token) {
    return isLoopbackHost(host);
  }
  const auth = req.headers.get("authorization");
  if (safeBearerEq(auth, token)) return true;
  return isLoopbackHost(host);
}

/** Constant-time Bearer compare (length mismatch still fails). */
function safeBearerEq(headerValue: string | null, token: string): boolean {
  const expected = `Bearer ${token}`;
  if (typeof headerValue !== "string") return false;
  const a = Buffer.from(headerValue, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function unauthorizedResponse(port: number): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": port ? `http://localhost:${port}` : "*",
      "WWW-Authenticate": "Bearer",
      ...SECURITY_HEADERS,
    },
  });
}

function getAllServersWithToolCount(): ServerWithToolCount[] {
  const servers = listServers();
  if (servers.length === 0) return [];
  const counts = getToolCounts();
  return servers.map((s) => ({
    ...redactServer(s),
    toolCount: counts.get(s.id) ?? 0,
  }));
}

function serveStaticFile(filePath: string): Response | null {
  if (!existsSync(filePath)) return null;

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": contentType, ...SECURITY_HEADERS },
  });
}

function resolveStaticPath(baseDir: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const stripped = decoded.replace(/^\/+/, "");
  const resolved = resolve(baseDir, stripped);
  const rel = relative(baseDir, resolved);
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    return null;
  }
  return resolved;
}

function formatHostForUrl(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
}

export async function startServer(
  port: number,
  options?: { open?: boolean; host?: string }
): Promise<void> {
  const shouldOpen = options?.open ?? true;
  const host = options?.host ?? "127.0.0.1";

  // Ensure DB is initialized
  getDb();

  const dashboardDir = resolveDashboardDir();
  const dashboardExists = existsSync(dashboardDir);

  if (!dashboardExists) {
    console.error(`\nDashboard not found at: ${dashboardDir}`);
    console.error(`Run this to build it:\n`);
    console.error(`  cd dashboard && bun install && bun run build\n`);
  }

  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      if (path.startsWith("/api/") && method !== "OPTIONS") {
        if (!isAuthorized(req, host)) {
          return unauthorizedResponse(port);
        }
        if (!isAllowedOrigin(req, port, host)) {
          return json({ error: "Forbidden" }, 403, port);
        }
      }

      // ── API Routes ──

      // GET /api/servers
      if (path === "/api/servers" && method === "GET") {
        return json(getAllServersWithToolCount(), 200, port);
      }

      // POST /api/servers (add)
      if (path === "/api/servers" && method === "POST") {
        try {
          const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
          if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);
          let body: {
            name?: string;
            command?: string;
            args?: unknown;
            description?: string;
            env?: Record<string, string>;
            credential_refs?: CredentialReferenceMap;
            credentialRefs?: CredentialReferenceMap;
            transport?: string;
            url?: string;
            allow_local_stdio?: boolean;
            allow_risky_command?: boolean;
          };
          try {
            body = (await req.json()) as typeof body;
          } catch {
            return json({ error: "Invalid JSON body" }, 400, port);
          }
          const command = body.command?.trim();
          if (!command) return json({ error: "Missing 'command'" }, 400, port);
          const transport = body.transport || "stdio";
          if (!["stdio", "sse", "streamable-http"].includes(transport)) {
            return json({ error: "Invalid transport type" }, 400, port);
          }
          if (transport !== "stdio" && !body.url) {
            return json({ error: "Missing 'url' for non-stdio transport" }, 400, port);
          }
          if (body.url) {
            try {
              new URL(body.url);
            } catch {
              return json({ error: "Invalid 'url' format" }, 400, port);
            }
          }
          if (body.args && (!Array.isArray(body.args) || body.args.some((arg) => typeof arg !== "string"))) {
            return json({ error: "Invalid 'args' format" }, 400, port);
          }
          const args = (body.args as string[]) || [];
          const credentialRefs = normalizeCredentialRefs(body.credential_refs ?? body.credentialRefs);
          const env = body.env && typeof body.env === "object" && !Array.isArray(body.env) ? body.env : {};
          try {
            assertLocalCommandConsent(
              {
                command,
                args,
                env: { ...env, ...Object.fromEntries(Object.keys(credentialRefs).map((key) => [key, "<credential-ref>"])) },
                transport: transport as any,
                operation: "register",
              },
              consentFromInput(body),
            );
          } catch (err) {
            return json({ error: (err as Error).message }, 400, port);
          }
          const entry = addServer({
            name: body.name,
            command,
            args,
            description: body.description,
            transport: transport as any,
            url: body.url,
            env,
            credentialRefs,
          });
          return json(entry, 200, port);
        } catch (e) {
          if (e instanceof CredentialReferenceError) return json({ error: e.message }, 400, port);
          return json({ error: e instanceof Error ? e.message : "Failed to add server" }, 500, port);
        }
      }

      // GET /api/servers/:id
      const singleMatch = path.match(/^\/api\/servers\/([^/]+)$/);
      if (singleMatch && method === "GET") {
        const id = singleMatch[1];
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        const entry = getServer(id);
        if (!entry) return json({ error: `Server '${id}' not found` }, 404, port);
        const tools = getCachedTools(id);
        return json({ ...redactServer(entry), toolCount: tools.length, tools }, 200, port);
      }

      // DELETE /api/servers/:id
      if (singleMatch && method === "DELETE") {
        const id = singleMatch[1];
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        const entry = getServer(id);
        if (!entry) return json({ error: `Server '${id}' not found` }, 404, port);
        removeServer(id);
        return json({ success: true }, 200, port);
      }

      // POST /api/servers/:id/enable
      const enableMatch = path.match(/^\/api\/servers\/([^/]+)\/enable$/);
      if (enableMatch && method === "POST") {
        const id = enableMatch[1];
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        try {
          const existing = getServer(id);
          if (!existing) return json({ error: `Server '${id}' not found` }, 404, port);
          enableServer(id);
          return json({ success: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // POST /api/servers/:id/disable
      const disableMatch = path.match(/^\/api\/servers\/([^/]+)\/disable$/);
      if (disableMatch && method === "POST") {
        const id = disableMatch[1];
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        try {
          const existing = getServer(id);
          if (!existing) return json({ error: `Server '${id}' not found` }, 404, port);
          disableServer(id);
          return json({ success: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // PATCH /api/servers/:id — update server fields
      if (singleMatch && method === "PATCH") {
        const id = singleMatch[1];
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        const existing = getServer(id);
        if (!existing) return json({ error: `Server '${id}' not found` }, 404, port);
        try {
          const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
          if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);
          let body: {
            name?: string;
            description?: string;
            command?: string;
            args?: unknown;
            env?: Record<string, string>;
            credential_refs?: CredentialReferenceMap;
            credentialRefs?: CredentialReferenceMap;
            transport?: string;
            url?: string;
            allow_local_stdio?: boolean;
            allow_risky_command?: boolean;
          };
          try {
            body = (await req.json()) as typeof body;
          } catch {
            return json({ error: "Invalid JSON body" }, 400, port);
          }
          const fields: Parameters<typeof updateServer>[1] = {};
          if (body.name !== undefined) {
            if (typeof body.name !== "string") {
              return json({ error: "Invalid 'name' format" }, 400, port);
            }
            const name = body.name.trim();
            if (!name) {
              return json({ error: "Name is required" }, 400, port);
            }
            fields.name = name;
          }
          if (body.description !== undefined) fields.description = body.description;
          if (body.command !== undefined) {
            if (typeof body.command !== "string") {
              return json({ error: "Invalid 'command' format" }, 400, port);
            }
            const command = body.command.trim();
            if (!command) {
              return json({ error: "Command is required" }, 400, port);
            }
            fields.command = command;
          }
          if (body.env !== undefined) fields.env = body.env;
          if (body.credential_refs !== undefined || body.credentialRefs !== undefined) {
            fields.credentialRefs = normalizeCredentialRefs(body.credential_refs ?? body.credentialRefs);
          }
          if (body.transport !== undefined) fields.transport = body.transport as any;
          if (body.url !== undefined) fields.url = body.url;
          if (body.args !== undefined) {
            if (!Array.isArray(body.args) || body.args.some((a) => typeof a !== "string")) {
              return json({ error: "Invalid 'args' format" }, 400, port);
            }
            fields.args = body.args as string[];
          }
          if (fields.command !== undefined || fields.args !== undefined || fields.transport !== undefined) {
            try {
              assertLocalCommandConsent(
                {
                  command: fields.command ?? existing.command,
                  args: fields.args ?? existing.args,
                  env: {
                    ...(fields.env ?? existing.env),
                    ...Object.fromEntries(Object.keys(fields.credentialRefs ?? existing.credentialRefs ?? {}).map((key) => [key, "<credential-ref>"])),
                  },
                  transport: (fields.transport ?? existing.transport) as any,
                  operation: "register",
                },
                consentFromInput(body),
              );
            } catch (err) {
              return json({ error: (err as Error).message }, 400, port);
            }
          }
          const updated = updateServer(id, fields);
          return json(redactServer(updated), 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to update server" }, 500, port);
        }
      }

      // POST /api/servers/:id/env — set env var
      const serverEnvMatch = path.match(/^\/api\/servers\/([^/]+)\/env$/);
      if (serverEnvMatch && method === "POST") {
        const id = serverEnvMatch[1];
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        try {
          const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
          if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);
          let body: { key?: string; value?: string };
          try {
            body = (await req.json()) as typeof body;
          } catch {
            return json({ error: "Invalid JSON body" }, 400, port);
          }
          if (!body.key || typeof body.key !== "string") return json({ error: "Missing 'key'" }, 400, port);
          if (typeof body.value !== "string") return json({ error: "Missing 'value'" }, 400, port);
          setServerEnv(id, body.key, body.value);
          return json({ ok: true }, 200, port);
        } catch (e) {
          if (e instanceof CredentialReferenceError) return json({ error: e.message }, 400, port);
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // DELETE /api/servers/:id/env/:key — unset env var
      const serverEnvKeyMatch = path.match(/^\/api\/servers\/([^/]+)\/env\/([^/]+)$/);
      if (serverEnvKeyMatch && method === "DELETE") {
        const id = serverEnvKeyMatch[1];
        const key = decodeURIComponent(serverEnvKeyMatch[2]);
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        try {
          unsetServerEnv(id, key);
          return json({ ok: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // GET /api/servers/:id/tools — get cached tools for a server
      const serverToolsMatch = path.match(/^\/api\/servers\/([^/]+)\/tools$/);
      if (serverToolsMatch && method === "GET") {
        const id = serverToolsMatch[1];
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        const entry = getServer(id);
        if (!entry) return json({ error: `Server '${id}' not found` }, 404, port);
        const tools = getCachedTools(id);
        return json(tools, 200, port);
      }

      // POST /api/servers/:id/call — call a tool on a server
      const serverCallMatch = path.match(/^\/api\/servers\/([^/]+)\/call$/);
      if (serverCallMatch && method === "POST") {
        const id = serverCallMatch[1];
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        const entry = getServer(id);
        if (!entry) return json({ error: `Server '${id}' not found` }, 404, port);
        try {
          const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
          if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);
          let body: {
            tool?: string;
            args?: Record<string, unknown>;
            allow_local_stdio?: boolean;
            allow_risky_command?: boolean;
          };
          try {
            body = (await req.json()) as typeof body;
          } catch {
            return json({ error: "Invalid JSON body" }, 400, port);
          }
          if (!body.tool || typeof body.tool !== "string") return json({ error: "Missing 'tool'" }, 400, port);
          await connectToServer(entry, { localCommandConsent: consentFromInput(body) });
          const toolName = `${id}__${body.tool}`;
          const result = await callTool(toolName, body.args || {});
          await disconnectServer(id).catch(() => undefined);
          return json({ content: result.content }, 200, port);
        } catch (e) {
          await disconnectServer(id).catch(() => undefined);
          if (e instanceof LocalCommandConsentError) {
            return json({ error: e.message }, 400, port);
          }
          return json({ error: e instanceof Error ? e.message : "Failed to call tool" }, 500, port);
        }
      }

      // GET /api/servers/:id/doctor — run health diagnostics
      const serverDoctorMatch = path.match(/^\/api\/servers\/([^/]+)\/doctor$/);
      if (serverDoctorMatch && method === "GET") {
        const id = serverDoctorMatch[1];
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        const entry = getServer(id);
        if (!entry) return json({ error: `Server '${id}' not found` }, 404, port);
        try {
          const report = await diagnoseServer(entry, { localCommandConsent: consentFromSearchParams(url.searchParams) });
          return json(report, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to diagnose server" }, 500, port);
        }
      }

      // GET /api/sources — list all sources
      if (path === "/api/sources" && method === "GET") {
        return json(listSources(), 200, port);
      }

      // POST /api/sources — add a source
      if (path === "/api/sources" && method === "POST") {
        try {
          const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
          if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);
          let body: { name?: string; type?: string; url?: string; description?: string };
          try {
            body = (await req.json()) as typeof body;
          } catch {
            return json({ error: "Invalid JSON body" }, 400, port);
          }
          if (!body.name) return json({ error: "Missing 'name'" }, 400, port);
          if (!body.type) return json({ error: "Missing 'type'" }, 400, port);
          if (!body.url) return json({ error: "Missing 'url'" }, 400, port);
          const source = addSource({
            name: body.name,
            type: body.type as any,
            url: body.url,
            description: body.description,
          });
          return json(source, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to add source" }, 500, port);
        }
      }

      // Source-level routes: /api/sources/:id
      const singleSourceMatch = path.match(/^\/api\/sources\/([^/]+)$/);
      if (singleSourceMatch && method === "DELETE") {
        const id = singleSourceMatch[1];
        try {
          removeSource(id);
          return json({ ok: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      const sourceEnableMatch = path.match(/^\/api\/sources\/([^/]+)\/enable$/);
      if (sourceEnableMatch && method === "POST") {
        const id = sourceEnableMatch[1];
        try {
          enableSource(id);
          return json({ ok: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      const sourceDisableMatch = path.match(/^\/api\/sources\/([^/]+)\/disable$/);
      if (sourceDisableMatch && method === "POST") {
        const id = sourceDisableMatch[1];
        try {
          disableSource(id);
          return json({ ok: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // GET /api/find — find servers across sources
      if (path === "/api/find" && method === "GET") {
        try {
          const q = url.searchParams.get("q") || "";
          const sourcesParam = url.searchParams.get("sources");
          const limitParam = url.searchParams.get("limit");
          const sources = sourcesParam ? sourcesParam.split(",").filter(Boolean) : undefined;
          const limit = limitParam ? parseInt(limitParam, 10) : undefined;
          const results = await findServers(q, { sources, limit });
          return json(results, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Find failed" }, 500, port);
        }
      }

      // POST /api/update — self-update the package
      if (path === "/api/update" && method === "POST") {
        if (!isLoopbackHost(host)) {
          return json({ error: "Update only allowed on loopback host" }, 403, port);
        }
        try {
          const { execFileSync } = await import("child_process");
          const pkg = await import("../../package.json");
          const currentVersion = pkg.version;
          const latest = execFileSync("npm", ["view", "@hasna/mcps", "version"], {
            encoding: "utf-8",
          }).trim();
          if (latest === currentVersion) {
            return json({ success: true, current: currentVersion, latest, upToDate: true }, 200, port);
          }
          execFileSync("bun", ["install", "-g", "@hasna/mcps@latest"], { stdio: "pipe" });
          return json({ success: true, current: currentVersion, latest, upToDate: false, updated: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Update failed" }, 500, port);
        }
      }

      // GET /api/version — get current version info
      if (path === "/api/version" && method === "GET") {
        try {
          const pkg = await import("../../package.json");
          return json({ version: pkg.version }, 200, port);
        } catch {
          return json({ version: "unknown" }, 200, port);
        }
      }

      // ── CORS ──
      if (method === "OPTIONS") {
        if (!isAllowedOrigin(req, port, host)) {
          return json({ error: "Forbidden" }, 403, port);
        }
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": `http://localhost:${port}`,
            "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // ── Static Files (Vite dashboard) ──
      if (dashboardExists && (method === "GET" || method === "HEAD")) {
        if (path !== "/") {
          const safePath = resolveStaticPath(dashboardDir, path);
          if (safePath) {
            const res = serveStaticFile(safePath);
            if (res) return res;
          }
        }

        // SPA fallback
        const indexPath = join(dashboardDir, "index.html");
        const res = serveStaticFile(indexPath);
        if (res) return res;
      }

      return json({ error: "Not found" }, 404, port);
    },
  });

  const shutdown = () => {
    server.stop();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  const serverUrl = `http://${formatHostForUrl(displayHost)}:${port}`;
  console.log(`MCPs Dashboard running at ${serverUrl}`);

  if (shouldOpen) {
    try {
      const { execFile } = await import("child_process");
      if (process.platform === "win32") {
        execFile("cmd", ["/c", "start", "", serverUrl]);
      } else {
        const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
        execFile(openCmd, [serverUrl]);
      }
    } catch {
      // Silently ignore if we can't open browser
    }
  }
}
