// machines-serve — the HTTP control-plane API for the machine registry.
//
// Surfaces:
//   GET /health           liveness (no auth)         -> { status, version, mode }
//   GET /ready            readiness (no auth)        -> reachable RDS + migrated
//   GET /version          version (no auth)          -> { status, version, mode }
//   GET /openapi.json     the OpenAPI document (no auth)
//   /v1/machines[...]     registry CRUD (API-key auth, scopes machines:read/write)
//   /v1/heartbeats        fleet heartbeats (API-key auth, machines:read)
//
// Auth is the @hasna/contracts API-key kit (stateless HMAC tokens + hashed-at-
// rest revocation records). Amendment A1: every request reads/writes RDS
// directly through the vendored storage kit — no cache, no local mirror.

import { verifyApiKey, ApiKeyStore, type ApiKeyVerifier } from "@hasna/contracts/auth";
import { getPackageVersion } from "../version.js";
import { resolveStorageMode } from "../generated/storage-kit/mode.js";
import { checkHealth } from "../generated/storage-kit/health.js";
import { DEFAULT_MIGRATION_LEDGER_TABLE } from "../generated/storage-kit/migrations.js";
import { getServiceClient } from "./db.js";
import { MachineRegistry, RegistryValidationError } from "./registry.js";
import { allMigrations } from "./migrate.js";
import { buildOpenApiDocument } from "./openapi.js";

/**
 * Read-only readiness check. The serve process runs as the DML-only app role,
 * so it cannot CREATE the ledger table — it can only observe whether every
 * expected migration id is already recorded in `schema_migrations`. Reachable
 * DB + all migrations present => ready.
 */
async function readonlyReadiness(): Promise<{ ok: boolean; pending: string[]; latencyMs: number; error?: string }> {
  const start = Date.now();
  const client = getServiceClient();
  const health = await checkHealth(client);
  if (!health.ok) {
    return { ok: false, pending: [], latencyMs: Date.now() - start, error: health.error ?? "database unreachable" };
  }
  const expected = allMigrations().map((m) => m.id);
  try {
    const rows = await client.many<{ id: string }>(`SELECT id FROM ${DEFAULT_MIGRATION_LEDGER_TABLE}`);
    const applied = new Set(rows.map((r) => String(r.id)));
    const pending = expected.filter((id) => !applied.has(id));
    return { ok: pending.length === 0, pending, latencyMs: Date.now() - start };
  } catch (error) {
    // Ledger table absent => migrations have not run yet.
    return { ok: false, pending: expected, latencyMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) };
  }
}

const APP = "machines";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...SECURITY_HEADERS, ...extra },
  });
}

function resolveMode(): string {
  try {
    return resolveStorageMode(APP).mode;
  } catch {
    return process.env["HASNA_APP_MODE"] || "unknown";
  }
}

function resolveSigningSecret(): string {
  const secret = process.env["HASNA_MACHINES_API_SIGNING_KEY"]
    || process.env["API_KEY_SIGNING_SECRET"]
    || process.env["HASNA_API_SIGNING_KEY"];
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      "machines-serve requires an API-key signing secret. Set HASNA_MACHINES_API_SIGNING_KEY "
        + "(or API_KEY_SIGNING_SECRET). Refusing to start without auth.",
    );
  }
  return secret;
}

export interface StartServerOptions {
  host?: string;
  port?: number;
}

export interface MachinesServer {
  stop(): void;
  port: number;
  hostname: string;
  url: string;
}

/**
 * Build the request handler. Isolated from Bun.serve so tests can call it with
 * a synthetic Request and injected registry/verifier.
 */
