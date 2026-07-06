/**
 * Versioned `/v1` HTTP surface for the open-files self-hosted service.
 *
 * PURE REMOTE: every route reads/writes cloud Postgres through `pg-store`.
 * Guarded by @hasna/contracts stateless API-key auth (scope grammar
 * `files:<action>`) with DB-backed revocation. No route is a silent stub — a
 * missing signing secret or database URL surfaces as an explicit 5xx error.
 */
import { ApiKeyStore, verifyApiKey, type ApiKeyVerifier } from "@hasna/contracts/auth";
import { getCloudClient } from "./pg-store.js";
import * as store from "./pg-store.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
function err(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

function signingSecret(): string {
  const s = process.env.HASNA_FILES_API_SIGNING_KEY ?? process.env.HASNA_API_SIGNING_KEY;
  if (!s) throw new Error("HASNA_FILES_API_SIGNING_KEY (or HASNA_API_SIGNING_KEY) is not set — API-key auth cannot start.");
  return s;
}

export interface V1Handler {
  handle(req: Request, url: URL): Promise<Response | null>;
  /** Lazily-built api-key store (also used by /ready and the key issuer). */
  keyStore(): ApiKeyStore;
}

export function createV1Handler(): V1Handler {
  let verifier: ApiKeyVerifier | null = null;
  let keys: ApiKeyStore | null = null;

  function ensureKeys(client: TypedQueryClient): ApiKeyStore {
    if (!keys) keys = new ApiKeyStore(client);
    return keys;
  }
  function ensureVerifier(client: TypedQueryClient): ApiKeyVerifier {
    if (!verifier) {
      const ks = ensureKeys(client);
      verifier = verifyApiKey({
        app: "files",
        signingSecret: signingSecret(),
        isRevoked: (kid) => ks.isRevoked(kid),
        audit: (e) => { if (e.outcome === "deny") console.warn(`[auth] deny kid=${e.kid ?? "-"} reason=${e.reason} ${e.method} ${e.path}`); },
      });
    }
    return verifier;
  }

  return {
    keyStore() {
      return ensureKeys(getCloudClient());
    },
    async handle(req: Request, url: URL): Promise<Response | null> {
      const path = url.pathname;
      if (!path.startsWith("/v1/") && path !== "/v1") return null;

      let client: TypedQueryClient;
      try {
        client = getCloudClient();
      } catch (e) {
        return err(`storage unavailable: ${(e as Error).message}`, 503);
      }

      const method = req.method;
      const isRead = method === "GET" || method === "HEAD";
      const requiredScopes = [isRead ? "files:read" : "files:write"];

      // ── Authenticate ───────────────────────────────────────────────────
      let decision;
      try {
        decision = await ensureVerifier(client).authenticate(req.headers, { method, path, requiredScopes });
      } catch (e) {
        return err(`auth misconfigured: ${(e as Error).message}`, 500);
      }
      if (!decision.ok) {
        return err(decision.message, decision.status, { reason: decision.reason });
      }
      // best-effort last-used telemetry
      ensureKeys(client).touchLastUsed(decision.principal.kid).catch(() => {});

      const sub = path.slice(4); // strip "/v1/"
      const seg = sub.split("/").filter(Boolean);
      const body = async () => { try { return (await req.json()) as Record<string, unknown>; } catch { return {}; } };

      try {
        // ── /v1/sources ────────────────────────────────────────────────
        if (seg[0] === "sources") {
          if (seg.length === 1 && method === "GET") {
            return json(await store.listSources(client, url.searchParams.get("machine_id") ?? undefined));
          }
          if (seg.length === 1 && method === "POST") {
            const b = await body();
            return json(await store.createSource(client, {
              name: b.name as string | undefined,
              type: b.type as store.CreateSourceInput["type"],
              path: b.path as string | undefined,
              bucket: b.bucket as string | undefined,
              prefix: b.prefix as string | undefined,
              region: b.region as string | undefined,
              config: (b.config as Record<string, unknown>) ?? {},
              machine_id: b.machine_id as string | undefined,
            }), 201);
          }
          if (seg.length === 2 && method === "GET") {
            const s = await store.getSource(client, seg[1]!);
            return s ? json(s) : err("Source not found", 404);
          }
          if (seg.length === 2 && method === "DELETE") {
            return (await store.deleteSource(client, seg[1]!)) ? json({ ok: true }) : err("Source not found", 404);
          }
        }

        // ── /v1/files ──────────────────────────────────────────────────
        if (seg[0] === "files") {
          if (seg.length === 1 && method === "GET") {
            return json(await store.listFiles(client, {
              source_id: url.searchParams.get("source_id") ?? undefined,
              machine_id: url.searchParams.get("machine_id") ?? undefined,
              ext: url.searchParams.get("ext") ?? undefined,
              status: url.searchParams.get("status") ?? undefined,
              q: url.searchParams.get("q") ?? undefined,
              limit: Number(url.searchParams.get("limit") ?? 50),
              offset: Number(url.searchParams.get("offset") ?? 0),
            }));
          }
          if (seg.length === 2 && method === "GET") {
            const f = await store.getFile(client, seg[1]!);
            return f ? json(f) : err("File not found", 404);
          }
          if (seg.length === 3 && seg[2] === "tags" && method === "POST") {
            const b = await body();
            for (const t of (b.tags as string[]) ?? []) await store.tagFile(client, seg[1]!, t);
            return json({ ok: true });
          }
          if (seg.length === 3 && seg[2] === "tags" && method === "DELETE") {
            const b = await body();
            for (const t of (b.tags as string[]) ?? []) await store.untagFile(client, seg[1]!, t);
            return json({ ok: true });
          }
        }

        // ── /v1/tags ───────────────────────────────────────────────────
        if (seg[0] === "tags" && seg.length === 1 && method === "GET") return json(await store.listTags(client));

        // ── /v1/collections ────────────────────────────────────────────
        if (seg[0] === "collections") {
          if (seg.length === 1 && method === "GET") return json(await store.listCollections(client));
          if (seg.length === 1 && method === "POST") {
            const b = await body();
            if (!b.name) return err("name is required");
            return json(await store.createCollection(client, b.name as string, b.description as string | undefined), 201);
          }
          if (seg.length === 3 && seg[2] === "files" && method === "POST") {
            const b = await body();
            await store.addToCollection(client, seg[1]!, b.file_id as string);
            return json({ ok: true });
          }
          if (seg.length === 4 && seg[2] === "files" && method === "DELETE") {
            await store.removeFromCollection(client, seg[1]!, seg[3]!);
            return json({ ok: true });
          }
        }

        // ── /v1/projects ───────────────────────────────────────────────
        if (seg[0] === "projects") {
          if (seg.length === 1 && method === "GET") return json(await store.listProjects(client));
          if (seg.length === 1 && method === "POST") {
            const b = await body();
            if (!b.name) return err("name is required");
            return json(await store.createProject(client, b.name as string, b.description as string | undefined), 201);
          }
          if (seg.length === 3 && seg[2] === "files" && method === "POST") {
            const b = await body();
            await store.addToProject(client, seg[1]!, b.file_id as string);
            return json({ ok: true });
          }
          if (seg.length === 4 && seg[2] === "files" && method === "DELETE") {
            await store.removeFromProject(client, seg[1]!, seg[3]!);
            return json({ ok: true });
          }
        }

        // ── /v1/machines ───────────────────────────────────────────────
        if (seg[0] === "machines" && seg.length === 1 && method === "GET") return json(await store.listMachines(client));

        // ── /v1/stats ──────────────────────────────────────────────────
        if (seg[0] === "stats" && seg.length === 1 && method === "GET") return json(await store.stats(client));

        return err("Not found", 404);
      } catch (e) {
        return err((e as Error).message, 500);
      }
    },
  };
}
