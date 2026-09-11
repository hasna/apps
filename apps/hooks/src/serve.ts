#!/usr/bin/env bun
/**
 * hooks serve — the local registry HTTP API.
 *
 * Catalog and artifact reads are open; publishing (PUT) requires the API key.
 * The published set is hooks.lock, the same pin file the client syncs from.
 */

import { HOOKS, type HookEvent } from "./lib/registry.js";
import { listCustomHooks, shortManifestName } from "./lib/manifest.js";
import { readLock, sha256File, retrustHook } from "./lib/store.js";
import { resolveHook } from "./lib/resolve.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHooksServePublishKey } from "./lib/transport.js";
import { secureEqual } from "./lib/secure-compare.js";
import { openApiDocument } from "./openapi.js";
import { SEMVER_PATTERN } from "./lib/semver.js";
import {
  HOOK_EVENT_STORE_UNCONFIGURED,
  HookEventValidationError,
  resolveHookEventStore,
  type HookEventStore,
} from "./server/event-store.js";
import { boundedRowLimit, normalizeSince, type HookEventQuery } from "./lib/event-types.js";

// Distinct from the MCP SSE default (39427) so `hooks serve` and
// `hooks mcp --sse` can run on the same machine without colliding.
export const DEFAULT_SERVE_PORT = 39428;
export const SERVE_HOST = "127.0.0.1";
export const SERVE_SERVICE_NAME = "hooks-registry";

function packageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export interface CatalogEntry {
  name: string;
  version: string;
  sha256: string;
  events: string[];
  description: string;
  source: string;
  versions: string[];
}

export interface ArtifactPayload {
  manifest: {
    name: string;
    version: string;
    description?: string;
    events: string[];
    script: string;
    script_kind?: "inline" | "file";
    args?: string[];
    timeout_ms?: number;
  };
  script: string;
}