export function createHandler(deps: {
  registry: () => MachineRegistry;
  verifier: ApiKeyVerifier;
  ensureAuthSchema: () => Promise<void>;
}): (req: Request) => Promise<Response> {
  let authSchemaReady = false;

  async function authorize(req: Request, requiredScopes: string[]): Promise<Response | null> {
    if (!authSchemaReady) {
      await deps.ensureAuthSchema();
      authSchemaReady = true;
    }
    const url = new URL(req.url);
    const decision = await deps.verifier.authenticate(req.headers, {
      method: req.method,
      path: url.pathname,
      requiredScopes,
    });
    if (decision.ok) return null;
    return json({ error: decision.message, reason: decision.reason }, decision.status, {
      "WWW-Authenticate": "Bearer",
    });
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    // ---- unauthenticated operational probes --------------------------------
    if (path === "/health" && method === "GET") {
      return json({ status: "ok", version: getPackageVersion(), mode: resolveMode() });
    }
    if (path === "/version" && method === "GET") {
      return json({ status: "ok", version: getPackageVersion(), mode: resolveMode() });
    }
    if (path === "/openapi.json" && method === "GET") {
      return json(buildOpenApiDocument());
    }
    if (path === "/ready" && method === "GET") {
      try {
        const ready = await readonlyReadiness();
        const body = {
          status: ready.ok ? "ready" : "not_ready",
          version: getPackageVersion(),
          mode: resolveMode(),
          pendingMigrations: ready.pending,
          latencyMs: ready.latencyMs,
          ...(ready.error ? { error: ready.error } : {}),
        };
        return json(body, ready.ok ? 200 : 503);
      } catch (error) {
        return json(
          { status: "not_ready", version: getPackageVersion(), mode: resolveMode(), error: String(error instanceof Error ? error.message : error) },
          503,
        );
      }
    }

    // ---- /v1 registry (API-key auth) ---------------------------------------
    if (path === "/v1/machines" && method === "GET") {
      const denied = await authorize(req, ["machines:read"]);
      if (denied) return denied;
      const status = url.searchParams.get("status") ?? undefined;
      const limit = url.searchParams.get("limit");
      const offset = url.searchParams.get("offset");
      const machines = await deps.registry().list({
        ...(status ? { status } : {}),
        ...(limit ? { limit: Number(limit) } : {}),
        ...(offset ? { offset: Number(offset) } : {}),
      });
      return json({ machines, count: machines.length });
    }

    if (path === "/v1/machines" && method === "POST") {
      const denied = await authorize(req, ["machines:write"]);
      if (denied) return denied;
      let payload: Record<string, unknown>;
      try {
        payload = (await req.json()) as Record<string, unknown>;
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      try {
        const record = await deps.registry().upsert({
          id: String(payload.id ?? ""),
          friendlyName: (payload.friendlyName as string | null | undefined) ?? undefined,
          platform: (payload.platform as string | null | undefined) ?? undefined,
          arch: (payload.arch as string | null | undefined) ?? undefined,
          status: (payload.status as string | undefined) ?? undefined,
          labels: (payload.labels as Record<string, unknown> | undefined) ?? undefined,
          metadata: (payload.metadata as Record<string, unknown> | undefined) ?? undefined,
        });
        return json(record, 200);
      } catch (error) {
        if (error instanceof RegistryValidationError) return json({ error: error.message }, 400);
        throw error;
      }
    }

    const machineMatch = path.match(/^\/v1\/machines\/([^/]+)$/);
    if (machineMatch) {
      const id = decodeURIComponent(machineMatch[1]!);
      if (method === "GET") {
        const denied = await authorize(req, ["machines:read"]);
        if (denied) return denied;
        const record = await deps.registry().get(id);
        return record ? json(record) : json({ error: "machine not found", reason: "not_found" }, 404);
      }
      if (method === "PATCH") {
        const denied = await authorize(req, ["machines:write"]);
        if (denied) return denied;
        let payload: Record<string, unknown>;
        try {
          payload = (await req.json()) as Record<string, unknown>;
        } catch {
          return json({ error: "invalid JSON body" }, 400);
        }
        try {
          const record = await deps.registry().update(id, payload as Parameters<MachineRegistry["update"]>[1]);
          return record ? json(record) : json({ error: "machine not found", reason: "not_found" }, 404);
        } catch (error) {
          if (error instanceof RegistryValidationError) return json({ error: error.message }, 400);
          throw error;
        }
      }
      if (method === "DELETE") {
        const denied = await authorize(req, ["machines:write"]);
        if (denied) return denied;
        const deleted = await deps.registry().remove(id);
        return json({ deleted, id }, deleted ? 200 : 404);
      }
    }

    if (path === "/v1/heartbeats" && method === "GET") {
      const denied = await authorize(req, ["machines:read"]);
      if (denied) return denied;
      const machineId = url.searchParams.get("machineId") ?? undefined;
      const limit = url.searchParams.get("limit");
      const heartbeats = await deps.registry().listHeartbeats(machineId, limit ? Number(limit) : undefined);
      return json({ heartbeats, count: heartbeats.length });
    }

    return json({ error: "not found", reason: "not_found" }, 404);
  };
}

/** Start the machines-serve HTTP server backed by RDS (Amendment A1). */
export function startServer(options: StartServerOptions = {}): MachinesServer {
  const host = options.host || process.env["HOST"] || "0.0.0.0";
  const port = options.port ?? Number(process.env["PORT"] || 8080);

  const signingSecret = resolveSigningSecret();
  const store = new ApiKeyStore(getServiceClient());
  const verifier = verifyApiKey({
    app: APP,
    signingSecret,
    isRevoked: store.isRevoked,
    audit: (e) => {
      // Structured single-line audit trail (no secret material).
      console.log(JSON.stringify({ evt: "api_auth", ...e }));
    },
  });

  const handler = createHandler({
    registry: () => new MachineRegistry(getServiceClient()),
    verifier,
    // The api_keys table is owned + created by the migration runner (owner role).
    // The serve process runs as the DML-only app role, so a CREATE TABLE here
    // would be denied. Attempt it best-effort (covers a local/owner run) and
    // ignore permission errors — the table is guaranteed by `machines db migrate`.
    ensureAuthSchema: async () => {
      try {
        await store.ensureSchema();
      } catch (error) {
        console.warn(
          JSON.stringify({
            evt: "auth_schema_ensure_skipped",
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
  });

  const server = Bun.serve({
    hostname: host,
    port,
    fetch: handler,
    error(err) {
      console.error(JSON.stringify({ evt: "server_error", message: String(err instanceof Error ? err.message : err) }));
      return json({ error: "internal server error" }, 500);
    },
  });

  const boundPort = server.port ?? port;
  const boundHost = server.hostname ?? host;
  return {
    stop: () => server.stop(true),
    port: boundPort,
    hostname: boundHost,
    url: `http://${boundHost}:${boundPort}`,
  };
}
