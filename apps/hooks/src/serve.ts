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

export function handleServeRequest(req: Request, apiKey: string | undefined): Promise<Response> {
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
