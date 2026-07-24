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
import { generateCanonicalName } from "../lib/normalize.js";
import {
  completeEvidenceUpload,
  createEvidenceUploadIntent,
  linkEvidenceAsset,
  signEvidenceDownload,
  verifyEvidenceAsset,
} from "../lib/evidence.js";
import type { FileAssetStatus } from "../types/index.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";

const FILE_ASSET_STATUSES: readonly FileAssetStatus[] = [
  "pending_upload", "uploaded", "verified", "archived", "deleted",
];
function asAssetStatus(value: string | null | undefined): FileAssetStatus | undefined {
  return value && (FILE_ASSET_STATUSES as readonly string[]).includes(value) ? (value as FileAssetStatus) : undefined;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
function err(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

function activityQuery(url: URL): store.ActivityQuery {
  const p = url.searchParams;
  return {
    after: p.get("after") ?? undefined,
    before: p.get("before") ?? undefined,
    action: p.get("action") ?? undefined,
    limit: p.has("limit") ? Number(p.get("limit")) : undefined,
    offset: p.has("offset") ? Number(p.get("offset")) : undefined,
  };
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
      const q = (k: string) => url.searchParams.get(k) ?? undefined;
      const body = async () => { try { return (await req.json()) as Record<string, unknown>; } catch { return {}; } };

      try {
        // ── /v1/sources ────────────────────────────────────────────────
        if (seg[0] === "sources") {
          if (seg.length === 1 && method === "GET") {
            return json(await store.listSources(client, q("machine_id")));
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
          if (seg.length === 2 && method === "PATCH") {
            const b = await body();
            const s = await store.updateSource(client, seg[1]!, {
              name: b.name as string | undefined,
              enabled: b.enabled as boolean | undefined,
              config: b.config as Record<string, unknown> | undefined,
              path: b.path as string | undefined,
              bucket: b.bucket as string | undefined,
              prefix: b.prefix as string | undefined,
              region: b.region as string | undefined,
            });
            return s ? json(s) : err("Source not found", 404);
          }
          if (seg.length === 2 && method === "DELETE") {
            return (await store.deleteSource(client, seg[1]!)) ? json({ ok: true }) : err("Source not found", 404);
          }
          if (seg.length === 3 && seg[2] === "normalize" && method === "POST") {
            return json({ normalized: await store.normalizeSource(client, seg[1]!) });
          }
        }

        // ── /v1/files ──────────────────────────────────────────────────
        if (seg[0] === "files") {
          if (seg.length === 1 && method === "GET") {
            return json(await store.listFiles(client, {
              source_id: q("source_id"),
              machine_id: q("machine_id"),
              ext: q("ext"),
              status: q("status"),
              q: q("q"),
              limit: Number(url.searchParams.get("limit") ?? 50),
              offset: Number(url.searchParams.get("offset") ?? 0),
            }));
          }
          // Collection-level reads/actions (keywords take precedence over {id}).
          if (seg.length === 2 && method === "GET" && seg[1] === "recent") {
            return json(await store.recentFiles(client, q("agent_id"), Number(url.searchParams.get("limit") ?? 20)));
          }
          if (seg.length === 2 && method === "GET" && seg[1] === "duplicates") {
            return json(await store.findDuplicates(client, q("source_id")));
          }
          if (seg.length === 2 && method === "GET" && seg[1] === "conflicts") {
            return json(await store.listConflicts(client, q("source_id"), Number(url.searchParams.get("limit") ?? 50)));
          }
          if (seg.length === 2 && method === "GET" && seg[1] === "by-path") {
            const sourceId = q("source_id"); const filePath = q("path");
            if (!sourceId || !filePath) return err("source_id and path are required");
            const f = await store.getFileByPath(client, sourceId, filePath);
            return f ? json(f) : err("File not found", 404);
          }
          if (seg.length === 2 && method === "POST" && seg[1] === "purge") {
            const b = await body();
            return json({ purged: await store.purgeDeleted(client, b.source_id as string | undefined, b.older_than as string | undefined) });
          }
          if (seg.length === 2 && method === "GET") {
            const f = await store.getFile(client, seg[1]!);
            return f ? json(f) : err("File not found", 404);
          }
          if (seg.length === 2 && method === "PATCH") {
            const b = await body();
            if (typeof b.description !== "string") return err("description is required");
            const f = await store.annotateFile(client, seg[1]!, b.description);
            return f ? json(f) : err("File not found", 404);
          }
          if (seg.length === 2 && method === "DELETE") {
            return (await store.softDeleteFile(client, seg[1]!)) ? json({ ok: true }) : err("File not found", 404);
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
          if (seg.length === 3 && seg[2] === "move" && method === "POST") {
            const b = await body();
            if (!b.dest_path) return err("dest_path is required");
            return (await store.moveFile(client, seg[1]!, b.dest_path as string)) ? json({ ok: true }) : err("File not found", 404);
          }
          if (seg.length === 3 && seg[2] === "rename" && method === "POST") {
            const b = await body();
            if (!b.new_name) return err("new_name is required");
            const newName = b.new_name as string;
            const ext = (b.ext as string | undefined) ?? "";
            const canonical = generateCanonicalName(newName);
            const ok = await store.renameFile(client, seg[1]!, newName, ext, canonical);
            return ok ? json({ ok: true, canonical }) : err("File not found", 404);
          }
          if (seg.length === 3 && seg[2] === "restore" && method === "POST") {
            return (await store.restoreFile(client, seg[1]!)) ? json({ ok: true }) : err("File not found or not deleted", 404);
          }
          if (seg.length === 3 && seg[2] === "resolve-conflict" && method === "POST") {
            return (await store.resolveConflict(client, seg[1]!)) ? json({ ok: true }) : err("File not found", 404);
          }
          if (seg.length === 3 && seg[2] === "history" && method === "GET") {
            return json(await store.getFileHistory(client, seg[1]!, activityQuery(url)));
          }
        }

        // ── /v1/tags ───────────────────────────────────────────────────
        if (seg[0] === "tags") {
          if (seg.length === 1 && method === "GET") return json(await store.listTags(client));
          if (seg.length === 2 && method === "DELETE") {
            return (await store.deleteTag(client, seg[1]!)) ? json({ ok: true }) : err("Tag not found", 404);
          }
        }

        // ── /v1/collections ────────────────────────────────────────────
        if (seg[0] === "collections") {
          if (seg.length === 1 && method === "GET") return json(await store.listCollections(client));
          if (seg.length === 1 && method === "POST") {
            const b = await body();
            if (!b.name) return err("name is required");
            return json(await store.createCollection(client, b.name as string, b.description as string | undefined), 201);
          }
          if (seg.length === 2 && seg[1] === "get-or-create" && method === "POST") {
            const b = await body();
            if (!b.name) return err("name is required");
            return json(await store.getOrCreateCollection(client, b.name as string, b.description as string | undefined));
          }
          if (seg.length === 2 && method === "GET") {
            const c = await store.getCollection(client, seg[1]!);
            return c ? json(c) : err("Collection not found", 404);
          }
          if (seg.length === 2 && method === "PATCH") {
            const b = await body();
            const c = await store.updateCollection(client, seg[1]!, {
              name: b.name as string | undefined,
              description: b.description as string | undefined,
              parent_id: (b.parent_id === undefined ? undefined : (b.parent_id as string | null)),
              auto_rules: b.auto_rules as never,
              metadata: b.metadata as Record<string, unknown> | undefined,
            });
            return c ? json(c) : err("Collection not found", 404);
          }
          if (seg.length === 2 && method === "DELETE") {
            return (await store.deleteCollection(client, seg[1]!)) ? json({ ok: true }) : err("Collection not found", 404);
          }
          if (seg.length === 3 && seg[2] === "auto-populate" && method === "POST") {
            return json({ added: await store.autoPopulateCollection(client, seg[1]!) });
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
          if (seg.length === 2 && seg[1] === "get-or-create" && method === "POST") {
            const b = await body();
            if (!b.name) return err("name is required");
            return json(await store.getOrCreateProject(client, b.name as string, b.description as string | undefined));
          }
          if (seg.length === 2 && method === "GET") {
            const p = await store.getProject(client, seg[1]!);
            return p ? json(p) : err("Project not found", 404);
          }
          if (seg.length === 2 && method === "PATCH") {
            const b = await body();
            const p = await store.updateProject(client, seg[1]!, {
              name: b.name as string | undefined,
              description: b.description as string | undefined,
              status: b.status as string | undefined,
              metadata: b.metadata as Record<string, unknown> | undefined,
            });
            return p ? json(p) : err("Project not found", 404);
          }
          if (seg.length === 2 && method === "DELETE") {
            return (await store.deleteProject(client, seg[1]!)) ? json({ ok: true }) : err("Project not found", 404);
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
        if (seg[0] === "machines") {
          if (seg.length === 1 && method === "GET") return json(await store.listMachines(client));
          if (seg.length === 2 && seg[1] === "current" && method === "GET") return json(await store.currentMachine(client));
        }

        // ── /v1/agents ─────────────────────────────────────────────────
        if (seg[0] === "agents") {
          if (seg.length === 1 && method === "GET") return json(await store.listAgents(client));
          if (seg.length === 1 && method === "POST") {
            const b = await body();
            if (!b.name) return err("name is required");
            return json(await store.registerAgent(client, b.name as string, b.session_id as string | undefined), 201);
          }
          if (seg.length === 3 && seg[2] === "heartbeat" && method === "POST") {
            const a = await store.heartbeatAgent(client, seg[1]!);
            return a ? json(a) : err("Agent not found", 404);
          }
          if (seg.length === 3 && seg[2] === "focus" && method === "POST") {
            const b = await body();
            const a = await store.setAgentFocus(client, seg[1]!, (b.project_id as string | null) ?? undefined);
            return a ? json(a) : err("Agent not found", 404);
          }
          if (seg.length === 3 && seg[2] === "activity" && method === "GET") {
            return json(await store.getAgentActivity(client, seg[1]!, activityQuery(url)));
          }
          if (seg.length === 2 && method === "GET") {
            const a = await store.getAgent(client, seg[1]!);
            return a ? json(a) : err("Agent not found", 404);
          }
        }

        // ── /v1/sessions ───────────────────────────────────────────────
        if (seg[0] === "sessions" && seg.length === 3 && seg[2] === "activity" && method === "GET") {
          return json(await store.getSessionActivity(client, seg[1]!, activityQuery(url)));
        }

        // ── /v1/activity ───────────────────────────────────────────────
        if (seg[0] === "activity" && seg.length === 1 && method === "POST") {
          const b = await body();
          if (!b.agent_id || !b.action) return err("agent_id and action are required");
          return json(await store.logActivity(client, {
            agent_id: b.agent_id as string,
            action: b.action as store.LogActivityInput["action"],
            file_id: b.file_id as string | undefined,
            source_id: b.source_id as string | undefined,
            session_id: b.session_id as string | undefined,
            metadata: (b.metadata as Record<string, unknown>) ?? {},
          }), 201);
        }

        // ── /v1/feedback ───────────────────────────────────────────────
        if (seg[0] === "feedback" && seg.length === 1 && method === "POST") {
          const b = await body();
          if (!b.message) return err("message is required");
          await store.recordFeedback(client, {
            message: b.message as string,
            email: b.email as string | undefined,
            category: b.category as string | undefined,
            version: (b.version as string | undefined) ?? "unknown",
          });
          return json({ ok: true });
        }

        // ── /v1/stats ──────────────────────────────────────────────────
        if (seg[0] === "stats" && seg.length === 1 && method === "GET") return json(await store.stats(client));

        // ── /v1/evidence (shared cross-app vault) ──────────────────────
        // Storage (S3 bucket/region/creds) is SERVER-owned: the service uses its
        // own configured storage and never honors client overrides, so a thin
        // client can never redirect the vault. Metadata lives in cloud Postgres.
        if (seg[0] === "evidence") {
          const evDb = store.evidenceDbFor(client);
          const serverStorage = {}; // env-configured server defaults only

          if (seg[1] === "upload-intents" && seg.length === 2 && method === "POST") {
            const b = await body();
            const result = await createEvidenceUploadIntent({
              org_id: b.org_id as string,
              company_id: b.company_id as string | undefined,
              app: b.app as string,
              kind: b.kind as string,
              original_name: b.original_name as string,
              content_type: b.content_type as string | undefined,
              size: Number(b.size),
              checksum: b.checksum as string,
              classification: b.classification as string | undefined,
              retention_until: b.retention_until as string | undefined,
              retention_policy: b.retention_policy as string | undefined,
              storage_class: b.storage_class as string | undefined,
              legal_hold: b.legal_hold as boolean | undefined,
              immutable: b.immutable as boolean | undefined,
              metadata: b.metadata as Record<string, unknown> | undefined,
              expires_in_seconds: b.expires_in_seconds as number | undefined,
            }, serverStorage, evDb);
            return json(result, 201);
          }
          if (seg[1] === "upload-intents" && seg.length === 4 && seg[3] === "complete" && method === "POST") {
            return json(await completeEvidenceUpload(seg[2]!, serverStorage, evDb));
          }
          if (seg[1] === "assets" && seg.length === 2 && method === "GET") {
            return json(await store.evListFileAssets(client, {
              org_id: q("org_id"),
              company_id: q("company_id"),
              app: q("app"),
              kind: q("kind"),
              status: asAssetStatus(q("status")),
              checksum: q("checksum"),
              limit: url.searchParams.has("limit") ? Number(q("limit")) : undefined,
              offset: url.searchParams.has("offset") ? Number(q("offset")) : undefined,
            }));
          }
          if (seg[1] === "assets" && seg.length === 3 && method === "GET") {
            const asset = await store.evGetFileAsset(client, seg[2]!);
            return asset ? json(asset) : err("Evidence asset not found", 404);
          }
          if (seg[1] === "assets" && seg.length === 4 && seg[3] === "links" && method === "POST") {
            const b = await body();
            return json(await linkEvidenceAsset({
              asset_id: seg[2]!,
              org_id: b.org_id as string,
              company_id: b.company_id as string | undefined,
              app: b.app as string,
              source_type: b.source_type as string,
              source_id: b.source_id as string,
              kind: b.kind as string,
              metadata: b.metadata as Record<string, unknown> | undefined,
            }, evDb), 201);
          }
          if (seg[1] === "assets" && seg.length === 4 && seg[3] === "links" && method === "GET") {
            return json(await store.evListFileLinks(client, seg[2]!));
          }
          if (seg[1] === "assets" && seg.length === 4 && seg[3] === "sign-download" && method === "POST") {
            const b = await body();
            return json(await signEvidenceDownload({
              asset_id: seg[2]!,
              actor_id: b.actor_id as string | undefined,
              purpose: b.purpose as string | undefined,
              expires_in_seconds: b.expires_in_seconds as number | undefined,
            }, serverStorage, evDb));
          }
          if (seg[1] === "assets" && seg.length === 4 && seg[3] === "verify" && method === "POST") {
            return json(await verifyEvidenceAsset(seg[2]!, serverStorage, evDb));
          }
          if (seg[1] === "assets" && seg.length === 4 && seg[3] === "access-events" && method === "GET") {
            return json(await store.evListAccessEvents(client, seg[2]!, url.searchParams.has("limit") ? Number(q("limit")) : 50));
          }
        }

        return err("Not found", 404);
      } catch (e) {
        return err((e as Error).message, 500);
      }
    },
  };
}
