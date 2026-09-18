/**
 * Versioned `/v1` HTTP API for `instructions-serve` (A1 pure-remote).
 *
 * Every handler goes through the vendored storage kit client (`getCloudClient`)
 * which reads/writes the shared RDS directly. Auth is enforced by the contracts
 * API-key verifier: reads require `instructions:read`, writes require
 * `instructions:write` (an `instructions:*` key satisfies both). This is a real
 * wrapper over the configs/profiles store — there are NO stubs; unknown routes
 * 404 and unimplemented operations throw a clear error.
 */
import type { ApiKeyPrincipal } from "@hasna/contracts/auth";
import { ConfigNotFoundError, ConfigVersionConflictError, InvalidExpectedVersionError, validateExpectedConfigVersion, ProfileNotFoundError } from "../types/index.js";
import { getCloudClient, ensureCloudSchema } from "./cloud.js";
import * as store from "../storage/cloud-store.js";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
export const MAX_SEARCH_QUERY_CHARS = 512;
export const MAX_IDEMPOTENCY_KEY_CHARS = 255;

export class HttpInputError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly code: "REQUEST_BODY_TOO_LARGE" | "SEARCH_QUERY_TOO_LONG" | "INVALID_IDEMPOTENCY_KEY",
    message: string,
  ) {
    super(message);
    this.name = "HttpInputError";
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorResponse(status: number, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...(extra ?? {}) }, status);
}

export interface V1RequestContext {
  principal?: ApiKeyPrincipal;
}

function pagePayload<T>(alias: string, page: import("../types/index.js").BoundedReadPage<T>) {
  return {
    ...page,
    [alias]: page.items,
    count: page.items.length,
  };
}

function authenticatedPrincipalAuthority(principal: ApiKeyPrincipal | undefined): string {
  if (!principal) throw new Error("authenticated principal is unavailable");
  return [
    principal.app,
    `tenant:${principal.tid ?? "-"}`,
    `agent:${principal.agent ?? "-"}`,
    `kid:${principal.kid}`,
  ].join("|");
}

function readIdempotencyKey(req: Request): string | null {
  const raw = req.headers.get("idempotency-key");
  if (raw === null) return null;
  const key = raw.trim();
  if (key.length < 1 || key.length > MAX_IDEMPOTENCY_KEY_CHARS || /[^\x21-\x7e]/.test(key)) {
    throw new HttpInputError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      `Idempotency-Key must contain 1-${MAX_IDEMPOTENCY_KEY_CHARS} visible ASCII characters`,
    );
  }
  return key;
}

async function mutationResponse<T>(
  req: Request,
  client: Parameters<typeof store.executeIdempotentRequest>[0],
  context: V1RequestContext,
  operation: string,
  requestBody: unknown,
  status: number,
  perform: (client: Parameters<typeof store.executeIdempotentRequest>[0]) => Promise<T>,
): Promise<Response> {
  const key = readIdempotencyKey(req);
  if (!key) return json(await perform(client), status);
  const result = await store.executeIdempotentRequest(
    client,
    {
      principal: authenticatedPrincipalAuthority(context.principal),
      operation,
      key,
      body: requestBody,
    },
    async (transaction) => ({ status, body: await perform(transaction) }),
  );
  return json(result.body, result.status);
}

