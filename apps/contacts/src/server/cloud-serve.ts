/**
 * Production-only Contacts HTTP surface.
 *
 * This module is intentionally isolated from the local dashboard/server and
 * MCP entrypoints. Its import graph is pure remote: probes, OpenAPI, and the
 * authenticated `/v1` Postgres API. Do not import `serve.ts`, `security.ts`,
 * `src/db` local storage, or the MCP SDK here.
 */
import { getPackageVersion } from "../lib/package-version.js";
import {
  isCloudModeEnabled,
  pingCloud,
  resolveSigningSecret,
} from "./cloud.js";
import { buildV1OpenApiDocument } from "./openapi.js";
import { handleV1Request } from "./v1.js";

const CLOUD_MODE = "cloud" as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "null");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");
  return new Response(response.body, { status: response.status, headers });
}

export function createCloudRequestHandler(): (req: Request) => Promise<Response> {
  return async function fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    let response: Response;
    if (url.pathname === "/health" && req.method === "GET") {
      response = json({ status: "ok", name: "contacts", version: getPackageVersion(), mode: CLOUD_MODE });
    } else if (url.pathname === "/version" && req.method === "GET") {
      response = json({ status: "ok", version: getPackageVersion(), mode: CLOUD_MODE });
    } else if (url.pathname === "/ready" && req.method === "GET") {
      // This entrypoint is always cloud, even when configuration is incomplete.
      // Missing remote configuration therefore fails closed rather than
      // exposing the local server or reporting local readiness.
      const hasSecret = Boolean(resolveSigningSecret());
      try {
        if (!isCloudModeEnabled()) {
          throw new Error("the PostgreSQL server backend is not configured");
        }
        const dbOk = await pingCloud();
        const ok = dbOk && hasSecret;
        response = json(
          {
            status: ok ? "ready" : "not_ready",
            version: getPackageVersion(),
            mode: CLOUD_MODE,
            db: dbOk,
            signing_secret: hasSecret,
          },
          ok ? 200 : 503,
        );
      } catch (error) {
        response = json(
          {
            status: "not_ready",
            mode: CLOUD_MODE,
            version: getPackageVersion(),
            error: (error as Error).message,
          },
          503,
        );
      }
    } else if (
      (url.pathname === "/openapi.json" || url.pathname === "/v1/openapi.json") &&
      req.method === "GET"
    ) {
      response = json(buildV1OpenApiDocument());
    } else {
      // `/v1` owns API-key authentication. The standalone `contacts-mcp`
      // process remains the MCP surface; the production cloud image does not
      // bundle or expose the local/MCP import graph.
      response = (await handleV1Request(req, url)) ?? json({ error: "Not found" }, 404);
    }

    return withCors(response);
  };
}

export function startCloudServer(port: number, hostname: string): void {
  Bun.serve({ hostname, port, fetch: createCloudRequestHandler() });
  console.log(`Contacts cloud server running at http://${hostname}:${port}`);
}
