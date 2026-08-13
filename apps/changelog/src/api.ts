import { generateChangelogMarkdown } from "./markdown.js";
import { publishChangelog } from "./publisher.js";
import { LocalChangelogStore } from "./storage.js";
import { isAbsolute, resolve, sep } from "node:path";
import type { ChangelogEntryInput, ChangelogEntryListFilter, ChangelogStore, ChangelogEntryUpdate } from "./types.js";
import {
  parseChangelogKind,
  validationErrorMessage,
} from "./validation.js";
import { VERSION } from "./version.js";

export interface ChangelogApiOptions {
  store?: ChangelogStore;
  apiToken?: string;
  corsOrigin?: string;
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value, null, 2), { ...init, headers });
}

function textResponse(text: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "text/markdown; charset=utf-8");
  return new Response(text, { ...init, headers });
}

function errorResponse(status: number, error: string): Response {
  return jsonResponse({ error }, { status });
}

function authTokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return request.headers.get("x-changelog-token");
}

function withCors(response: Response, origin = "*"): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
  headers.set("access-control-allow-headers", "authorization,content-type,x-changelog-token");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return undefined;
  return Math.min(parsed, 500);
}

function listFilterFromUrl(url: URL): ChangelogEntryListFilter {
  const kind = url.searchParams.get("kind") ?? url.searchParams.get("category");
  return {
    appId: url.searchParams.get("appId") ?? url.searchParams.get("app") ?? undefined,
    version: url.searchParams.get("version") ?? undefined,
    kind: kind ? parseChangelogKind(kind) : undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    limit: parseLimit(url.searchParams.get("limit")),
  };
}

function listFilterFromBody(body: Record<string, unknown>): ChangelogEntryListFilter {
  const kind = typeof body.kind === "string" ? body.kind : typeof body.category === "string" ? body.category : undefined;
  return {
    appId: typeof body.appId === "string" ? body.appId : typeof body.app === "string" ? body.app : undefined,
    version: typeof body.version === "string" ? body.version : undefined,
    kind: kind ? parseChangelogKind(kind) : undefined,
    tag: typeof body.tag === "string" ? body.tag : undefined,
    limit: typeof body.limit === "number" ? Math.max(1, Math.min(Math.trunc(body.limit), 500)) : undefined,
  };
}

function apiTargetPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (isAbsolute(value)) throw new Error("targetPath must be relative");
  const cwd = process.cwd();
  const target = resolve(cwd, value);
  if (target !== cwd && !target.startsWith(`${cwd}${sep}`)) {
    throw new Error("targetPath must stay inside the server working directory");
  }
  return value;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Request body must be a JSON object");
  return body as Record<string, unknown>;
}

export function createChangelogHandler(options: ChangelogApiOptions = {}): (request: Request) => Promise<Response> {
  const store = options.store ?? new LocalChangelogStore();
  const apiToken = options.apiToken ?? process.env["CHANGELOG_API_TOKEN"];
  const corsOrigin = options.corsOrigin ?? "*";

  return async function handleChangelogRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), corsOrigin);

    if (apiToken && authTokenFromRequest(request) !== apiToken) {
      return withCors(errorResponse(401, "Unauthorized"), corsOrigin);
    }

    try {
      if (request.method === "GET" && pathname === "/health") {
        return withCors(jsonResponse({ ok: true, service: "open-changelog", version: VERSION }), corsOrigin);
      }

      if (request.method === "POST" && pathname === "/v1/entries") {
        const body = await readJsonObject(request);
        const item = await store.createEntry(body as unknown as ChangelogEntryInput, {
          source: "api",
          allowDuplicate: body.allowDuplicate === true,
        });
        return withCors(jsonResponse(item, { status: 201 }), corsOrigin);
      }

      if (request.method === "GET" && pathname === "/v1/entries") {
        return withCors(jsonResponse(await store.listEntries(listFilterFromUrl(url))), corsOrigin);
      }

      if (request.method === "GET" && pathname.startsWith("/v1/entries/")) {
        const id = decodeURIComponent(pathname.slice("/v1/entries/".length));
        const item = await store.getEntry(id);
        return withCors(item ? jsonResponse(item) : errorResponse(404, "Changelog entry not found"), corsOrigin);
      }

      if (request.method === "PATCH" && pathname.startsWith("/v1/entries/")) {
        const id = decodeURIComponent(pathname.slice("/v1/entries/".length));
        const item = await store.updateEntry(id, await readJsonObject(request) as ChangelogEntryUpdate);
        return withCors(item ? jsonResponse(item) : errorResponse(404, "Changelog entry not found"), corsOrigin);
      }

      if (request.method === "GET" && pathname === "/v1/generate") {
        const filter = listFilterFromUrl(url);
        const markdown = generateChangelogMarkdown(await store.listEntries({ ...filter, limit: filter.limit ?? 500 }), {
          ...filter,
          title: url.searchParams.get("title") ?? undefined,
          repositoryUrl: url.searchParams.get("repositoryUrl") ?? undefined,
        });
        return withCors(textResponse(markdown), corsOrigin);
      }

      if (request.method === "POST" && pathname === "/v1/generate") {
        const body = await readJsonObject(request);
        const filter = listFilterFromBody(body);
        const title = typeof body.title === "string" ? body.title : undefined;
        const repositoryUrl = typeof body.repositoryUrl === "string" ? body.repositoryUrl : undefined;
        const markdown = generateChangelogMarkdown(await store.listEntries({ ...filter, limit: filter.limit ?? 500 }), {
          ...filter,
          title,
          repositoryUrl,
        });
        return withCors(jsonResponse({ markdown }), corsOrigin);
      }

      if (request.method === "POST" && pathname === "/v1/release") {
        const body = await readJsonObject(request);
        const result = await store.releaseEntries({
          appId: String(body.appId ?? body.app ?? ""),
          version: String(body.version ?? ""),
          fromVersion: typeof body.fromVersion === "string" ? body.fromVersion : undefined,
          date: typeof body.date === "string" ? body.date : undefined,
        });
        return withCors(jsonResponse(result), corsOrigin);
      }

      if (request.method === "POST" && pathname === "/v1/publish") {
        const body = await readJsonObject(request);
        const filter = listFilterFromBody(body);
        if (body.write === true && !apiToken) {
          return withCors(errorResponse(403, "CHANGELOG_API_TOKEN must be configured for API write mode"), corsOrigin);
        }
        const result = await publishChangelog({
          store,
          ...filter,
          title: typeof body.title === "string" ? body.title : undefined,
          repositoryUrl: typeof body.repositoryUrl === "string" ? body.repositoryUrl : undefined,
          targetPath: apiTargetPath(body.targetPath),
          write: body.write === true,
          diff: body.diff === true,
          backup: body.backup !== false,
        });
        return withCors(jsonResponse(result), corsOrigin);
      }

      if (request.method === "GET" && pathname === "/v1/stats") {
        return withCors(jsonResponse(await store.stats()), corsOrigin);
      }

      if (request.method === "GET" && pathname === "/v1/export.jsonl") {
        return withCors(new Response(await store.exportJsonl(listFilterFromUrl(url)), {
          headers: { "content-type": "application/x-ndjson; charset=utf-8" },
        }), corsOrigin);
      }

      return withCors(errorResponse(404, "Not found"), corsOrigin);
    } catch (error) {
      return withCors(errorResponse(400, validationErrorMessage(error)), corsOrigin);
    }
  };
}
