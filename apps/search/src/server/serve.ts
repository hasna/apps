import {
  type SearchProviderName,
  type ExportFormat,
  LOCAL_PROVIDER_NAMES,
  PROVIDER_NAMES,
  validateSearchProviderNames,
} from "../types/index.js";
import { timingSafeEqual } from "node:crypto";
import { unifiedSearch, searchSingleProvider } from "../lib/search.js";
import { exportResults } from "../lib/export.js";
import { getConfig, setConfig } from "../lib/config.js";
import { listSearches, getSearch, deleteSearch, getSearchStats } from "../db/searches.js";
import { listResults, getResult } from "../db/results.js";
import {
  createSavedSearch,
  listSavedSearches,
  getSavedSearch,
  deleteSavedSearch,
  updateSavedSearchLastRun,
} from "../db/saved-searches.js";
import {
  listProviders,
  getProvider as getDbProvider,
  enableProvider,
  disableProvider,
  updateProvider,
  isProviderConfigured,
} from "../db/providers.js";
import { listProfiles, createProfile, deleteProfile, getProfileByName } from "../db/profiles.js";
import { transcribeVideo } from "../lib/providers/transcriber.js";
import { findLocal, type FindKind } from "../lib/local/find.js";
import {
  addRoot,
  getRoot,
  indexRoot,
  indexAllRoots,
  listRoots,
  removeRoot,
  startBackgroundRefresh,
} from "../lib/local/indexer.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { handleMcpHttpRoutes } from "../mcp/http.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function notFound(msg = "Not found"): Response {
  return json({ error: msg }, 404);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new Error("Invalid JSON body");
  }
  if (!isRecord(body)) throw new Error("JSON body must be an object");
  return body;
}

function parseProviderQuery(value: string | null): SearchProviderName[] | undefined {
  if (!value) return undefined;
  return validateSearchProviderNames(
    value
      .split(",")
      .map((provider) => provider.trim())
      .filter(Boolean),
  );
}

function parseLimitParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`Invalid limit "${value}"`);
  return limit;
}

function parseOffsetParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const offset = Number(value);
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`Invalid offset "${value}"`);
  return offset;
}

function parseProviderArray(value: unknown): SearchProviderName[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((provider) => typeof provider === "string")) {
    throw new Error("providers must be an array of provider names");
  }
  return validateSearchProviderNames(value);
}

const CORS_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const DEFAULT_CORS_HEADERS = "Content-Type, Authorization";
const API_TOKEN_ENV_NAMES = ["HASNA_SEARCH_API_TOKEN", "SEARCH_API_TOKEN"] as const;
const ALLOWED_ORIGINS_ENV_NAMES = ["HASNA_SEARCH_ALLOWED_ORIGINS", "SEARCH_ALLOWED_ORIGINS"] as const;

export interface StartServerOptions {
  hostname?: string;
}

export interface ServerRequestContext {
  requireBearerTokenForSensitiveRoutes?: boolean;
}

function configuredApiToken(): string | null {
  for (const name of API_TOKEN_ENV_NAMES) {
    const token = Bun.env[name]?.trim();
    if (token) return token;
  }
  return null;
}

function hasValidBearerToken(req: Request): boolean {
  const expected = configuredApiToken();
  if (!expected) return false;

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;

  const provided = authorization.slice("Bearer ".length).trim();
  if (!provided) return false;

  const encoder = new TextEncoder();
  const providedBytes = encoder.encode(provided);
  const expectedBytes = encoder.encode(expected);
  if (providedBytes.length !== expectedBytes.length) return false;

  return timingSafeEqual(providedBytes, expectedBytes);
}

function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function configuredAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const name of ALLOWED_ORIGINS_ENV_NAMES) {
    const raw = Bun.env[name];
    if (!raw) continue;
    for (const item of raw.split(",")) {
      const normalized = normalizeOrigin(item.trim());
      if (normalized) origins.add(normalized);
    }
  }
  return origins;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;

  const ipv4 = host.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
  if (!ipv4) return false;

  const parts = host.split(".").map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && parts[0] === 127;
}

function isTrustedOrigin(req: Request, rawOrigin: string): boolean {
  if (rawOrigin === "null") return false;

  const origin = normalizeOrigin(rawOrigin);
  if (!origin) return false;

  if (configuredAllowedOrigins().has(origin)) return true;
  if (origin === new URL(req.url).origin) return true;

  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function trustedCorsOrigin(req: Request): string | null {
  const origin = req.headers.get("Origin");
  if (!origin || !isTrustedOrigin(req, origin)) return null;
  return normalizeOrigin(origin);
}

function appendVary(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }
  if (current === "*") return;
  const values = current.split(",").map((item) => item.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) headers.set("Vary", `${current}, ${value}`);
}

