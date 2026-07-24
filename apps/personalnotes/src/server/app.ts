import { AuthService } from "../lib/auth/service.js";
import { extractBearer } from "../lib/auth/tokens.js";
import type { BackendConfig } from "../lib/config.js";
import { resolveConfig } from "../lib/config.js";
import { AuthError, isAuthError } from "../lib/errors.js";
import type { AuthStorage } from "../lib/storage/contract.js";
import type { AuthContext } from "../lib/tenancy/types.js";
import { PACKAGE_VERSION } from "../lib/version.js";

export interface AppOptions {
  storage: AuthStorage;
  service?: AuthService;
  config?: BackendConfig;
}

export interface App {
  fetch: (req: Request) => Promise<Response>;
  service: AuthService;
}

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorResponse(err: unknown): Response {
  if (isAuthError(err)) {
    return json({ error: err.code, message: err.message }, err.status);
  }
  console.error("[personalnotes] unhandled error", err);
  return json({ error: "internal_error", message: "internal server error" }, 500);
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new AuthError("invalid_request", "request body must be a JSON object");
}

/**
 * Build the multi-tenancy backend's HTTP surface: public probes plus the
 * versioned `/v1/auth/*` control plane. Hand-rolled fetch router (Bun.serve
 * house pattern; no framework). API is the primary surface — CLI/SDK are clients.
 */
export function createApp(options: AppOptions): App {
  const config = options.config ?? resolveConfig();
  const service = options.service ?? new AuthService(options.storage, config);

  async function requireAuth(req: Request): Promise<AuthContext> {
    const token = extractBearer(req.headers);
    if (!token) throw new AuthError("unauthenticated", "missing bearer token");
    return service.authenticate(token);
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();
    const route = `${method} ${path}`;

    switch (route) {
      case "GET /health":
        return json({ status: "ok", service: "personalnotes", version: PACKAGE_VERSION });

      case "GET /version":
        return json({ version: PACKAGE_VERSION, service: "personalnotes" });

      case "GET /ready": {
        const result = await options.storage.migrate({ dryRun: true });
        const ready = result.pending.length === 0;
        return json({ status: ready ? "ready" : "pending_migrations", pending: result.pending }, ready ? 200 : 503);
      }

      case "POST /v1/auth/register": {
        const body = await readJson(req);
        const result = await service.register({
          email: body.email as string,
          password: body.password as string,
          displayName: body.displayName as string | undefined,
          tenantName: body.tenantName as string | undefined,
        });
        return json(result, 201);
      }

      case "POST /v1/auth/login": {
        const body = await readJson(req);
        const result = await service.login(body.email as string, body.password as string);
        return json(result, 200);
      }

      case "POST /v1/auth/logout": {
        const token = extractBearer(req.headers);
        if (token) await service.logout(token);
        return json({ ok: true });
      }

      case "GET /v1/auth/me": {
        const ctx = await requireAuth(req);
        return json({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          email: ctx.email,
          role: ctx.role,
          isSuperAdmin: ctx.isSuperAdmin,
          tokenKind: ctx.tokenKind,
        });
      }

      case "POST /v1/auth/tokens": {
        const ctx = await requireAuth(req);
        const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
        const result = await service.createApiToken(ctx, (body.label as string) ?? "api");
        return json(result, 201);
      }

      case "GET /v1/auth/tokens": {
        const ctx = await requireAuth(req);
        return json({ tokens: await service.listMyTokens(ctx) });
      }

      case "GET /v1/tenant/users": {
        const ctx = await requireAuth(req);
        const tenantId = url.searchParams.get("tenantId") ?? undefined;
        return json({ users: await service.listTenantUsers(ctx, tenantId) });
      }

      case "GET /v1/admin/tenants": {
        const ctx = await requireAuth(req);
        return json({ tenants: await service.listAllTenants(ctx) });
      }

      case "GET /v1/admin/users": {
        const ctx = await requireAuth(req);
        return json({ users: await service.listAllUsers(ctx) });
      }

      default:
        return json({ error: "not_found", message: `no route for ${route}` }, 404);
    }
  }

  return {
    service,
    fetch: async (req: Request) => {
      try {
        return await handle(req);
      } catch (err) {
        return errorResponse(err);
      }
    },
  };
}
