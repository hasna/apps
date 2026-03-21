#!/usr/bin/env bun
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

import { STYLES, getStyle, searchStyles, getStylesByCategory } from "../lib/registry.js";
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  getBuiltinStyleProfile,
  type CreateProfileInput,
} from "../lib/profiles.js";
import { listPrefs, setPref, deletePref } from "../lib/preferences.js";
import { listProjectDirs, getProjectConfig, setProjectConfig, initProjectDir } from "../lib/fs.js";
import { runHealthCheck, type HealthCheckResult } from "../lib/health.js";
import { listTemplates, createTemplate, deleteTemplate, applyTemplate } from "../lib/templates.js";
import { getDb } from "../lib/db.js";
import { extractStylesFromUrl, enrichTokensWithAi } from "../lib/extractor.js";
import { tokenizeStyles } from "../lib/tokenizer.js";
import { transform, type TransformFormat } from "../lib/transformer.js";
import { saveKit, getKit, listKits, updateKit, deleteKit, kitToProfile } from "../lib/kits.js";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf-8")
);

// ── Port resolution ──────────────────────────────────────────────────────────

async function findFreePort(start = 7200): Promise<number> {
  for (let port = start; port < start + 20; port++) {
    try {
      const server = Bun.listen({ hostname: "0.0.0.0", port, socket: { open() {}, data() {}, close() {} } });
      server.stop(true);
      return port;
    } catch {
      // port in use, try next
    }
  }
  return start + 20;
}

// ── Static file serving ───────────────────────────────────────────────────────

