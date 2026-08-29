/**
 * Versioned /v1 HTTP surface for testers-serve, plus the health/ready/version
 * probes. Backed by Postgres when `HASNA_TESTERS_DATABASE_URL` is configured
 * (SQLite otherwise) and guarded by @hasna/contracts API-key auth. Returns
 * `null` when the request is not one of these routes so the caller can fall
 * through to the legacy dashboard handler.
 */
import { verifyApiKey, ApiKeyStore, type ApiKeyVerifier } from "@hasna/contracts/auth";
import pkg from "../../package.json";
import { getCloudClient, databaseUrlPresent, APP_NAME } from "../db/cloud.js";
import { getPgMigrations } from "../db/pg-migrate.js";
import { checkHealth, checkReady } from "../generated/storage-kit/health.js";
import * as store from "../db/pg-store.js";
import { ValidationError } from "../db/pg-store.js";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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
    keyStatus: (kid) => storeSingleton!.keyStatus(kid),
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
export async function authenticate(
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
  const dbConfigured = databaseUrlPresent();

  // ── Public probes ─────────────────────────────────────────────────────
  if (pathname === "/health" && method === "GET") {
    return json({ status: "ok", version });
  }
  if (pathname === "/version" && method === "GET") {
    return json({ status: "ok", version });
  }
  if (pathname === "/openapi.json" && method === "GET") {
    const { buildOpenApiDocument } = await import("./openapi.js");
    return json(buildOpenApiDocument(version));
  }
  if (pathname === "/ready" && method === "GET") {
    if (!dbConfigured) {
      return json({ status: "ok", version, pendingMigrations: [] });
    }
    try {
      const db = getCloudClient();
      const health = await checkHealth(db);
      if (!health.ok) return json({ status: "degraded", version, error: health.error }, 503);
      const ready = await checkReady(db, getPgMigrations());
      return json(
        {
          status: ready.ok ? "ready" : "migrating",
          version,
          pendingMigrations: ready.pendingMigrations,
        },
        ready.ok ? 200 : 503,
      );
    } catch (e) {
      return json({ status: "degraded", version, error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (!pathname.startsWith("/v1/")) return null;

  // ── /v1/* requires the Postgres backend + auth ────────────────────────
  if (!dbConfigured) {
    return err("service has no database configured (set HASNA_TESTERS_DATABASE_URL)", 503);
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

/**
 * Split a `/v1/...` pathname into decoded path segments.
 *
 * The standard Hasna storage client `encodeURIComponent()`s every id (RFC 3986),
 * so a composite id like `scenarioId:dependsOn` arrives on the wire as
 * `scenarioId%3AdependsOn`. Percent-decode each segment here so reserved
 * characters (`:`, `/`, spaces, ...) round-trip to the literal form the route
 * handlers expect. Malformed escapes fall back to the raw segment.
 */
export function parsePathSegments(pathname: string): string[] {
  return pathname
    .replace(/^\/v1\//, "")
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

async function route(
  req: Request,
  pathname: string,
  method: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  const db = getCloudClient();
  const seg = parsePathSegments(pathname); // e.g. ["scenarios","<id>"]
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
    // Aggregate/bulk sub-routes (must precede the id-based branch).
    if (id && sub === "result-stats" && method === "GET") {
      return json(await store.getScenarioResultStats(db, id));
    }
    if (id === "count" && method === "GET") {
      return json({ count: await store.countScenarios(db) });
    }
    if (id === "import" && method === "POST") {
      return json(await store.importScenarios(db, (await readJson(req)) as never), 200);
    }
    if (!id) {
      if (method === "GET")
        return json(
          await store.listScenarios(db, {
            projectId: searchParams.get("projectId") ?? undefined,
            limit: numParam(searchParams.get("limit")),
            offset: numParam(searchParams.get("offset")),
          }),
        );
      if (method === "POST") return json(await store.createScenario(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getScenario(db, id), "scenario");
      if (method === "PUT") return notNull(await store.updateScenario(db, id, (await readJson(req)) as never), "scenario");
      if (method === "PATCH") {
        // Pass-cache write: the hosted client (ApiStore.updateScenarioPassedCache)
        // sends { lastPassedUrl } and the runner treats a failure as non-critical,
        // so an unhandled PATCH silently no-ops the cache (regression ff19ac0f).
        const body = (await readJson(req)) as { lastPassedUrl?: string };
        if (typeof body?.lastPassedUrl !== "string" || !body.lastPassedUrl) {
          throw new ValidationError("lastPassedUrl is required");
        }
        return notNull(await store.updateScenarioPassedCache(db, id, body.lastPassedUrl), "scenario");
      }
      if (method === "DELETE") return json({ deleted: await store.deleteScenario(db, id) });
    }
  }

  // ── runs ──
  if (resource === "runs") {
    if (!id) {
      if (method === "GET")
        return json(
          await store.listRuns(db, {
            projectId: searchParams.get("projectId") ?? undefined,
            limit: numParam(searchParams.get("limit")),
            offset: numParam(searchParams.get("offset")),
          }),
        );
      if (method === "POST") return json(await store.createRun(db, (await readJson(req)) as never), 201);
    } else if (sub === "results" && method === "GET") {
      return json(await store.listResultsByRun(db, id));
    } else if (!sub && method === "GET") {
      return notNull(await store.getRun(db, id), "run");
    } else if (!sub && (method === "PUT" || method === "PATCH")) {
      return notNull(await store.updateRun(db, id, (await readJson(req)) as never), "run");
    }
  }

  // ── results ──
  if (resource === "results") {
    if (!id) {
      // Collection create: the runner's ApiStore.createResult POSTs /v1/results
      // to record each scenario result. The route was missing since the /v1
      // surface landed (2289f8b36) — only GET /v1/results/:id existed — so
      // hosted-store sandbox runs 404'd on result recording (OPE21-00033).
      if (method === "POST") return json(await store.createResult(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getResult(db, id), "result");
      // Runner's ApiStore.updateResult PUTs the progress/final state per scenario.
      if (method === "PUT" || method === "PATCH") {
        return notNull(await store.updateResult(db, id, (await readJson(req)) as never), "result");
      }
    }
  }

  // ── personas ──
  if (resource === "personas") {
    if (!id) {
      if (method === "GET")
        return json(
          await store.listPersonas(db, {
            projectId: searchParams.get("projectId") ?? undefined,
            limit: numParam(searchParams.get("limit")),
            offset: numParam(searchParams.get("offset")),
          }),
        );
      if (method === "POST") return json(await store.createPersona(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getPersona(db, id), "persona");
      if (method === "PUT") return notNull(await store.updatePersona(db, id, (await readJson(req)) as never), "persona");
      if (method === "DELETE") return json({ deleted: await store.deletePersona(db, id) });
    }
  }

  // ── scan issues ──
  if (resource === "scan-issues") {
    if (!id) {
      if (method === "GET")
        return json(
          await store.listScanIssues(db, {
            status: searchParams.get("status") ?? undefined,
            type: searchParams.get("type") ?? undefined,
            projectId: searchParams.get("projectId") ?? undefined,
            limit: numParam(searchParams.get("limit")),
            offset: numParam(searchParams.get("offset")),
          }),
        );
      // POST upserts by fingerprint (server owns dedup); returns { issue, outcome }.
      if (method === "POST") return json(await store.upsertScanIssue(db, (await readJson(req)) as never), 200);
    } else {
      if (method === "GET") return notNull(await store.getScanIssue(db, id), "scan issue");
      if (method === "PATCH") {
        const body = await readJson(req);
        if (typeof body["todoTaskId"] === "string") {
          return notNull(await store.setScanIssueTodoTaskId(db, id, body["todoTaskId"]), "scan issue");
        }
        if (body["status"] === "resolved") {
          return (await store.resolveScanIssue(db, id))
            ? json({ id, status: "resolved" })
            : err("scan issue not found", 404);
        }
        return err("unsupported scan-issue patch", 400);
      }
    }
  }

  // ── webhooks ──
  if (resource === "webhooks") {
    if (!id) {
      if (method === "GET")
        return json(
          await store.listWebhooks(db, {
            projectId: searchParams.get("projectId") ?? undefined,
            limit: numParam(searchParams.get("limit")),
            offset: numParam(searchParams.get("offset")),
          }),
        );
      if (method === "POST") return json(await store.createWebhook(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getWebhook(db, id), "webhook");
      if (method === "DELETE") return json({ deleted: await store.deleteWebhook(db, id) });
    }
  }

  // ── agents ──
  if (resource === "agents") {
    if (!id) {
      if (method === "GET") return json(await store.listAgents(db));
      if (method === "POST") return json(await store.registerAgent(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getAgent(db, id), "agent");
      if (method === "PATCH") return notNull(await store.updateAgent(db, id, (await readJson(req)) as never), "agent");
    }
  }

  // ── environments ──
  if (resource === "environments") {
    if (!id) {
      if (method === "GET") return json(await store.listEnvironments(db, searchParams.get("projectId") ?? undefined));
      if (method === "POST") return json(await store.createEnvironment(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getEnvironment(db, id), "environment");
      if (method === "PATCH") return notNull(await store.updateEnvironment(db, id, (await readJson(req)) as never), "environment");
      if (method === "DELETE") return json({ deleted: await store.deleteEnvironment(db, id) });
    }
  }

  // ── auth presets (get/delete keyed on name) ──
  if (resource === "auth-presets") {
    if (!id) {
      if (method === "GET") return json(await store.listAuthPresets(db));
      if (method === "POST") return json(await store.createAuthPreset(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getAuthPreset(db, id), "auth preset");
      if (method === "DELETE") return json({ deleted: await store.deleteAuthPreset(db, id) });
    }
  }

  // ── schedules ──
  if (resource === "schedules") {
    if (!id) {
      if (method === "GET")
        return json(
          await store.listSchedules(db, {
            projectId: searchParams.get("projectId") ?? undefined,
            enabled: boolParam(searchParams.get("enabled")),
          }),
        );
      if (method === "POST") return json(await store.createSchedule(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getSchedule(db, id), "schedule");
      if (method === "PUT" || method === "PATCH")
        return notNull(await store.updateSchedule(db, id, (await readJson(req)) as never), "schedule");
      if (method === "DELETE") return json({ deleted: await store.deleteSchedule(db, id) });
    }
  }

  // ── flows ──
  if (resource === "flows") {
    if (!id) {
      if (method === "GET") return json(await store.listFlows(db, searchParams.get("projectId") ?? undefined));
      if (method === "POST") return json(await store.createFlow(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getFlow(db, id), "flow");
      if (method === "DELETE") return json({ deleted: await store.deleteFlow(db, id) });
    }
  }

  // ── flow dependencies (id encoded as "scenarioId:dependsOn") ──
  if (resource === "flow-dependencies") {
    if (!id) {
      if (method === "GET")
        return json(
          await store.listFlowDependencies(db, {
            scenarioId: searchParams.get("scenarioId") ?? undefined,
            dependsOn: searchParams.get("dependsOn") ?? undefined,
          }),
        );
      if (method === "POST") return json(await store.createFlowDependency(db, (await readJson(req)) as never), 201);
    } else if (method === "DELETE") {
      const sep = id.indexOf(":");
      if (sep < 0) return err("flow-dependency id must be 'scenarioId:dependsOn'", 400);
      return json({ deleted: await store.deleteFlowDependency(db, id.slice(0, sep), id.slice(sep + 1)) });
    }
  }

  // ── sessions ──
  if (resource === "sessions") {
    if (!id) {
      if (method === "GET")
        return json(await store.listSessions(db, numParam(searchParams.get("limit")) ?? 50, numParam(searchParams.get("offset")) ?? 0));
      if (method === "POST") return json(await store.createSession(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getSession(db, id), "session");
      if (method === "DELETE") return json({ deleted: await store.deleteSession(db, id) });
    }
  }

  // ── api checks ──
  if (resource === "api-checks") {
    if (!id) {
      if (method === "GET")
        return json(
          await store.listApiChecks(db, {
            projectId: searchParams.get("projectId") ?? undefined,
            enabled: boolParam(searchParams.get("enabled")),
          }),
        );
      if (method === "POST") return json(await store.createApiCheck(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getApiCheck(db, id), "api check");
      if (method === "PUT" || method === "PATCH")
        return notNull(await store.updateApiCheck(db, id, (await readJson(req)) as never), "api check");
      if (method === "DELETE") return json({ deleted: await store.deleteApiCheck(db, id) });
    }
  }

  // ── api check results ──
  if (resource === "api-check-results") {
    if (!id) {
      if (method === "GET") {
        const checkId = searchParams.get("checkId");
        if (!checkId) return err("checkId query param is required", 400);
        return json(await store.listApiCheckResults(db, checkId));
      }
      if (method === "POST") return json(await store.createApiCheckResult(db, (await readJson(req)) as never), 201);
    }
  }

  // ── screenshots ──
  if (resource === "screenshots") {
    if (!id) {
      if (method === "GET") {
        const resultId = searchParams.get("resultId");
        if (!resultId) return err("resultId query param is required", 400);
        return json(await store.listScreenshots(db, resultId));
      }
      if (method === "POST") return json(await store.createScreenshot(db, (await readJson(req)) as never), 201);
    }
  }

  // ── step results ──
  if (resource === "step-results") {
    if (!id) {
      if (method === "GET") {
        const resultId = searchParams.get("resultId");
        if (!resultId) return err("resultId query param is required", 400);
        return json(await store.listStepResults(db, resultId));
      }
      if (method === "POST") return json(await store.createStepResult(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getStepResult(db, id), "step result");
      if (method === "PUT" || method === "PATCH")
        return notNull(await store.updateStepResult(db, id, (await readJson(req)) as never), "step result");
    }
  }

  // ── testing workflows ──
  if (resource === "workflows") {
    if (!id) {
      if (method === "GET")
        return json(
          await store.listTestingWorkflows(db, {
            projectId: searchParams.get("projectId") ?? undefined,
            enabled: boolParam(searchParams.get("enabled")),
          }),
        );
      if (method === "POST") return json(await store.createTestingWorkflow(db, (await readJson(req)) as never), 201);
    } else {
      if (method === "GET") return notNull(await store.getTestingWorkflow(db, id), "workflow");
      if (method === "PUT" || method === "PATCH")
        return notNull(await store.updateTestingWorkflow(db, id, (await readJson(req)) as never), "workflow");
      if (method === "DELETE") return json({ deleted: await store.deleteTestingWorkflow(db, id) });
    }
  }

  // ── golden answers ──
  if (resource === "golden-answers") {
    if (!id) {
      if (method === "GET")
        return json(
          await store.listGoldenAnswers(db, {
            projectId: searchParams.get("projectId") ?? undefined,
            enabled: boolParam(searchParams.get("enabled")),
          }),
        );
      if (method === "POST") return json(await store.createGoldenAnswer(db, (await readJson(req)) as never), 201);
    } else if (method === "GET") {
      return notNull(await store.getGoldenAnswer(db, id), "golden answer");
    }
  }

  // ── golden check results ──
  if (resource === "golden-check-results") {
    if (!id) {
      if (method === "GET") {
        const goldenId = searchParams.get("goldenId");
        if (!goldenId) return err("goldenId query param is required", 400);
        return json(await store.listGoldenCheckResults(db, goldenId));
      }
      if (method === "POST") return json(await store.createGoldenCheckResult(db, (await readJson(req)) as never), 201);
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
function boolParam(v: string | null): boolean | undefined {
  if (v === null || v === "") return undefined;
  return v === "true" || v === "1";
}