function usesServerCors(path: string): boolean {
  return path.startsWith("/api/") || path === "/mcp";
}

function withServerCors(req: Request, response: Response): Response {
  if (!usesServerCors(new URL(req.url).pathname)) return response;

  const origin = trustedCorsOrigin(req);
  if (!origin) return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  appendVary(headers, "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsPreflight(req: Request): Response {
  const origin = req.headers.get("Origin");
  if (origin && !isTrustedOrigin(req, origin)) {
    return json({ error: "CORS origin is not allowed" }, 403);
  }

  const headers = new Headers({
    "Access-Control-Allow-Methods": CORS_METHODS,
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? DEFAULT_CORS_HEADERS,
    "Access-Control-Max-Age": "600",
  });
  const trustedOrigin = trustedCorsOrigin(req);
  if (trustedOrigin) {
    headers.set("Access-Control-Allow-Origin", trustedOrigin);
    appendVary(headers, "Origin");
  }

  return new Response(null, {
    status: 204,
    headers,
  });
}

function isLocalFileApiRoute(path: string): boolean {
  return path === "/api/find" || path === "/api/index" || path.startsWith("/api/index/");
}

function searchRequestMayUseLocalProviders(url: URL): boolean {
  const path = url.pathname;
  const providerMatch = path.match(/^\/api\/search\/(\w+)$/);
  if (providerMatch) {
    return LOCAL_PROVIDER_NAMES.has(providerMatch[1] as SearchProviderName);
  }

  if (path !== "/api/search") return false;

  const rawProviders = url.searchParams.get("providers");
  if (rawProviders) {
    return rawProviders
      .split(",")
      .map((provider) => provider.trim())
      .some((provider) => LOCAL_PROVIDER_NAMES.has(provider as SearchProviderName));
  }

  const profile = url.searchParams.get("profile");
  if (profile && profile !== "smart") {
    const resolved = getProfileByName(profile);
    return Boolean(resolved?.providers.some((provider) => LOCAL_PROVIDER_NAMES.has(provider)));
  }

  // Without explicit providers/profile, unified search may fall back to all
  // enabled configured providers, including local files/content when indexes
  // are ready. Treat that public route as local-capable by default.
  return true;
}

function isSensitiveHttpRoute(url: URL): boolean {
  const path = url.pathname;
  return isLocalFileApiRoute(path) || searchRequestMayUseLocalProviders(url) || path === "/mcp";
}

function routeLabel(path: string): string {
  return path === "/mcp" ? "MCP HTTP transport" : "Local file APIs";
}

function routeVerb(path: string): string {
  return path === "/mcp" ? "requires" : "require";
}

function requireBearerForSensitiveRoutes(req: Request, context: ServerRequestContext): boolean {
  if (context.requireBearerTokenForSensitiveRoutes !== undefined) {
    return context.requireBearerTokenForSensitiveRoutes;
  }
  return !isLoopbackHostname(new URL(req.url).hostname);
}

function requestedHeadersIncludeAuthorization(req: Request): boolean {
  return (req.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .includes("authorization");
}

function allowBearerPreflight(req: Request): boolean {
  if (req.method !== "OPTIONS") return false;
  if (!configuredApiToken()) return false;
  if (!requestedHeadersIncludeAuthorization(req)) return false;

  const origin = req.headers.get("Origin");
  return Boolean(origin && isTrustedOrigin(req, origin));
}

function denySensitiveHttpRequest(
  req: Request,
  path: string,
  context: ServerRequestContext,
): Response | null {
  if (!isSensitiveHttpRoute(new URL(req.url))) return null;
  if (hasValidBearerToken(req)) return null;

  if (requireBearerForSensitiveRoutes(req, context)) {
    if (allowBearerPreflight(req)) return null;
    return json(
      {
        error:
          `${routeLabel(path)} ${routeVerb(path)} a valid bearer token when search-serve is bound to a non-loopback host`,
      },
      403,
    );
  }

  const origin = req.headers.get("Origin");
  if (origin && !isTrustedOrigin(req, origin)) {
    return json({ error: "Local file APIs do not accept requests from this Origin" }, 403);
  }

  return null;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serveDashboard(pathname: string): Response | null {
  const dashboardDir = join(import.meta.dir, "../../dashboard/dist");
  const filePath = join(dashboardDir, pathname === "/" ? "index.html" : pathname);

  if (existsSync(filePath)) {
    const ext = filePath.substring(filePath.lastIndexOf("."));
    const mime = MIME_TYPES[ext] ?? "application/octet-stream";
    return new Response(readFileSync(filePath), {
      headers: { "Content-Type": mime },
    });
  }

  // SPA fallback
  const indexPath = join(dashboardDir, "index.html");
  if (existsSync(indexPath)) {
    return new Response(readFileSync(indexPath), {
      headers: { "Content-Type": "text/html" },
    });
  }

  return null;
}

export async function handleServerRequest(
  req: Request,
  context: ServerRequestContext = {},
): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      const sensitiveDenied = denySensitiveHttpRequest(req, path, context);
      if (sensitiveDenied) return sensitiveDenied;

      // CORS preflight
      if (req.method === "OPTIONS") {
        return corsPreflight(req);
      }

      // MCP Streamable HTTP (shared long-lived transport)
      const mcpResponse = await handleMcpHttpRoutes(req);
      if (mcpResponse) return mcpResponse;

      // --- API routes ---
      try {
        // Unified search
        if (path === "/api/search" && req.method === "GET") {
          const q = url.searchParams.get("q");
          if (!q) return json({ error: "Missing query parameter 'q'" }, 400);
          let providers: SearchProviderName[] | undefined;
          let limit: number | undefined;
          try {
            providers = parseProviderQuery(url.searchParams.get("providers"));
            limit = parseLimitParam(url.searchParams.get("limit"));
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : "Invalid search parameters" }, 400);
          }
          const profile = url.searchParams.get("profile") ?? undefined;
          const smart = url.searchParams.get("smart") === "1" || url.searchParams.get("smart") === "true";
          const response = await unifiedSearch(q, {
            providers,
            profile,
            options: limit ? { limit } : undefined,
            smart,
          });
          return json(response);
        }

        // Provider-specific search
        const providerMatch = path.match(/^\/api\/search\/(\w+)$/);
        if (providerMatch && req.method === "GET") {
          const provider = providerMatch[1] as SearchProviderName;
          if (!PROVIDER_NAMES.includes(provider)) return notFound("Unknown provider");
          const q = url.searchParams.get("q");
          if (!q) return json({ error: "Missing query parameter 'q'" }, 400);
          let limit: number | undefined;
          try {
            limit = parseLimitParam(url.searchParams.get("limit"));
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : "Invalid limit" }, 400);
          }
          const response = await searchSingleProvider(provider, q, limit ? { limit } : undefined);
          return json(response);
        }

        // Search history
        if (path === "/api/searches" && req.method === "GET") {
          let limit: number;
          let offset: number;
          try {
            limit = parseLimitParam(url.searchParams.get("limit")) ?? 20;
            offset = parseOffsetParam(url.searchParams.get("offset")) ?? 0;
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : "Invalid search history parameters" }, 400);
          }
          const query = url.searchParams.get("q") ?? undefined;
          const result = listSearches({ limit, offset, query });
          return json(result);
        }

        // Search detail
        const searchDetailMatch = path.match(/^\/api\/searches\/([^/]+)$/);
        if (searchDetailMatch && req.method === "GET") {
          const search = getSearch(searchDetailMatch[1]!);
          if (!search) return notFound("Search not found");
          const results = listResults(search.id);
          return json({ search, results });
        }
        if (searchDetailMatch && req.method === "DELETE") {
          const ok = deleteSearch(searchDetailMatch[1]!);
          return ok ? json({ ok: true }) : notFound("Search not found");
        }

        // Single result
        const resultMatch = path.match(/^\/api\/results\/([^/]+)$/);
        if (resultMatch && req.method === "GET") {
          const result = getResult(resultMatch[1]!);
          return result ? json(result) : notFound("Result not found");
        }

        // Saved searches
        if (path === "/api/saved-searches" && req.method === "GET") {
          return json(listSavedSearches());
        }
        if (path === "/api/saved-searches" && req.method === "POST") {
          let body: Record<string, unknown>;
          try {
            body = await readJsonObject(req);
            if (typeof body.name !== "string" || !body.name.trim()) {
              throw new Error("Missing or invalid 'name'");
            }
            if (typeof body.query !== "string" || !body.query.trim()) {
              throw new Error("Missing or invalid 'query'");
            }
            if (body.profileId !== undefined && typeof body.profileId !== "string") {
              throw new Error("'profileId' must be a string");
            }
            const saved = createSavedSearch({
              name: body.name,
              query: body.query,
              providers: parseProviderArray(body.providers),
              profileId: body.profileId,
            });
            return json(saved, 201);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Invalid saved search";
            return json({ error: message }, message.includes("already exists") ? 409 : 400);
          }
        }

        const savedRunMatch = path.match(/^\/api\/saved-searches\/([^/]+)\/run$/);
        if (savedRunMatch && req.method === "POST") {
          const saved = getSavedSearch(savedRunMatch[1]!);
          if (!saved) return notFound("Saved search not found");
          updateSavedSearchLastRun(saved.id);
          const response = await unifiedSearch(saved.query, {
            providers: saved.providers.length > 0 ? saved.providers : undefined,
            options: saved.options,
          });
          return json(response);
        }

        const savedDeleteMatch = path.match(/^\/api\/saved-searches\/([^/]+)$/);
        if (savedDeleteMatch && req.method === "DELETE") {
          const ok = deleteSavedSearch(savedDeleteMatch[1]!);
          return ok ? json({ ok: true }) : notFound();
        }

        // Providers
        if (path === "/api/providers" && req.method === "GET") {
          const providers = listProviders();
          return json(providers.map((p) => ({ ...p, configured: isProviderConfigured(p) })));
        }

        const providerUpdateMatch = path.match(/^\/api\/providers\/(\w+)$/);
        if (providerUpdateMatch && req.method === "PUT") {
          const name = providerUpdateMatch[1]!;
          if (!getDbProvider(name)) return notFound("Provider not found");
          let body: Record<string, unknown>;
          try {
            body = await readJsonObject(req);
            if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
              throw new Error("'enabled' must be a boolean");
            }
            if (body.apiKeyEnv !== undefined && typeof body.apiKeyEnv !== "string") {
              throw new Error("'apiKeyEnv' must be a string");
            }
            if (
              body.rateLimit !== undefined &&
              (typeof body.rateLimit !== "number" || !Number.isInteger(body.rateLimit) || body.rateLimit < 0)
            ) {
              throw new Error("'rateLimit' must be an integer >= 0");
            }
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : "Invalid provider update" }, 400);
          }
          if (body.enabled === true) enableProvider(name);
          if (body.enabled === false) disableProvider(name);
          const updates: { apiKeyEnv?: string; rateLimit?: number } = {};
          if (typeof body.apiKeyEnv === "string") updates.apiKeyEnv = body.apiKeyEnv;
          if (typeof body.rateLimit === "number") updates.rateLimit = body.rateLimit;
          if (Object.keys(updates).length > 0) updateProvider(name, updates);
          return json({ ok: true });
        }

        // Profiles
        if (path === "/api/profiles" && req.method === "GET") {
          return json(listProfiles());
        }
        if (path === "/api/profiles" && req.method === "POST") {
          try {
            const body = await readJsonObject(req);
            if (typeof body.name !== "string" || !body.name.trim()) {
              throw new Error("Missing or invalid 'name'");
            }
            if (body.description !== undefined && typeof body.description !== "string") {
              throw new Error("'description' must be a string");
            }
            const profile = createProfile({
              name: body.name,
              providers: parseProviderArray(body.providers),
              description: body.description,
            });
            return json(profile, 201);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Invalid profile";
            return json({ error: message }, message.includes("already exists") ? 409 : 400);
          }
        }

        const profileDeleteMatch = path.match(/^\/api\/profiles\/([^/]+)$/);
        if (profileDeleteMatch && req.method === "DELETE") {
          const ok = deleteProfile(profileDeleteMatch[1]!);
          return ok ? json({ ok: true }) : notFound();
        }

        // Export
        const exportMatch = path.match(/^\/api\/export\/([^/]+)$/);
        if (exportMatch && req.method === "GET") {
          const format = (url.searchParams.get("format") ?? "json") as ExportFormat;
          try {
            const output = exportResults(exportMatch[1]!, format);
            const contentType =
              format === "json"
                ? "application/json"
                : format === "csv"
                  ? "text/csv"
                  : "text/markdown";
            return new Response(output, {
              headers: {
                "Content-Type": contentType,
              },
            });
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : "Export failed" }, 400);
          }
        }

        // Stats
        if (path === "/api/stats" && req.method === "GET") {
          return json(getSearchStats());
        }

        // Transcribe
        if (path === "/api/transcribe" && req.method === "POST") {
          let body: Record<string, unknown>;
          try {
            body = await readJsonObject(req);
            if (typeof body.url !== "string" || !body.url.trim()) {
              throw new Error("Missing or invalid 'url'");
            }
            if (body.provider !== undefined && typeof body.provider !== "string") {
              throw new Error("'provider' must be a string");
            }
            if (body.language !== undefined && typeof body.language !== "string") {
              throw new Error("'language' must be a string");
            }
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : "Invalid transcribe request" }, 400);
          }
          const result = await transcribeVideo(body.url, {
            provider: body.provider,
            language: body.language,
          });
          return json(result);
        }

        // Config
        if (path === "/api/config" && req.method === "GET") {
          return json(getConfig());
        }
        if (path === "/api/config" && req.method === "PUT") {
          try {
            const body = await readJsonObject(req);
            const config = setConfig(body as Record<string, unknown>);
            return json(config);
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : "Invalid config" }, 400);
          }
        }

        // Local find
        if (path === "/api/find" && req.method === "GET") {
          const q = url.searchParams.get("q");
          if (!q) return json({ error: "Missing query parameter 'q'" }, 400);
          const kind = url.searchParams.get("kind") ?? "both";
          if (kind !== "file" && kind !== "content" && kind !== "both") {
            return json({ error: `Invalid kind "${kind}" — use file, content, or both` }, 400);
          }
          const rawLimit = url.searchParams.get("limit");
          const limit = rawLimit ? parseInt(rawLimit) : undefined;
          if (rawLimit && (!Number.isFinite(limit) || limit! < 1)) {
            return json({ error: `Invalid limit "${rawLimit}"` }, 400);
          }
          try {
            const response = findLocal(q, {
              kind: kind as FindKind,
              root: url.searchParams.get("root") ?? undefined,
              ext: url.searchParams.get("ext") ?? undefined,
              dir: url.searchParams.get("dir") ?? undefined,
              limit,
              regex: url.searchParams.get("regex") === "1" || url.searchParams.get("regex") === "true",
              caseSensitive: url.searchParams.get("case") === "1",
            });
            return json(response);
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : "Find failed" }, 400);
          }
        }

        // Local index roots. Root refs in the path must be URL-encoded
        // (slashes included); `?ref=` is accepted as an alternative.
        if (path === "/api/index" && req.method === "GET") {
          const roots = listRoots().map((r) => ({
            ...r,
            staleMinutes: r.lastIndexedAt
              ? Math.round((Date.now() - Date.parse(r.lastIndexedAt)) / 60_000)
              : null,
          }));
          return json(roots);
        }
        if (path === "/api/index" && req.method === "POST") {
          let body: { path?: string; name?: string; content?: boolean; exclude?: string[] };
          try {
            body = (await req.json()) as typeof body;
          } catch {
            return json({ error: "Invalid JSON body" }, 400);
          }
          if (!body.path) return json({ error: "Missing 'path'" }, 400);
          try {
            const root = addRoot(body.path, {
              name: body.name,
              contentIndexing: body.content,
              exclude: body.exclude,
            });
            const stats = indexRoot(root.id);
            return json({ root: getRoot(root.id), stats }, 201);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to add root";
            return json({ error: message }, message.includes("already") ? 409 : 400);
          }
        }

        const indexRootMatch = path.match(/^\/api\/index\/([^/]+)$/);
        const indexRef =
          (indexRootMatch ? decodeURIComponent(indexRootMatch[1]!) : null) ??
          (path === "/api/index" ? url.searchParams.get("ref") : null);
        if (indexRef && req.method === "PUT") {
          if (indexRef === "all") return json(indexAllRoots());
          const root = getRoot(indexRef);
          if (!root) return notFound("Index root not found");
          return json(indexRoot(root.id));
        }
        if (indexRef && req.method === "DELETE") {
          const ok = removeRoot(indexRef);
          return ok ? json({ ok: true }) : notFound("Index root not found");
        }

        // --- Dashboard static files ---
        if (!path.startsWith("/api/")) {
          const dashboard = serveDashboard(path);
          if (dashboard) return dashboard;
        }

        return notFound();
      } catch (err) {
        console.error("Server error:", err);
        return json(
          { error: err instanceof Error ? err.message : "Internal server error" },
          500,
        );
      }
}

export function startServer(port: number, options: StartServerOptions = {}): void {
  const hostname = options.hostname ?? Bun.env.SEARCH_HOST ?? "127.0.0.1";
  const requireBearerTokenForSensitiveRoutes = !isLoopbackHostname(hostname);

  Bun.serve({
    port,
    hostname,
    async fetch(req) {
      const response = await handleServerRequest(req, {
        requireBearerTokenForSensitiveRoutes,
      });
      return withServerCors(req, response);
    },
  });

  // Keep the local file index fresh while the server runs.
  startBackgroundRefresh();

  console.log(`open-search server running at http://${hostname}:${port}`);
}