const thisDir = dirname(fileURLToPath(import.meta.url));
const dashboardDir = join(thisDir, "..", "..", "dashboard", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function serveStatic(urlPath: string): Response | null {
  if (!existsSync(dashboardDir)) {
    return new Response(
      JSON.stringify({ error: "Dashboard not built. Run: bun run dashboard:build" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // Strip query string
  const clean = urlPath.split("?")[0];

  // Try exact path first, then /index.html for SPA fallback
  const candidates = [
    join(dashboardDir, clean),
    join(dashboardDir, clean, "index.html"),
    join(dashboardDir, "index.html"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      try {
        const ext = "." + candidate.split(".").pop()!;
        const mime = MIME[ext] ?? "application/octet-stream";
        const content = readFileSync(candidate);
        return new Response(content, {
          headers: { "Content-Type": mime, "Cache-Control": "public, max-age=3600" },
        });
      } catch {
        return null;
      }
    }
  }

  // SPA fallback
  const index = join(dashboardDir, "index.html");
  if (existsSync(index)) {
    return new Response(readFileSync(index), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return null;
}

// ── Path validation ───────────────────────────────────────────────────────────

function isValidProjectPath(p: string): boolean {
  if (!p) return false;
  // Prevent traversal: no .. segments
  const normalized = p.replace(/\\/g, "/");
  if (normalized.includes("/../") || normalized.endsWith("/..")) return false;
  return true;
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

function err(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}

async function parseBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

// ── Health history query ──────────────────────────────────────────────────────

function getHealthHistory(projectPath: string, limit = 10): HealthCheckResult[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT * FROM health_checks WHERE project_path = ? ORDER BY run_at DESC LIMIT ?`
    )
    .all(projectPath, limit) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r.id as string,
    projectPath: r.project_path as string,
    runAt: r.run_at as number,
    violations: JSON.parse((r.violations as string) ?? "[]"),
    score: r.score as number,
    status: r.status as "pass" | "warn" | "fail",
    filesScanned: (r.files_scanned as number) ?? 0,
  }));
}

function getLatestHealthCheck(projectPath: string): HealthCheckResult | null {
  const results = getHealthHistory(projectPath, 1);
  return results[0] ?? null;
}

// ── Route handler ─────────────────────────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Security headers on all responses
  const secHeaders = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };

  // CORS for dev
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...secHeaders, "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
    });
  }

  // ── API routes ──────────────────────────────────────────────────────────────

  if (path.startsWith("/api/")) {

    // GET /api/version
    if (path === "/api/version" && method === "GET") {
      return json({ version: pkg.version });
    }

    // GET /api/styles
    if (path === "/api/styles" && method === "GET") {
      const category = url.searchParams.get("category");
      const styles = category ? getStylesByCategory(category) : STYLES;
      return json(styles);
    }

    // GET /api/styles/search?q=
    if (path === "/api/styles/search" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      return json(searchStyles(q));
    }

    // GET /api/styles/:name
    const styleMatch = path.match(/^\/api\/styles\/([^/]+)$/);
    if (styleMatch && method === "GET") {
      const name = styleMatch[1];
      const meta = getStyle(name);
      if (!meta) return err(`Style not found: ${name}`, 404);

      const profile = getBuiltinStyleProfile(name);

      // Try to read STYLE.md content
      const thisFile = fileURLToPath(import.meta.url);
      const stylesRoot = join(dirname(thisFile), "..", "..", "styles", name);
      let styleMd: string | null = null;
      const mdPath = join(stylesRoot, "STYLE.md");
      if (existsSync(mdPath)) {
        styleMd = readFileSync(mdPath, "utf-8");
      }

      return json({ ...profile, styleMd });
    }

    // GET /api/profiles
    if (path === "/api/profiles" && method === "GET") {
      return json(listProfiles());
    }

    // POST /api/profiles
    if (path === "/api/profiles" && method === "POST") {
      const body = await parseBody<CreateProfileInput>(req);
      if (!body) return err("Invalid JSON body");
      if (!body.name) return err("name is required");
      try {
        return json(createProfile(body), 201);
      } catch (e) {
        return err((e as Error).message);
      }
    }

    // PUT /api/profiles/:id
    const profileUpdateMatch = path.match(/^\/api\/profiles\/([^/]+)$/);
    if (profileUpdateMatch && method === "PUT") {
      const id = profileUpdateMatch[1];
      const body = await parseBody<Partial<CreateProfileInput>>(req);
      if (!body) return err("Invalid JSON body");
      try {
        return json(updateProfile(id, body));
      } catch (e) {
        return err((e as Error).message, 404);
      }
    }

    // DELETE /api/profiles/:id
    if (profileUpdateMatch && method === "DELETE") {
      const id = profileUpdateMatch![1];
      deleteProfile(id);
      return json({ ok: true });
    }

    // GET /api/preferences?project=
    if (path === "/api/preferences" && method === "GET") {
      const project = url.searchParams.get("project") ?? undefined;
      return json(listPrefs(project));
    }

    // POST /api/preferences
    if (path === "/api/preferences" && method === "POST") {
      const body = await parseBody<{ key: string; value: string; scope: "global" | "project"; projectPath?: string }>(req);
      if (!body) return err("Invalid JSON body");
      if (!body.key || body.value === undefined) return err("key and value are required");
      if (body.scope === "project" && !body.projectPath) return err("projectPath required for project scope");
      if (body.projectPath && !isValidProjectPath(body.projectPath)) return err("Invalid projectPath");
      try {
        setPref(body.key, body.value, body.scope ?? "global", body.projectPath);
        return json({ ok: true });
      } catch (e) {
        return err((e as Error).message);
      }
    }

    // DELETE /api/preferences/:key
    const prefDeleteMatch = path.match(/^\/api\/preferences\/([^/]+)$/);
    if (prefDeleteMatch && method === "DELETE") {
      const key = decodeURIComponent(prefDeleteMatch[1]);
      const scope = (url.searchParams.get("scope") ?? "global") as "global" | "project";
      const project = url.searchParams.get("project") ?? undefined;
      if (project && !isValidProjectPath(project)) return err("Invalid projectPath");
      deletePref(key, scope, project);
      return json({ ok: true });
    }

    // GET /api/projects
    if (path === "/api/projects" && method === "GET") {
      const projects = listProjectDirs().map((p) => ({
        path: p,
        config: getProjectConfig(p),
      }));
      return json(projects);
    }

    // POST /api/projects/init
    if (path === "/api/projects/init" && method === "POST") {
      const body = await parseBody<{ projectPath: string; styleName?: string }>(req);
      if (!body?.projectPath) return err("projectPath is required");
      if (!isValidProjectPath(body.projectPath)) return err("Invalid projectPath");

      try {
        initProjectDir(body.projectPath);
        const now = Date.now();
        const config = getProjectConfig(body.projectPath) ?? {
          projectPath: body.projectPath,
          profileId: null,
          activeTemplateId: null,
          customOverrides: {},
          hookInstalled: false,
          updatedAt: now,
        };
        config.updatedAt = now;
        setProjectConfig(body.projectPath, config);
        return json({ ok: true, projectPath: body.projectPath });
      } catch (e) {
        return err((e as Error).message);
      }
    }

    // GET /api/health?project=
    if (path === "/api/health" && method === "GET") {
      const project = url.searchParams.get("project");
      if (!project) return err("project query param required");
      if (!isValidProjectPath(project)) return err("Invalid projectPath");
      const result = getLatestHealthCheck(project);
      if (!result) return json(null);
      return json(result);
    }

    // POST /api/health/run
    if (path === "/api/health/run" && method === "POST") {
      const body = await parseBody<{ projectPath: string; useAi?: boolean }>(req);
      if (!body?.projectPath) return err("projectPath is required");
      if (!isValidProjectPath(body.projectPath)) return err("Invalid projectPath");
      if (!existsSync(body.projectPath)) return err("Project path does not exist", 404);

      try {
        const result = await runHealthCheck(body.projectPath);
        return json(result);
      } catch (e) {
        return err((e as Error).message);
      }
    }

    // GET /api/health/history?project=&limit=
    if (path === "/api/health/history" && method === "GET") {
      const project = url.searchParams.get("project");
      if (!project) return err("project query param required");
      if (!isValidProjectPath(project)) return err("Invalid projectPath");
      const limit = parseInt(url.searchParams.get("limit") ?? "10", 10);
      return json(getHealthHistory(project, Math.min(limit, 100)));
    }

    // GET /api/templates
    if (path === "/api/templates" && method === "GET") {
      return json(listTemplates());
    }

    // POST /api/templates
    if (path === "/api/templates" && method === "POST") {
      const body = await parseBody<Parameters<typeof createTemplate>[0]>(req);
      if (!body) return err("Invalid JSON body");
      if (!body.name) return err("name is required");
      try {
        return json(createTemplate(body), 201);
      } catch (e) {
        return err((e as Error).message);
      }
    }

    // DELETE /api/templates/:id  AND  POST /api/templates/:id/apply
    const templateMatch = path.match(/^\/api\/templates\/([^/]+)(\/apply)?$/);
    if (templateMatch) {
      const id = templateMatch[1];
      const isApply = !!templateMatch[2];

      if (isApply && method === "POST") {
        const body = await parseBody<{ projectPath: string }>(req);
        if (!body?.projectPath) return err("projectPath is required");
        if (!isValidProjectPath(body.projectPath)) return err("Invalid projectPath");
        const result = applyTemplate(id, body.projectPath);
        return json(result, result.success ? 200 : 400);
      }

      if (!isApply && method === "DELETE") {
        deleteTemplate(id);
        return json({ ok: true });
      }
    }

    // POST /api/extract
    if (path === "/api/extract" && method === "POST") {
      const body = await parseBody<{ url: string; name?: string; save?: boolean; tags?: string[] }>(req);
      if (!body?.url) return err("url is required");
      try {
        const raw = await extractStylesFromUrl(body.url);
        const tokens = tokenizeStyles(raw);

        // Auto-enrich with AI if Cerebras key is available
        let enrichment = null;
        if (process.env["CEREBRAS_API_KEY"]) {
          enrichment = await enrichTokensWithAi(tokens, body.url);
          for (const color of tokens.colors) {
            const name = enrichment.colorNames[color.value];
            if (name) color.name = name;
          }
        }

        const configs = {
          shadcn: transform(tokens, "shadcn").code,
          tailwind: transform(tokens, "tailwind").code,
          "css-vars": transform(tokens, "css-vars").code,
          mui: transform(tokens, "mui").code,
          radix: transform(tokens, "radix").code,
        };
        let kit = null;
        if (body.save && body.name) {
          kit = saveKit({ name: body.name, url: body.url, tokens, raw, tags: body.tags, extractedAt: raw.extractedAt });
        }
        return json({ tokens, configs, kit, enrichment, url: body.url, extractedAt: raw.extractedAt });
      } catch (e) {
        return err((e as Error).message);
      }
    }

    // GET /api/kits
    if (path === "/api/kits" && method === "GET") {
      const search = url.searchParams.get("search") ?? undefined;
      const tags = url.searchParams.get("tags")?.split(",").filter(Boolean) ?? undefined;
      return json(listKits({ search, tags }));
    }

    // POST /api/kits
    if (path === "/api/kits" && method === "POST") {
      const body = await parseBody<{ name: string; url: string; tokens: unknown; tags?: string[]; notes?: string }>(req);
      if (!body?.name || !body.url || !body.tokens) return err("name, url, and tokens are required");
      try {
        const kit = saveKit({ name: body.name, url: body.url, tokens: body.tokens as Parameters<typeof saveKit>[0]["tokens"], tags: body.tags, notes: body.notes });
        return json(kit, 201);
      } catch (e) {
        return err((e as Error).message);
      }
    }

    // POST /api/kits/:id/save-as-profile
    const kitProfileMatch = path.match(/^\/api\/kits\/([^/]+)\/save-as-profile$/);
    if (kitProfileMatch && method === "POST") {
      const id = kitProfileMatch[1];
      const body = await parseBody<{ name: string }>(req);
      if (!body?.name) return err("name is required");
      const kit = getKit(id);
      if (!kit) return err("Kit not found", 404);
      try {
        const profileInput = kitToProfile(kit, body.name);
        const profile = createProfile(profileInput);
        return json(profile, 201);
      } catch (e) {
        return err((e as Error).message);
      }
    }

    // GET /api/kits/:id  PUT /api/kits/:id  DELETE /api/kits/:id  GET /api/kits/:id/export
    const kitMatch = path.match(/^\/api\/kits\/([^/]+)(\/export)?$/);
    if (kitMatch) {
      const id = kitMatch[1];
      const isExport = !!kitMatch[2];

      if (isExport && method === "GET") {
        const kit = getKit(id);
        if (!kit) return err("Kit not found", 404);
        const format = (url.searchParams.get("format") ?? "shadcn") as TransformFormat;
        const result = transform(kit.tokens, format);
        return json({ format, code: result.code, config: result.config });
      }

      if (!isExport && method === "GET") {
        const kit = getKit(id);
        if (!kit) return err("Kit not found", 404);
        return json(kit);
      }

      if (!isExport && method === "PUT") {
        const body = await parseBody<Partial<{ name: string; tags: string[]; notes: string }>>(req);
        if (!body) return err("Invalid JSON body");
        try {
          return json(updateKit(id, body));
        } catch (e) {
          return err((e as Error).message, 404);
        }
      }

      if (!isExport && method === "DELETE") {
        deleteKit(id);
        return json({ ok: true });
      }
    }

    return err("Not found", 404);
  }

  // ── Static files ──────────────────────────────────────────────────────────
  const staticResponse = serveStatic(path);
  if (staticResponse) return staticResponse;

  return err("Not found", 404);
}

// ── Start server ──────────────────────────────────────────────────────────────

const noOpen = process.argv.includes("--no-open");

const port = await findFreePort(7200);

const server = Bun.serve({
  port,
  fetch: handleRequest,
});

const url = `http://localhost:${port}`;
console.log(`\n  open-styles server running at ${url}\n`);

if (!noOpen) {
  Bun.spawn(["open", url], { stdio: ["ignore", "ignore", "ignore"] });
}