async function buildCatalog(): Promise<CatalogEntry[]> {
  const byName = new Map<string, CatalogEntry>();
  for (const meta of HOOKS) {
    const scriptPath = resolveHook(meta.name)?.scriptPath;
    if (!scriptPath) continue;
    const sha = await sha256File(scriptPath);
    byName.set(meta.name, {
      name: meta.name,
      version: meta.version,
      sha256: sha,
      events: meta.events && meta.events.length > 0 ? meta.events : [meta.event as HookEvent],
      description: meta.description,
      source: "bundled",
      versions: [meta.version],
    });
  }
  for (const custom of listCustomHooks()) {
    const name = shortManifestName(custom.manifest.name);
    const sha = await sha256File(custom.scriptPath);
    const existing = byName.get(name);
    byName.set(name, {
      name,
      version: custom.manifest.version,
      sha256: sha,
      events: custom.manifest.events,
      description: custom.manifest.description ?? "Custom hook",
      source: existing ? "custom-overrides-bundled" : "custom",
      versions: existing ? [...new Set([...existing.versions, custom.manifest.version])] : [custom.manifest.version],
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function artifactFor(name: string, version: string): Promise<ArtifactPayload | null> {
  const resolved = resolveHook(name);
  if (!resolved) return null;
  if (version !== resolved.version) return null;
  const custom = listCustomHooks().find((c) => shortManifestName(c.manifest.name) === name);
  const manifest = {
    name,
    version: resolved.version,
    description: resolved.description,
    events: resolved.events,
    // P1-2: the manifest's script_kind travels with the artifact. Without
    // it the client falls back to the newline heuristic, so a one-line
    // inline hook served here would install broken through serve→sync.
    script: custom ? custom.manifest.script : `src/hook.ts`,
    script_kind: custom?.manifest.script_kind,
    args: custom?.manifest.args,
    timeout_ms: custom?.manifest.timeout_ms,
  };
  const script = await Bun.file(resolved.scriptPath).text();
  return { manifest, script };
}

function authorized(req: Request, apiKey: string | undefined): boolean {
  if (!apiKey) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) return secureEqual(header.slice("Bearer ".length), apiKey);
  return secureEqual(req.headers.get("x-api-key") ?? "", apiKey);
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * Server dependencies a caller may inject. `eventStore` exists so the route
 * tests can drive the REAL handler against an in-memory store without a
 * PostgreSQL instance; production passes nothing and the DSN decides.
 */
export interface ServeDeps {
  eventStore?: HookEventStore | null;
  /** Resolves the store when none was injected. Defaults to the DSN-backed one. */
  resolveEventStore?: () => HookEventStore | null;
}

function eventStoreOf(deps: ServeDeps): HookEventStore | null {
  if (deps.eventStore !== undefined) return deps.eventStore;
  return (deps.resolveEventStore ?? resolveHookEventStore)();
}

function boolParam(params: URLSearchParams, name: string): boolean {
  const value = params.get(name);
  return value === "1" || value === "true";
}

function eventQueryFrom(params: URLSearchParams): HookEventQuery {
  const limitRaw = params.get("limit");
  const parsedLimit = limitRaw === null ? undefined : Number.parseInt(limitRaw, 10);
  return {
    hook: params.get("hook") ?? undefined,
    session: params.get("session") ?? undefined,
    since: normalizeSince(params.get("since")) ?? undefined,
    search: params.get("q") ?? undefined,
    errorsOnly: boolParam(params, "errors_only"),
    limit: boundedRowLimit(Number.isFinite(parsedLimit as number) ? (parsedLimit as number) : undefined, 50),
  };
}

/** Turn a store failure into an honest status: 400 for caller mistakes, 500 otherwise. */
function storeFailure(error: unknown): Response {
  if (error instanceof HookEventValidationError) return json({ error: error.message }, 400);
  return json({ error: `event store failure: ${error instanceof Error ? error.message : String(error)}` }, 500);
}

async function handleEventRoutes(
  req: Request,
  url: URL,
  store: HookEventStore,
): Promise<Response> {
  try {
    if (url.pathname === "/api/v1/events" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      const submitted = Array.isArray(body)
        ? body
        : body && typeof body === "object" && Array.isArray((body as { events?: unknown[] }).events)
          ? (body as { events: unknown[] }).events
          : [body];
      if (submitted.length === 0) return json({ error: "no events submitted" }, 400);
      if (submitted.length > 100) return json({ error: "at most 100 events per request" }, 400);
      const written = await store.insertEvents(submitted as never[]);
      return json({ events: written, count: written.length }, 201);
    }

    if (url.pathname === "/api/v1/events" && req.method === "GET") {
      const events = await store.listEvents(eventQueryFrom(url.searchParams));
      return json({ events, count: events.length });
    }

    if (url.pathname === "/api/v1/events" && req.method === "DELETE") {
      const hook = url.searchParams.get("hook") ?? undefined;
      const deleted = await store.deleteEvents({ hook });
      return json({ deleted });
    }

    if (url.pathname === "/api/v1/events/summary" && req.method === "GET") {
      const since = normalizeSince(url.searchParams.get("since"));
      const rows = await store.summarize(since);
      const events = rows.reduce((sum, row) => sum + row.total, 0);
      const errors = rows.reduce((sum, row) => sum + row.errors, 0);
      return json({
        since,
        hooks: rows.map((row) => ({
          ...row,
          error_rate: row.total > 0 ? `${((row.errors / row.total) * 100).toFixed(1)}%` : "0%",
        })),
        totals: { events, errors, hooks_active: rows.length },
      });
    }

    if (url.pathname === "/api/v1/feedback" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      const input = (body ?? {}) as { message?: unknown; email?: unknown; category?: unknown; version?: unknown };
      if (typeof input.message !== "string" || input.message.trim() === "") {
        return json({ error: "'message' is required and must be a non-empty string" }, 400);
      }
      const saved = await store.insertFeedback({
        message: input.message,
        email: typeof input.email === "string" ? input.email : null,
        category: typeof input.category === "string" ? input.category : "general",
        version: typeof input.version === "string" ? input.version : null,
      });
      return json({ ok: true, id: saved.id }, 201);
    }
  } catch (error) {
    return storeFailure(error);
  }
  return json({ error: "Not Found" }, 404);
}

export function handleServeRequest(
  req: Request,
  apiKey: string | undefined,
  deps: ServeDeps = {},
): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/health" && req.method === "GET") {
    return Promise.resolve(json({ status: "ok", name: SERVE_SERVICE_NAME }));
  }

  if (url.pathname === "/ready" && req.method === "GET") {
    try {
      readLock();
      return Promise.resolve(json({ status: "ready", name: SERVE_SERVICE_NAME }));
    } catch {
      return Promise.resolve(json({ status: "not-ready", name: SERVE_SERVICE_NAME }, 503));
    }
  }

  if (url.pathname === "/version" && req.method === "GET") {
    return Promise.resolve(json({ version: packageVersion() }));
  }

  if (url.pathname === "/openapi.json" && req.method === "GET") {
    return Promise.resolve(json(openApiDocument));
  }

  if (url.pathname === "/api/v1/catalog" && req.method === "GET") {
    return buildCatalog().then((catalog) => json({ hooks: catalog }));
  }

  if (url.pathname === "/api/v1/lock" && req.method === "GET") {
    // P1-4(e): the lock exposes versions alongside each latest pin, matching
    // the worker's lock shape so clients can resolve exact pins.
    return buildCatalog().then((catalog) => {
      const lock = readLock();
      const byVersion: Record<string, string[]> = {};
      for (const entry of catalog) byVersion[entry.name] = entry.versions;
      const hooks: Record<string, unknown> = {};
      for (const [name, pin] of Object.entries(lock.hooks)) {
        hooks[name] = { ...pin, versions: byVersion[name] ?? [pin.version] };
      }
      return json({ hooks });
    });
  }

  // P2-10: the artifact route accepts the same semver the manifest
  // validation accepts (prerelease/build pins included), with segments
  // decoded the way the client encoded them.
  const artifactMatch = /^\/api\/v1\/hooks\/([\w-]+)\/([0-9A-Za-z.%+_-]+)$/.exec(url.pathname);
  if (artifactMatch && req.method === "GET") {
    const [, rawName, rawVersion] = artifactMatch;
    let name: string;
    let version: string;
    try {
      name = decodeURIComponent(rawName);
      version = decodeURIComponent(rawVersion);
    } catch {
      return Promise.resolve(json({ error: "invalid URL encoding" }, 400));
    }
    if (!SEMVER_PATTERN.test(version)) {
      return Promise.resolve(json({ error: `invalid semver version '${version}'` }, 400));
    }
    return artifactFor(name, version).then(async (artifact) => {
      if (!artifact) return json({ error: `Hook '${name}@${version}' not found locally` }, 404);
      const resolved = resolveHook(name);
      const sha = resolved ? await sha256File(resolved.scriptPath) : artifact.manifest.name;
      return json(artifact, 200, { "x-hook-sha256": sha });
    });
  }

  if (url.pathname === "/api/v1/hooks" && req.method === "PUT") {
    if (!authorized(req, apiKey)) {
      return Promise.resolve(json({ error: "unauthorized: valid API key required to publish" }, 401));
    }
    return req.json().then(
      (body: { name?: string; version?: string }) => {
        const name = body.name ?? "";
        const version = body.version ?? "";
        const resolved = resolveHook(name);
        if (!resolved) return json({ error: `Hook '${name}' not found in local store` }, 404);
        if (version && version !== resolved.version) {
          return json({ error: `Version mismatch: local '${name}' is ${resolved.version}, requested ${version}` }, 409);
        }
        // Single write path: retrustHook updates BOTH the SQLite record and
        // the hooks.lock pin. Publishing only the pin left the DB record
        // stale, so the next run refused the very hook that was just
        // published (DB record takes precedence in checkScriptHash).
        const check = retrustHook(name, resolved.scriptPath, resolved.version, "serve");
        return json({ ok: true, hook: { name, version: resolved.version, sha256: check.actual } });
      },
      () => json({ error: "invalid JSON body" }, 400),
    );
  }

  // Hook events and feedback: the hosted home of what `hooks run`, the MCP
  // run tools and the bundled observability hooks used to write into a local
  // SQLite file, and what `hooks log` / `hooks_log_*` read back. Unlike the
  // catalog, these are the caller's own data, so every method needs the key.
  if (url.pathname === "/api/v1/events" || url.pathname === "/api/v1/events/summary" || url.pathname === "/api/v1/feedback") {
    if (!authorized(req, apiKey)) {
      return Promise.resolve(json({ error: "unauthorized: valid API key required for hook events" }, 401));
    }
    const store = eventStoreOf(deps);
    if (!store) {
      // Honest refusal. An empty list here would read as "you have no
      // events" to a caller whose events simply live somewhere else.
      return Promise.resolve(json({ error: HOOK_EVENT_STORE_UNCONFIGURED }, 503));
    }
    return handleEventRoutes(req, url, store);
  }

  return Promise.resolve(json({ error: "Not Found" }, 404));
}

export function resolveServeOptions(options: {
  port?: number;
  host?: string;
}): { port: number; host: string } {
  // O15-00733: the container-standard PORT/HOST env vars must reach the bind.
  // ECS task-defs declare PORT (the LB health-check surface, 8080 for the
  // hooks deploy); before this, serve ignored the env and bound the local
  // registry default 39428 on loopback, so the task came up unhealthy and the
  // deploy was blocked. Precedence: explicit option > env > local default.
  const envPort = process.env.PORT?.trim();
  const envHost = process.env.HOST?.trim();
  const port =
    options.port ??
    (envPort && /^[0-9]+$/.test(envPort) ? parseInt(envPort, 10) : DEFAULT_SERVE_PORT);
  const host = options.host ?? (envHost && envHost.length > 0 ? envHost : SERVE_HOST);
  return { port, host };
}

export function startServeServer(options: {
  port?: number;
  host?: string;
}): ReturnType<typeof Bun.serve> {
  const { port, host } = resolveServeOptions(options);
  // P1-8: env-only resolution — never a CLI flag carrying the value. The
  // publish key resolves through the @hasna/contracts chain fresh on every
  // request (hasna/apps#1720), so a key rotation heals the server without a
  // restart and a deliberate tier that cannot be honoured refuses loudly.
  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      return handleServeRequest(req, resolveHooksServePublishKey());
    },
  });

  console.error(`hooks registry listening on http://${host}:${port} (publish requires an API key)`);
  return server;
}

// Direct execution — the `hooks-serve` bin. Starts the registry server with
// environment-configured credentials (the publish key resolves through the
// @hasna/contracts chain per request). Supports --port/--host argv so scripts
// and packaging smoke tests can bind an ephemeral port without colliding with
// the default.
if (import.meta.main) {
  const argv = process.argv.slice(2);
  // Binds-before-help class: --help/--version must answer BEFORE any bind.
  // They previously fell through to startServeServer(), which bound the
  // listener at 127.0.0.1:39428 and never exited (todos row dc92977d).
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`usage: hooks-serve [--port <n>] [--host <h>]   Start the local registry HTTP API
  hooks-serve --version                   Print the package version

options:
  --help              show this help and exit
  --version           print the package version and exit
`);
    process.exit(0);
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(packageVersion());
    process.exit(0);
  }
  const flagValue = (name: string): string | undefined => {
    const idx = argv.indexOf(name);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : undefined;
  };
  const portArg = flagValue("--port");
  const hostArg = flagValue("--host");
  startServeServer({
    port: portArg ? parseInt(portArg, 10) : undefined,
    host: hostArg,
  });
}
