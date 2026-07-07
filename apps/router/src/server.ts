import { loadRouterConfig } from "./config";
import { routePrompt } from "./router";
import type { RoutePromptRequest, RouterConfig, RouterRuntimeOptions } from "./types";
import { routerVersion } from "./version";

export type RouterServerOptions = {
  config: RouterConfig;
  runtime?: RouterRuntimeOptions;
  host?: string;
  port?: number;
};

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
  };
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: corsHeaders() });
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return JSON.parse(await request.text()) as unknown;
  } catch {
    return undefined;
  }
}

function requestFromBody(body: unknown): RoutePromptRequest | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const request = "request" in body && typeof body.request === "object" ? body.request : body;
  if (!request || typeof request !== "object" || Array.isArray(request)) return undefined;
  return request as RoutePromptRequest;
}

export function createRouterHandler(options: RouterServerOptions): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", version: routerVersion });
    }
    if (request.method === "POST" && url.pathname === "/v1/route") {
      const body = await parseJson(request);
      const routeRequest = requestFromBody(body);
      if (!routeRequest) return json({ error: { message: "Request body must be a route request object." } }, 400);
      const decision = routePrompt({
        config: options.config,
        request: routeRequest,
        ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
      });
      return json(decision, decision.status === "selected" ? 200 : 400);
    }
    return json({ error: { message: "Endpoint not found." } }, 404);
  };
}

export function startRouterServer(options: RouterServerOptions): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: options.host ?? "127.0.0.1",
    port: options.port ?? 8797,
    fetch: createRouterHandler(options),
  });
}

export async function startRouterServerFromConfig(path: string, options: Omit<RouterServerOptions, "config"> = {}) {
  return startRouterServer({ ...options, config: await loadRouterConfig(path) });
}