export async function readJson<T>(req: Request): Promise<T | null> {
  const declaredLength = req.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
    if (parsed > MAX_REQUEST_BODY_BYTES) {
      throw new HttpInputError(413, "REQUEST_BODY_TOO_LARGE", "request body exceeds the 1 MiB limit");
    }
  }
  if (!req.body) return {} as T;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        throw new HttpInputError(413, "REQUEST_BODY_TOO_LARGE", "request body exceeds the 1 MiB limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return {} as T;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

export function boundedSearchQuery(value: string | null): string | undefined {
  if (value === null || value === "") return undefined;
  if (value.length > MAX_SEARCH_QUERY_CHARS) {
    throw new HttpInputError(400, "SEARCH_QUERY_TOO_LONG", `search query exceeds ${MAX_SEARCH_QUERY_CHARS} characters`);
  }
  return value;
}

/**
 * Handle a `/v1/*` request. Authentication + read/write scope enforcement is
 * performed UPSTREAM by the contracts `honoApiKey` middleware (see
 * server/index.ts); by the time this runs the caller is an authorized principal.
 * Returns `null` when the path is not a `/v1` route so the caller can fall
 * through to other handlers.
 */
export async function handleV1Request(
  req: Request,
  url: URL,
  context: V1RequestContext = {},
): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/v1" && !path.startsWith("/v1/")) return null;

  const method = req.method.toUpperCase();

  // Schema is idempotently ensured on the first authenticated request.
  try {
    await ensureCloudSchema();
  } catch (e) {
    console.error("instructions /v1: database unavailable");
    return errorResponse(503, "Instructions database is unavailable", { code: "DATABASE_UNAVAILABLE" });
  }
  const client = getCloudClient();

  const segments = path.split("/").filter(Boolean); // ["v1", resource, id?, action?]
  const resource = segments[1];
  const id = segments[2] ? decodeURIComponent(segments[2]) : undefined;
  const action = segments[3];

  try {
    // ── /v1/configs ──
    if (resource === "configs") {
      if (!id) {
        if (method === "GET") {
          const search = boundedSearchQuery(url.searchParams.get("search"));
          const filter = {
            ...(url.searchParams.get("category") ? { category: url.searchParams.get("category") as never } : {}),
            ...(url.searchParams.get("agent") ? { agent: url.searchParams.get("agent") as never } : {}),
            ...(url.searchParams.get("kind") ? { kind: url.searchParams.get("kind") as never } : {}),
            ...(search ? { search } : {}),
            ...(url.searchParams.getAll("tag").length ? { tags: url.searchParams.getAll("tag") } : {}),
          };
          const options = {
            limit: url.searchParams.get("limit") ?? undefined,
            cursor: url.searchParams.get("cursor") ?? undefined,
          };
          const view = url.searchParams.get("view");
          if (view !== null && view !== "identity" && view !== "summary") {
            return errorResponse(400, "unsupported config view", { code: "INVALID_CONFIG_VIEW" });
          }
          if (view === "identity") {
            const page = await store.listConfigIdentitiesPage(client, filter, options);
            return json(pagePayload("configs", page));
          }
          if (view === "summary") {
            const page = await store.listConfigSummariesPage(client, filter, options);
            return json({ ...page, count: page.items.length });
          }
          const page = await store.listConfigsPage(client, filter, options);
          return json(pagePayload("configs", page));
        }
        if (method === "POST") {
          const body = await readJson<Parameters<typeof store.createConfig>[1]>(req);
          if (!body) return errorResponse(400, "invalid JSON body");
          return await mutationResponse(req, client, context, "POST /v1/configs", body, 201, async (transaction) => ({
            config: await store.createConfig(transaction, body),
          }));
        }
        return errorResponse(405, `method ${method} not allowed on /v1/configs`);
      }
      // /v1/configs/:id/snapshots  (and /snapshots/:version, /snapshots/prune)
      if (action === "snapshots") {
        const sub = segments[4] ? decodeURIComponent(segments[4]) : undefined;
        if (sub === "prune") {
          if (method !== "POST") return errorResponse(405, `method ${method} not allowed on /v1/configs/:id/snapshots/prune`);
          const body = await readJson<{ keep?: number }>(req);
          const pruned = await store.pruneSnapshots(client, id, body?.keep ?? 10);
          return json({ pruned });
        }
        if (sub !== undefined) {
          if (method !== "GET") return errorResponse(405, `method ${method} not allowed on /v1/configs/:id/snapshots/:version`);
          const snapshot = await store.getSnapshotByVersion(client, id, Number(sub));
          if (!snapshot) return errorResponse(404, `snapshot version not found: ${sub}`);
          return json({ snapshot });
        }
        if (method === "GET") {
          const page = await store.listSnapshotsPage(client, id, {
            limit: url.searchParams.get("limit") ?? undefined,
            cursor: url.searchParams.get("cursor") ?? undefined,
          });
          return json(pagePayload("snapshots", page));
        }
        if (method === "POST") {
          const body = await readJson<{ content?: string; version?: number }>(req);
          return await mutationResponse(
            req,
            client,
            context,
            "POST /v1/configs/:id/snapshots",
            { config_id: id, ...(body ?? {}) },
            201,
            async (transaction) => ({
              snapshot: body && typeof body.content === "string" && typeof body.version === "number"
                ? await store.createSnapshotContent(transaction, id, body.content, body.version)
                : await store.createSnapshot(transaction, id),
            }),
          );
        }
        return errorResponse(405, `method ${method} not allowed on /v1/configs/:id/snapshots`);
      }
      if (action === "conditional-update") {
        if (method !== "POST") return errorResponse(405, `method ${method} not allowed on /v1/configs/:id/conditional-update`);
        const body = await readJson<Parameters<typeof store.updateConfig>[2]>(req);
        if (!body) return errorResponse(400, "invalid JSON body");
        if (body.expected_version === undefined) throw new InvalidExpectedVersionError();
        validateExpectedConfigVersion(body.expected_version);
        const config = await store.updateConfig(client, id, body);
        return json({ config });
      }
      if (action) return errorResponse(404, `unknown config action: ${action}`);
      if (method === "GET") {
        const config = await store.getConfig(client, id);
        return json({ config });
      }
      if (method === "PATCH" || method === "PUT") {
        const body = await readJson<Parameters<typeof store.updateConfig>[2]>(req);
        if (!body) return errorResponse(400, "invalid JSON body");
        const config = await store.updateConfig(client, id, body);
        return json({ config });
      }
      if (method === "DELETE") {
        await store.deleteConfig(client, id);
        return json({ deleted: true, id });
      }
      return errorResponse(405, `method ${method} not allowed on /v1/configs/:id`);
    }

    // ── /v1/profiles ──
    if (resource === "profiles") {
      if (!id) {
        if (method === "GET") {
          const options = {
            limit: url.searchParams.get("limit") ?? undefined,
            cursor: url.searchParams.get("cursor") ?? undefined,
          };
          if (url.searchParams.get("view") === "identity") {
            const page = await store.listProfileIdentitiesPage(client, options);
            return json(pagePayload("profiles", page));
          }
          const page = await store.listProfilesPage(client, options);
          return json(pagePayload("profiles", page));
        }
        if (method === "POST") {
          const body = await readJson<Parameters<typeof store.createProfile>[1]>(req);
          if (!body) return errorResponse(400, "invalid JSON body");
          return await mutationResponse(req, client, context, "POST /v1/profiles", body, 201, async (transaction) => ({
            profile: await store.createProfile(transaction, body),
          }));
        }
        return errorResponse(405, `method ${method} not allowed on /v1/profiles`);
      }
      // /v1/profiles/resolve?hostname=&os=&arch=
      if (id === "resolve") {
        if (method !== "GET") return errorResponse(405, `method ${method} not allowed on /v1/profiles/resolve`);
        const resolution = await store.resolveProfileForMachineRead(
          client,
          {
            hostname: url.searchParams.get("hostname") ?? undefined,
            os: url.searchParams.get("os") ?? undefined,
            arch: url.searchParams.get("arch") ?? undefined,
          },
          { limit: url.searchParams.get("limit") ?? undefined },
        );
        return json(resolution);
      }
      // /v1/profiles/:id/configs  and  /v1/profiles/:id/configs/:configId
      if (action === "bindings") {
        if (method !== "GET") return errorResponse(405, `method ${method} not allowed on /v1/profiles/:id/bindings`);
        const page = await store.getProfileConfigBindingsPage(client, id, {
          limit: url.searchParams.get("limit") ?? undefined,
          cursor: url.searchParams.get("cursor") ?? undefined,
        });
        return json(pagePayload("bindings", page));
      }
      if (action === "configs") {
        const configId = segments[4] ? decodeURIComponent(segments[4]) : undefined;
        if (method === "POST" && !configId) {
          const body = await readJson<{ config_id?: string }>(req);
          if (!body?.config_id) return errorResponse(400, "config_id is required");
          return await mutationResponse(
            req,
            client,
            context,
            "POST /v1/profiles/:id/configs",
            { profile_id: id, config_id: body.config_id },
            200,
            async (transaction) => {
              await store.addConfigToProfile(transaction, id, body.config_id!);
              return { added: true };
            },
          );
        }
        if (method === "DELETE" && configId) {
          await store.removeConfigFromProfile(client, id, configId);
          return json({ removed: true });
        }
        if (method === "PUT" && configId) {
          const body = await readJson<{ binding?: Parameters<typeof store.setProfileConfigBinding>[3] }>(req);
          if (!body?.binding) return errorResponse(400, "binding is required");
          return await mutationResponse(
            req,
            client,
            context,
            "PUT /v1/profiles/:id/configs/:configId",
            { profile_id: id, config_id: configId, binding: body.binding },
            200,
            async (transaction) => ({
              binding: await store.setProfileConfigBinding(transaction, id, configId, body.binding!),
            }),
          );
        }
        return errorResponse(405, `method ${method} not allowed on /v1/profiles/:id/configs`);
      }
      if (action === "assets") {
        const assetKey = segments[4] ? decodeURIComponent(segments[4]) : undefined;
        if (method === "GET" && !assetKey) {
          const page = await store.getProfileAssetBindingsPage(client, id, {
            limit: url.searchParams.get("limit") ?? undefined,
            cursor: url.searchParams.get("cursor") ?? undefined,
          });
          return json(pagePayload("assets", page));
        }
        if (method === "POST" && !assetKey) {
          const body = await readJson<{
            source_config_id?: string;
            binding?: Parameters<typeof store.addAssetToProfile>[3];
          }>(req);
          if (!body?.source_config_id || !body.binding) return errorResponse(400, "source_config_id and binding are required");
          return await mutationResponse(
            req,
            client,
            context,
            "POST /v1/profiles/:id/assets",
            { profile_id: id, source_config_id: body.source_config_id, binding: body.binding },
            201,
            async (transaction) => ({
              asset: await store.addAssetToProfile(transaction, id, body.source_config_id!, body.binding!),
            }),
          );
        }
        if (method === "PUT" && assetKey) {
          const body = await readJson<{ binding?: Parameters<typeof store.setProfileAssetBinding>[3] }>(req);
          if (!body?.binding) return errorResponse(400, "binding is required");
          return await mutationResponse(
            req,
            client,
            context,
            "PUT /v1/profiles/:id/assets/:assetKey",
            { profile_id: id, asset_key: assetKey, binding: body.binding },
            200,
            async (transaction) => ({
              asset: await store.setProfileAssetBinding(transaction, id, assetKey, body.binding!),
            }),
          );
        }
        if (method === "DELETE" && assetKey) {
          await store.removeAssetFromProfile(client, id, assetKey);
          return json({ removed: true });
        }
        return errorResponse(405, `method ${method} not allowed on /v1/profiles/:id/assets`);
      }
      if (action) return errorResponse(404, `unknown profile action: ${action}`);
      if (method === "GET") {
        const profile = await store.getProfile(client, id);
        const configs = await store.getProfileConfigsPage(client, id, {
          limit: url.searchParams.get("limit") ?? undefined,
          cursor: url.searchParams.get("cursor") ?? undefined,
        });
        return json({ profile: { ...profile, configs: configs.items }, configs });
      }
      if (method === "PATCH" || method === "PUT") {
        const body = await readJson<Parameters<typeof store.updateProfile>[2]>(req);
        if (!body) return errorResponse(400, "invalid JSON body");
        const profile = await store.updateProfile(client, id, body);
        return json({ profile });
      }
      if (method === "DELETE") {
        await store.deleteProfile(client, id);
        return json({ deleted: true, id });
      }
      return errorResponse(405, `method ${method} not allowed on /v1/profiles/:id`);
    }

    // ── /v1/stats ──
    if (resource === "stats" && method === "GET") {
      return json(await store.getConfigStats(client));
    }

    // ── /v1/snapshots/:id ──
    if (resource === "snapshots") {
      if (!id) return errorResponse(404, "snapshot id required");
      if (method !== "GET") return errorResponse(405, `method ${method} not allowed on /v1/snapshots/:id`);
      const snapshot = await store.getSnapshotById(client, id);
      if (!snapshot) return errorResponse(404, `snapshot not found: ${id}`);
      return json({ snapshot });
    }

    // ── /v1/machines ──
    if (resource === "machines") {
      if (id === "applied") {
        if (method !== "POST") return errorResponse(405, `method ${method} not allowed on /v1/machines/applied`);
        const body = await readJson<{ hostname?: string }>(req);
        if (!body?.hostname) return errorResponse(400, "hostname is required");
        await store.updateMachineApplied(client, body.hostname);
        return json({ updated: true });
      }
      if (!id) {
        if (method === "GET") {
          const options = {
            limit: url.searchParams.get("limit") ?? undefined,
            cursor: url.searchParams.get("cursor") ?? undefined,
          };
          const page = url.searchParams.get("view") === "identity"
            ? await store.listMachineIdentitiesPage(client, options)
            : await store.listMachinesPage(client, options);
          return json(pagePayload("machines", page));
        }
        if (method === "POST") {
          const body = await readJson<{ hostname?: string; os?: string | null; arch?: string | null }>(req);
          if (!body?.hostname) return errorResponse(400, "hostname is required");
          return await mutationResponse(req, client, context, "POST /v1/machines", body, 201, async (transaction) => ({
            machine: await store.registerMachine(transaction, body.hostname!, body.os ?? null, body.arch ?? null),
          }));
        }
        return errorResponse(405, `method ${method} not allowed on /v1/machines`);
      }
      return errorResponse(404, `unknown machines route`);
    }

    // ── /v1/feedback ──
    if (resource === "feedback" && !id) {
      if (method !== "POST") return errorResponse(405, `method ${method} not allowed on /v1/feedback`);
      const body = await readJson<{ message?: string; email?: string; category?: string; version?: string }>(req);
      if (!body?.message) return errorResponse(400, "message is required");
      await store.insertFeedback(client, {
        message: body.message,
        email: body.email ?? null,
        category: body.category ?? null,
        version: body.version ?? null,
      });
      return json({ ok: true }, 201);
    }

    return errorResponse(404, `unknown /v1 resource: ${resource ?? "(root)"}`);
  } catch (e) {
    if (e instanceof HttpInputError) return errorResponse(e.status, e.message, { code: e.code });
    if (e instanceof InvalidExpectedVersionError) return errorResponse(400, e.message, { code: e.code });
    if (e instanceof ConfigVersionConflictError) {
      return errorResponse(409, e.message, { code: e.code, config_id: e.config_id, expected_version: e.expected_version });
    }
    if (e instanceof store.StoreValidationError) return errorResponse(400, e.message, { code: e.code });
    if (e instanceof store.IdempotencyConflictError) return errorResponse(409, e.message, { code: e.code });
    if (e instanceof ConfigNotFoundError || e instanceof ProfileNotFoundError) {
      return errorResponse(404, e.message);
    }
    console.error("instructions /v1: request failed");
    return errorResponse(500, "Instructions request failed", { code: "INTERNAL_ERROR" });
  }
}
