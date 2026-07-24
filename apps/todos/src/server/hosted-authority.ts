/** Internal Stage-A containment for every hosted Todos datastore surface. */

import {
  resolveTodosStorageRole,
  type TodosStorageEnv,
} from "../storage/config.js";

const FORGED_AUTHORITY_HEADERS = new Set([
  "x-tenant-id",
  "x-org-id",
  "x-organization-id",
  "x-project-id",
  "x-entity-id",
  "authority",
  "xauthority",
  "x-authority",
  "x-authority-id",
  "x-principal",
  "x-principal-id",
  "x-hasna-tenant-id",
  "x-hasna-org-id",
  "x-hasna-project-id",
  "x-hasna-entity-id",
  "x-hasna-authority",
  "x-hasna-principal",
  "x-todos-tenant-id",
  "x-todos-org-id",
  "x-todos-project-id",
  "x-todos-entity-id",
  "x-todos-authority",
  "x-todos-principal",
]);

const DEDICATED_AUTHORITY_FIELDS = new Set([
  "authority",
  "authorityid",
  "authorityclaim",
  "authorityclaims",
  "principal",
  "principalid",
  "principalclaim",
  "principalclaims",
]);

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function response(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status });
}

export function hostedUnavailableResponse(): Response {
  return response(
    {
      error: "hosted_authority_unavailable",
      code: "HOSTED_AUTHORITY_UNAVAILABLE",
      reason: "authority_resolver_unavailable",
    },
    503,
  );
}

function unreadableHostedRequestResponse(): Response {
  // Keep the public body identical to every ordinary Stage-A denial. Hostile
  // getters and malformed URL objects must not become an error-message oracle.
  return hostedUnavailableResponse();
}

function readRequestUrl(req: Request): string | null {
  try {
    const value = Reflect.get(req, "url");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function readRequestHeaders(req: Request): Headers | null {
  try {
    const value = Reflect.get(req, "headers");
    return value instanceof Headers ? value : null;
  } catch {
    return null;
  }
}

function rejectClaims(url: URL, headers: Headers): Response | null | "unreadable" {
  try {
    for (const name of headers.keys()) {
      if (FORGED_AUTHORITY_HEADERS.has(name.toLowerCase())) {
        return response({ error: "caller_authority_rejected", code: "CALLER_AUTHORITY_REJECTED", source: "header" }, 400);
      }
    }
  } catch {
    return "unreadable";
  }

  for (const name of url.searchParams.keys()) {
    if (DEDICATED_AUTHORITY_FIELDS.has(normalizedKey(name))) {
      return response({ error: "caller_authority_rejected", code: "CALLER_AUTHORITY_REJECTED", source: "query" }, 400);
    }
  }
  return null;
}

export async function rejectCallerAuthorityClaims(req: Request): Promise<Response | null> {
  const rawUrl = readRequestUrl(req);
  if (rawUrl === null) return unreadableHostedRequestResponse();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return unreadableHostedRequestResponse();
  }
  const headers = readRequestHeaders(req);
  if (!headers) return unreadableHostedRequestResponse();
  const claimFailure = rejectClaims(url, headers);
  if (claimFailure === "unreadable") return unreadableHostedRequestResponse();
  if (claimFailure) return claimFailure;

  // Stage A never consumes a hosted request body. Even a dedicated claim-like
  // field is inert because the request terminates at the constant 503 floor.
  // `tenant_id` is likewise inert data, never authority or access proof. Stage
  // A later Access/Orgs integration may interpret a modeled tenant selector
  // only after trusted principal and grant resolution; its authenticated
  // zero-grant outcome can be 403. Stage A has no trusted positive resolver and
  // must not derive authority from caller payloads or fabricate that 403 path.
  return null;
}

export async function containHostedDatastoreSurface(
  req: Request,
  env: TodosStorageEnv = process.env,
): Promise<Response | null> {
  // Resolve the real process role before touching either caller-owned env or
  // Request. Only a local process may consult a supplied environment.
  let role: ReturnType<typeof resolveTodosStorageRole>;
  try {
    const processRole = resolveTodosStorageRole(process.env);
    role = processRole.role === "local" && env !== process.env
      ? resolveTodosStorageRole(env)
      : processRole;
  } catch {
    return hostedUnavailableResponse();
  }

  const rawUrl = readRequestUrl(req);
  if (rawUrl === null) return unreadableHostedRequestResponse();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return unreadableHostedRequestResponse();
  }
  const path = url.pathname;
  const isApi = path === "/api" || path.startsWith("/api/");
  const isV1 = path === "/v1" || path.startsWith("/v1/");
  const isMcp = path === "/mcp" || path.startsWith("/mcp/");
  if (!isApi && !isV1 && !isMcp) return null;

  // The live containment OpenAPI document is an explicit metadata probe, not
  // a datastore call. No other /v1 request bypasses the floor.
  if (path === "/v1/openapi.json") {
    let method: unknown;
    try {
      method = Reflect.get(req, "method");
    } catch {
      return unreadableHostedRequestResponse();
    }
    if (method === "GET") return null;
  }

  // /v1 is a hosted-only contract in Stage A under every process role. Local
  // /api and /mcp retain their base behavior.
  if (role.role === "local" && !isV1) return null;

  const headers = readRequestHeaders(req);
  if (!headers) return unreadableHostedRequestResponse();
  const claimFailure = rejectClaims(url, headers);
  if (claimFailure === "unreadable") return unreadableHostedRequestResponse();
  return claimFailure ?? hostedUnavailableResponse();
}

export function hostedReadinessResponse(version: string, mode: "remote"): Response {
  return response(
    {
      status: "unavailable",
      version,
      mode,
      code: "HOSTED_AUTHORITY_UNAVAILABLE",
      reason: "authority_resolver_unavailable",
    },
    503,
  );
}
