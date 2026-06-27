import { dashboardHtml } from "./dashboard.js";
import { UptimeService, type UptimeServiceOptions } from "./service.js";
import type { SchedulerHandle } from "./types.js";

export interface ServeOptions extends UptimeServiceOptions {
  host?: string;
  port?: number;
  check?: boolean;
  service?: UptimeService;
}

export function createApiHandler(service: UptimeService): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const url = new URL(request.url);
    try {
      validateLocalMutationRequest(request, url);
      if (request.method === "GET" && url.pathname === "/") {
        return html(dashboardHtml());
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "uptime" });
      }
      if (request.method === "GET" && url.pathname === "/api/summary") {
        return json(service.summary());
      }
      if (request.method === "GET" && url.pathname === "/api/monitors") {
        return json(service.listMonitors({ includeDisabled: url.searchParams.get("includeDisabled") === "true" }));
      }
      if (request.method === "POST" && url.pathname === "/api/monitors") {
        return json(service.createMonitor(await jsonBody(request)), 201);
      }
      if (request.method === "GET" && url.pathname === "/api/incidents") {
        const status = url.searchParams.get("status");
        return json(service.listIncidents({
          status: status === "open" || status === "closed" ? status : undefined,
          monitorId: url.searchParams.get("monitorId") ?? undefined,
          limit: numericParam(url, "limit", 50),
        }));
      }
      if (request.method === "GET" && url.pathname === "/api/results") {
        return json(service.listResults({
          monitorId: url.searchParams.get("monitorId") ?? undefined,
          limit: numericParam(url, "limit", 50),
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/check-all") {
        return json(await service.checkAll());
      }
      const monitorMatch = url.pathname.match(/^\/api\/monitors\/([^/]+)(?:\/(check))?$/);
      if (monitorMatch) {
        const id = decodeURIComponent(monitorMatch[1]);
        if (request.method === "GET" && !monitorMatch[2]) {
          const monitor = service.getMonitor(id);
          return monitor ? json(monitor) : json({ error: "not found" }, 404);
        }
        if (request.method === "PATCH" && !monitorMatch[2]) {
          return json(service.updateMonitor(id, await jsonBody(request)));
        }
        if (request.method === "DELETE" && !monitorMatch[2]) {
          return json({ deleted: service.deleteMonitor(id) });
        }
        if (request.method === "POST" && monitorMatch[2] === "check") {
          return json(await service.checkMonitor(id));
        }
      }
      return json({ error: "not found" }, 404);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        error instanceof ApiError ? error.status : 400,
      );
    }
  };
}

export function serveUptime(options: ServeOptions = {}): { server: ReturnType<typeof Bun.serve>; service: UptimeService; scheduler?: SchedulerHandle } {
  const service = options.service ?? new UptimeService(options);
  const scheduler = options.check ? service.startScheduler() : undefined;
  const server = Bun.serve({
    hostname: options.host ?? "127.0.0.1",
    port: options.port ?? 3899,
    fetch: createApiHandler(service),
  });
  return { server, service, scheduler };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function html(value: string): Response {
  return new Response(value, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function numericParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validateLocalMutationRequest(request: Request, url: URL): void {
  if (!["POST", "PATCH", "DELETE"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin && origin !== `${url.protocol}//${url.host}`) {
    throw new ApiError("cross-origin mutation rejected", 403);
  }
}

async function jsonBody(request: Request): Promise<any> {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    throw new ApiError("content-type must be application/json", 415);
  }
  return request.json();
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
