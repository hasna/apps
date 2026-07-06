/**
 * Versioned /v1 HTTP surface for testers-serve, plus the health/ready/version
 * probes. Backed by cloud Postgres (Amendment A1 pure-remote) and guarded by
 * @hasna/contracts API-key auth. Returns `null` when the request is not one of
 * these routes so the caller can fall through to the legacy dashboard handler.
 */
import { verifyApiKey, ApiKeyStore, type ApiKeyVerifier } from "@hasna/contracts/auth";
import pkg from "../../package.json";
import { getCloudClient, isCloudMode, APP_NAME } from "../db/cloud.js";
import { getPgMigrations } from "../db/pg-migrate.js";
import { checkHealth, checkReady } from "../generated/storage-kit/health.js";
import * as store from "../db/pg-store.js";
import { ValidationError } from "../db/pg-store.js";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
function err(message: string, status: number): Response {
  return json({ error: message }, status);
}

function resolveSigningSecret(): string | null {
  return (
    process.env["HASNA_TESTERS_API_SIGNING_KEY"] ||
    process.env["API_KEY_SIGNING_SECRET"] ||
    process.env["HASNA_API_SIGNING_KEY"] ||
    null
  );
}

let verifierSingleton: ApiKeyVerifier | null = null;
let storeSingleton: ApiKeyStore | null = null;

function getAuth(): ApiKeyVerifier {
  if (verifierSingleton) return verifierSingleton;
  const secret = resolveSigningSecret();
  if (!secret) {
    throw new Error(
      "API-key signing secret missing: set HASNA_TESTERS_API_SIGNING_KEY (or API_KEY_SIGNING_SECRET).",
    );
  }
  storeSingleton = new ApiKeyStore(getCloudClient());
  verifierSingleton = verifyApiKey({
    app: APP_NAME,
    signingSecret: secret,
    isRevoked: (kid) => storeSingleton!.isRevoked(kid),
    audit: (e) => {
      if (e.outcome === "deny") {
        console.warn(`[testers-serve] auth deny kid=${e.kid ?? "-"} reason=${e.reason} ${e.method} ${e.path}`);
      }
    },
  });
  return verifierSingleton;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return (body ?? {}) as Record<string, unknown>;
  } catch {
    throw new ValidationError("invalid JSON body");
  }
}

/** Authenticate; returns null on success, or a Response to short-circuit. */
async function authenticate(
  req: Request,
  method: string,
  pathname: string,
): Promise<Response | null> {
  const requiredScope = method === "GET" ? "testers:read" : "testers:write";
  let verifier: ApiKeyVerifier;
  try {
    verifier = getAuth();
  } catch (e) {
    return err(e instanceof Error ? e.message : "auth unavailable", 503);
  }
  const decision = await verifier.authenticate(req.headers, {
    method,
    path: pathname,
    requiredScopes: [requiredScope],
  });
  if (!decision.ok) {
    return err(decision.message, decision.status);
  }
  return null;
}

/**
 * Handle health/ready/version and /v1/* routes. Returns null if `pathname` is
 * none of these (fall through to legacy handler).
 */
export async function handleV1(
  req: Request,
  pathname: string,
  method: string,
  searchParams: URLSearchParams,
): Promise<Response | null> {
  const version = pkg.version;
  const mode = isCloudMode() ? "cloud" : "local";

  // ── Public probes ─────────────────────────────────────────────────────
  if (pathname === "/health" && method === "GET") {
    return json({ status: "ok", version, mode });
  }
  if (pathname === "/version" && method === "GET") {
    return json({ status: "ok", version, mode });
  }
  if (pathname === "/openapi.json" && method === "GET") {
    const { buildOpenApiDocument } = await import("./openapi.js");
    return json(buildOpenApiDocument(version));
  }
  if (pathname === "/ready" && method === "GET") {
    if (mode !== "cloud") {
      return json({ status: "ok", version, mode, pendingMigrations: [] });
    }
    try {
      const db = getCloudClient();
      const health = await checkHealth(db);
      if (!health.ok) return json({ status: "degraded", version, mode, error: health.error }, 503);
      const ready = await checkReady(db, getPgMigrations());
      return json(
        {
          status: ready.ok ? "ready" : "migrating",
          version,
          mode,
          pendingMigrations: ready.pendingMigrations,
        },
        ready.ok ? 200 : 503,
      );
    } catch (e) {
      return json({ status: "degraded", version, mode, error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (!pathname.startsWith("/v1/")) return null;

  // ── /v1/* requires cloud mode + auth ──────────────────────────────────
  if (mode !== "cloud") {
    return err("service not in cloud mode (set HASNA_TESTERS_STORAGE_MODE=cloud with a DATABASE_URL)", 503);
  }
  const authError = await authenticate(req, method, pathname);
  if (authError) return authError;

  try {
    return await route(req, pathname, method, searchParams);
  } catch (e) {
    if (e instanceof ValidationError) return err(e.message, e.status);
    console.error(`[testers-serve] /v1 error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    return err("internal server error", 500);
  }
}

async function route(
  req: Request,
  pathname: string,
  method: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  const db = getCloudClient();
  const seg = pathname.replace(/^\/v1\//, "").split("/").filter(Boolean); // e.g. ["scenarios","<id>"]
  const [resource, id, sub] = seg;

  // ── projects ──
  if (resource === "projects") {
    if (!id) {
      if (method === "GET") return json(await store.listProjects(db));
      if (method === "POST") return json(await store.createProject(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getProject(db, id), "project");
      if (method === "PUT") return notNull(await store.updateProject(db, id, (await readJson(req)) as never), "project");
    }
  }

  // ── scenarios ──
  if (resource === "scenarios") {
    if (!id) {
      if (method === "GET")
        return json(
          await store.listScenarios(db, {
            projectId: searchParams.get("projectId") ?? undefined,
            limit: numParam(searchParams.get("limit")),
          }),
        );
      if (method === "POST") return json(await store.createScenario(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getScenario(db, id), "scenario");
      if (method === "PUT") return notNull(await store.updateScenario(db, id, (await readJson(req)) as never), "scenario");
      if (method === "DELETE") return json({ deleted: await store.deleteScenario(db, id) });
    }
  }

  // ── runs ──
  if (resource === "runs") {
    if (!id) {
      if (method === "GET")
        return json(await store.listRuns(db, { projectId: searchParams.get("projectId") ?? undefined }));
      if (method === "POST") return json(await store.createRun(db, (await readJson(req)) as never), 201);
    } else if (sub === "results" && method === "GET") {
      return json(await store.listResultsByRun(db, id));
    } else if (!sub && method === "GET") {
      return notNull(await store.getRun(db, id), "run");
    }
  }

  // ── results ──
  if (resource === "results" && id && method === "GET") {
    return notNull(await store.getResult(db, id), "result");
  }

  // ── personas ──
  if (resource === "personas") {
    if (!id) {
      if (method === "GET")
        return json(await store.listPersonas(db, { projectId: searchParams.get("projectId") ?? undefined }));
      if (method === "POST") return json(await store.createPersona(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getPersona(db, id), "persona");
      if (method === "PUT") return notNull(await store.updatePersona(db, id, (await readJson(req)) as never), "persona");
      if (method === "DELETE") return json({ deleted: await store.deletePersona(db, id) });
    }
  }

  return err("not found", 404);
}

function notNull<T>(value: T | null, name: string): Response {
  return value ? json(value) : err(`${name} not found`, 404);
}
function numParam(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
