import { type SearchProviderName, type ExportFormat, PROVIDER_NAMES } from "../types/index.js";
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
  enableProvider,
  disableProvider,
  updateProvider,
  isProviderConfigured,
} from "../db/providers.js";
import { listProfiles, createProfile, deleteProfile } from "../db/profiles.js";
import { transcribeVideo } from "../lib/providers/transcriber.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function notFound(msg = "Not found"): Response {
  return json({ error: msg }, 404);
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

export function startServer(port: number): void {
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // --- API routes ---
      try {
        // Unified search
        if (path === "/api/search" && req.method === "GET") {
          const q = url.searchParams.get("q");
          if (!q) return json({ error: "Missing query parameter 'q'" }, 400);
          const providers = url.searchParams.get("providers")?.split(",") as SearchProviderName[] | undefined;
          const profile = url.searchParams.get("profile") ?? undefined;
          const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : undefined;
          const response = await unifiedSearch(q, {
            providers,
            profile,
            options: limit ? { limit } : undefined,
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
          const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : undefined;
          const response = await searchSingleProvider(provider, q, limit ? { limit } : undefined);
          return json(response);
        }

        // Search history
        if (path === "/api/searches" && req.method === "GET") {
          const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : 20;
          const offset = url.searchParams.get("offset") ? parseInt(url.searchParams.get("offset")!) : 0;
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
          const body = (await req.json()) as {
            name: string;
            query: string;
            providers?: SearchProviderName[];
            profileId?: string;
          };
          const saved = createSavedSearch({
            name: body.name,
            query: body.query,
            providers: body.providers ?? [],
            profileId: body.profileId,
          });
          return json(saved, 201);
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
          const body = (await req.json()) as {
            enabled?: boolean;
            apiKeyEnv?: string;
            rateLimit?: number;
          };
          const name = providerUpdateMatch[1]!;
          if (body.enabled === true) enableProvider(name);
          if (body.enabled === false) disableProvider(name);
          const updates: Record<string, unknown> = {};
          if (body.apiKeyEnv) updates.apiKeyEnv = body.apiKeyEnv;
          if (body.rateLimit) updates.rateLimit = body.rateLimit;
          if (Object.keys(updates).length > 0) updateProvider(name, updates);
          return json({ ok: true });
        }

        // Profiles
        if (path === "/api/profiles" && req.method === "GET") {
          return json(listProfiles());
        }
        if (path === "/api/profiles" && req.method === "POST") {
          const body = (await req.json()) as {
            name: string;
            providers: SearchProviderName[];
            description?: string;
          };
          const profile = createProfile(body);
          return json(profile, 201);
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
                "Access-Control-Allow-Origin": "*",
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
          const body = (await req.json()) as { url: string; provider?: string; language?: string };
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
          const body = await req.json();
          const config = setConfig(body as Record<string, unknown>);
          return json(config);
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
    },
  });

  console.log(`open-search server running at http://localhost:${port}`);
}
