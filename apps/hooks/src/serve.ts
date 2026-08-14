/**
 * hooks serve — the local registry HTTP API.
 *
 * Catalog and artifact reads are open; publishing (PUT) requires the API key.
 * The published set is hooks.lock, the same pin file the client syncs from.
 */

import { HOOKS, type HookEvent } from "./lib/registry.js";
import { listCustomHooks, shortManifestName } from "./lib/manifest.js";
import { readLock, sha256File, setPinnedHook } from "./lib/store.js";
import { resolveHook } from "./lib/resolve.js";
import { resolveApiKey } from "./config.js";

export const DEFAULT_SERVE_PORT = 39427;
export const SERVE_HOST = "127.0.0.1";
export const SERVE_SERVICE_NAME = "hooks-registry";

export interface CatalogEntry {
  name: string;
  version: string;
  sha256: string;
  events: string[];
  description: string;
  source: string;
}

export interface ArtifactPayload {
  manifest: {
    name: string;
    version: string;
    description?: string;
    events: string[];
    script: string;
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
    byName.set(meta.name, {
      name: meta.name,
      version: meta.version,
      sha256: await sha256File(scriptPath),
      events: meta.events && meta.events.length > 0 ? meta.events : [meta.event as HookEvent],
      description: meta.description,
      source: "bundled",
    });
  }
  for (const custom of listCustomHooks()) {
    const name = shortManifestName(custom.manifest.name);
    byName.set(name, {
      name,
      version: custom.manifest.version,
      sha256: await sha256File(custom.scriptPath),
      events: custom.manifest.events,
      description: custom.manifest.description ?? "Custom hook",
      source: byName.has(name) ? "custom-overrides-bundled" : "custom",
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
    script: custom ? custom.manifest.script : `src/hook.ts`,
    args: custom?.manifest.args,
    timeout_ms: custom?.manifest.timeout_ms,
  };
  const script = await Bun.file(resolved.scriptPath).text();
  return { manifest, script };
}

function authorized(req: Request, apiKey: string | undefined): boolean {
  if (!apiKey) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length) === apiKey;
  return req.headers.get("x-api-key") === apiKey;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function handleServeRequest(req: Request, apiKey: string | undefined): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/health" && req.method === "GET") {
    return Promise.resolve(json({ status: "ok", name: SERVE_SERVICE_NAME }));
  }

  if (url.pathname === "/api/v1/catalog" && req.method === "GET") {
    return buildCatalog().then((catalog) => json({ hooks: catalog }));
  }

  if (url.pathname === "/api/v1/lock" && req.method === "GET") {
    return Promise.resolve(json(readLock()));
  }

  const artifactMatch = /^\/api\/v1\/hooks\/([\w-]+)\/(\d+\.\d+\.\d+)$/.exec(url.pathname);
  if (artifactMatch && req.method === "GET") {
    const [, name, version] = artifactMatch;
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
        return sha256File(resolved.scriptPath).then((hash) => {
          setPinnedHook(name, { version: resolved.version, sha256: hash, source: "serve" });
          return json({ ok: true, hook: { name, version: resolved.version, sha256: hash } });
        });
      },
      () => json({ error: "invalid JSON body" }, 400),
    );
  }

  return Promise.resolve(json({ error: "Not Found" }, 404));
}

export function startServeServer(options: {
  port?: number;
  host?: string;
  apiKey?: string;
}): ReturnType<typeof Bun.serve> {
  const port = options.port ?? DEFAULT_SERVE_PORT;
  const host = options.host ?? SERVE_HOST;
  const apiKey = resolveApiKey(options.apiKey);

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      return handleServeRequest(req, apiKey);
    },
  });

  console.error(`hooks registry listening on http://${host}:${port} (publish requires an API key)`);
  return server;
}
