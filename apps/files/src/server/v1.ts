/**
 * Versioned `/v1` HTTP surface for the files service.
 *
 * Every route reads/writes Postgres through `pg-store` when the service is
 * configured with a database URL. Guarded by @hasna/contracts stateless API-key
 * auth (scope grammar `files:<action>`) with DB-backed revocation. No route is
 * a silent stub — a missing signing secret or database URL surfaces as an
 * explicit 5xx error.
 */
import { ApiKeyStore, verifyApiKey, type ApiKeyVerifier } from "@hasna/contracts/auth";
import { getCloudClient } from "./pg-store.js";
import * as store from "./pg-store.js";
import { generateCanonicalName } from "../lib/normalize.js";
import {
  completeEvidenceUpload,
  createEvidenceUploadIntent,
  linkEvidenceAsset,
  redactEvidenceUploadCredentials,
  signEvidenceDownload,
  verifyEvidenceAsset,
} from "../lib/evidence.js";
import type { FileAssetStatus } from "../types/index.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import {
  extractRemoteFileText,
  normalizeContentReadLimit,
  readRemoteObject,
  signRemoteFileDownload,
  type RemoteFileLocator,
  type RemoteObjectReader,
} from "./file-content.js";

const FILE_ASSET_STATUSES: readonly FileAssetStatus[] = [
  "pending_upload", "uploaded", "verified", "archived", "deleted",
];
function asAssetStatus(value: string | null | undefined): FileAssetStatus | undefined {
  return value && (FILE_ASSET_STATUSES as readonly string[]).includes(value) ? (value as FileAssetStatus) : undefined;
}

/** Upper bound for a single hosted document ingestion (2 GiB). */
const MAX_INGEST_BYTES = 2 * 1024 * 1024 * 1024;

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
  const s =
    process.env.HASNA_FILES_API_SIGNING_KEY?.trim() || process.env.HASNA_API_SIGNING_KEY?.trim();
  if (!s) throw new Error("HASNA_FILES_API_SIGNING_KEY (or HASNA_API_SIGNING_KEY) is not set — API-key auth cannot start.");
  return s;
}

export interface V1Handler {
  handle(req: Request, url: URL): Promise<Response | null>;
  /** Lazily-built api-key store (also used by /ready and the key issuer). */
  keyStore(): ApiKeyStore;
}

export interface V1HandlerOptions {
  getClient?: () => TypedQueryClient;
  verifier?: ApiKeyVerifier;
  signingSecret?: string;
  readObject?: RemoteObjectReader;
  /** Server-owned object verification for the file-upload complete route.
   *  Injected so the route is testable without live S3; defaults to a HEAD. */
  verifyUploadedObject?: store.RemoteUploadVerifier;
}

export function createV1Handler(options: V1HandlerOptions = {}): V1Handler {
  let verifier: ApiKeyVerifier | null = null;
  let keys: ApiKeyStore | null = null;
  const resolveClient = options.getClient ?? getCloudClient;
  const objectReader = options.readObject ?? readRemoteObject;

  function ensureKeys(client: TypedQueryClient): ApiKeyStore {
    if (!keys) keys = new ApiKeyStore(client);
    return keys;
  }
  function ensureVerifier(client: TypedQueryClient): ApiKeyVerifier {
    if (options.verifier) return options.verifier;
    if (!verifier) {
      const ks = ensureKeys(client);
      verifier = verifyApiKey({
        app: "files",
        signingSecret: options.signingSecret ?? signingSecret(),
        keyStatus: (kid) => ks.keyStatus(kid),
        audit: (e) => { if (e.outcome === "deny") console.warn(`[auth] deny kid=${e.kid ?? "-"} reason=${e.reason} ${e.method} ${e.path}`); },
      });
    }
    return verifier;
  }

  return {
    keyStore() {
      return ensureKeys(resolveClient());
    },
    async handle(req: Request, url: URL): Promise<Response | null> {
      const path = url.pathname;
      if (!path.startsWith("/v1/") && path !== "/v1") return null;

      let client: TypedQueryClient;
      try {
        client = resolveClient();
      } catch (e) {
        return err(`storage unavailable: ${(e as Error).message}`, 503);
      }

      const method = req.method;
      const isRead = method === "GET" || method === "HEAD";
      const isContentRead = /^\/v1\/files\/[^/]+\/(?:content|extract-text)$/.test(path);
      const requiredScopes = [isRead || isContentRead ? "files:read" : "files:write"];

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
            const sortRaw = q("sort");
            const sort = sortRaw === "name" || sortRaw === "size" || sortRaw === "date" ? sortRaw : undefined;
            const sortDirRaw = q("sort_dir");
            const sortDir = sortDirRaw === "asc" || sortDirRaw === "desc" ? sortDirRaw : undefined;
            const scopeRaw = q("search_scope");
            const searchScope = scopeRaw === "content" || scopeRaw === "metadata" ? scopeRaw : "all";
            const minSizeRaw = url.searchParams.get("min_size");
            const maxSizeRaw = url.searchParams.get("max_size");
            return json(await store.listFiles(client, {
              source_id: q("source_id"),
              machine_id: q("machine_id"),
              project_id: q("project_id"),
              collection_id: q("collection_id"),
              tag: q("tag"),
              ext: q("ext"),
              status: q("status"),
              q: q("q"),
              search_scope: searchScope,
              after: q("after"),
              before: q("before"),
              min_size: minSizeRaw === null || minSizeRaw === "" ? undefined : Number(minSizeRaw),
              max_size: maxSizeRaw === null || maxSizeRaw === "" ? undefined : Number(maxSizeRaw),
              sort,
              sort_dir: sortDir,
              limit: Number(url.searchParams.get("limit") ?? 50),
              offset: Number(url.searchParams.get("offset") ?? 0),
            }));
          }
          // Hosted ingestion: stage a file record + server-owned S3 object and
          // sign a PUT URL the client PUTs bytes to (same server-owned storage
          // doctrine as the evidence vault, on the regular files data plane).
          // Bug de9aeeed: this route did not exist, so a document could not be
          // added to the service in cloud mode as a tagged project resource.
          if (seg.length === 1 && method === "POST") {
            const b = await body();
            const tenantId = await store.getApiKeyTenant(client, decision.principal.kid);
            if (!tenantId) return err("File tenant binding not found", 403);
            const name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : undefined;
            if (!name) return err("name is required", 400);
            if (name.length > 512) return err("name is too long (max 512 bytes)", 400);
            const size = typeof b.size === "number" && Number.isInteger(b.size) && b.size > 0 && b.size <= MAX_INGEST_BYTES ? b.size : undefined;
            if (!size) return err(`size must be a positive integer <= ${MAX_INGEST_BYTES}`, 400);
            const checksum = typeof b.checksum === "string" && /^[a-f0-9]{64}$/i.test(b.checksum.trim()) ? b.checksum.trim().toLowerCase() : undefined;
            if (b.checksum !== undefined && !checksum) return err("checksum must be a sha256 hex digest", 400);
            const mime = typeof b.mime === "string" && b.mime.trim() ? b.mime.trim() : undefined;
            try {
              const created = await store.createFileUploadIntent(client, {
                tenantId, name, size, mime, checksum,
                checksumAlgorithm: checksum ? "sha256" : undefined,
              });
              return json({
                file_id: created.file.id,
                upload_url: created.upload_url,
                method: created.method,
                required_headers: created.required_headers,
              }, 201);
            } catch (e) {
              return err((e as Error).message, 400);
            }
          }
          // Hosted ingestion completion: verify the stored object, then apply
          // tags + the project link so the document is a tagged project resource.
          if (seg.length === 3 && seg[2] === "complete" && method === "POST") {
            const tenantId = await store.getApiKeyTenant(client, decision.principal.kid);
            if (!tenantId) return err("File tenant binding not found", 403);
            const b = await body();
            const tags = Array.isArray(b.tags)
              ? b.tags.filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => value.trim())
              : undefined;
            const projectId = typeof b.project_id === "string" && b.project_id.trim() ? b.project_id.trim() : undefined;
            try {
              const file = await store.completeFileUpload(
                client, seg[1]!, tenantId,
                { tags, projectId },
                options.verifyUploadedObject ?? store.s3HeadUploadVerifier,
              );
              if (!file) return err("File not found", 404);
              return json({ file });
            } catch (e) {
              return err((e as Error).message, 400);
            }
          }
          // Derived-content search documents (hosted mirror of the local
          // `file_search_documents` writer; keywords take precedence over {id}).
          if (seg.length === 3 && seg[2] === "search-documents" && method === "POST") {
            const b = await body();
            if (!b || typeof b !== "object" || typeof (b as Record<string, unknown>).kind !== "string" || typeof (b as Record<string, unknown>).source_ref !== "string") {
              return err("kind and source_ref are required");
            }
            const input = b as Record<string, unknown>;
            if (typeof input.searchable_text !== "string" || input.searchable_text.length === 0) {
              return err("searchable_text is required", 400);
            }
            const status = typeof input.status === "string" ? input.status : "ready";
            if (!["ready", "partial", "unsupported", "error", "stale"].includes(status)) {
              return err("invalid status", 400);
            }
            try {
              const doc = await store.upsertSearchDocument(client, {
                file_id: seg[1]!,
                revision_id: typeof input.revision_id === "string" ? input.revision_id : undefined,
                source_ref: input.source_ref as string,
                kind: input.kind as never,
                extractor: typeof input.extractor === "string" ? input.extractor : undefined,
                content_hash: typeof input.content_hash === "string" ? input.content_hash : undefined,
                searchable_text: input.searchable_text as string,
                metadata: input.metadata && typeof input.metadata === "object" ? input.metadata as Record<string, unknown> : undefined,
                status: status as never,
                private: typeof input.private === "boolean" ? input.private : undefined,
                replace_existing: typeof input.replace_existing === "boolean" ? input.replace_existing : undefined,
              });
              return json(doc, 201);
            } catch (error) {
              if (error instanceof Error && /File not found/.test(error.message)) return err("File not found", 404);
              throw error;
            }
          }
          // (GET list + DELETE for search documents are id-only, top-level —
          // see the /v1/search-documents block after this route group.)
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
          if (seg.length === 3 && seg[2] === "content" && method === "GET") {
            const locator = await authorizedFileLocator(client, decision.principal.kid, seg[1]!);
            if (!locator) return err("File not found", 404);
            try {
              const bound = normalizeContentReadLimit(url.searchParams.get("max_bytes"));
              const object = await objectReader(locator, { max_bytes: bound });
              if (!object) return err("File not found", 404);
              const headers = new Headers({
                "Content-Type": locator.mime || "application/octet-stream",
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
              });
              if (bound !== undefined && locator.size > bound) {
                // The body is capped at `bound` bytes while the object is larger;
                // tell the client so it can emit its truncation marker even when
                // the Range response is exactly `bound` bytes long.
                headers.set("x-files-truncated", "1");
                headers.set("x-files-size", String(locator.size));
              }
              return new Response(object.body, { status: 200, headers });
            } catch {
              return err("File content unavailable", 502);
            }
          }
          if (seg.length === 3 && seg[2] === "extract-text" && method === "POST") {
            const locator = await authorizedFileLocator(client, decision.principal.kid, seg[1]!);
            if (!locator) return err("File not found", 404);
            const b = await body();
            try {
              const result = await extractRemoteFileText(locator, objectReader, {
                max_bytes: typeof b.max_bytes === "number" ? b.max_bytes : undefined,
                max_segment_chars: typeof b.max_segment_chars === "number" ? b.max_segment_chars : undefined,
                redact_patterns: Array.isArray(b.redact_patterns)
                  ? b.redact_patterns.filter((value): value is string => typeof value === "string")
                  : undefined,
              });
              return result ? json(result) : err("File not found", 404);
            } catch (error) {
              if (error instanceof SyntaxError) return err("Invalid extraction options", 400);
              return err("File content unavailable", 502);
            }
          }
          if (seg.length === 3 && seg[2] === "sign-download" && method === "POST") {
            const locator = await authorizedFileLocator(client, decision.principal.kid, seg[1]!);
            if (!locator) return err("File not found", 404);
            const b = await body();
            const url = await signRemoteFileDownload(locator, {
              expires_in_seconds: typeof b.expires_in === "number" ? b.expires_in : undefined,
            });
            return json({ url });
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

        // ── /v1/search-documents ─────────────────────────────────────────
        if (seg[0] === "search-documents") {
          if (seg.length === 1 && method === "GET") {
            return json(await store.listSearchDocuments(client, {
              file_id: q("file_id"),
              kind: q("kind") as never,
              status: q("status") as never,
              limit: Number(url.searchParams.get("limit") ?? 50),
              offset: Number(url.searchParams.get("offset") ?? 0),
            }));
          }
          if (seg.length === 2 && method === "DELETE") {
            return (await store.deleteSearchDocument(client, seg[1]!)) ? json({ ok: true }) : err("Search document not found", 404);
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
          const tenantId = await store.getApiKeyTenant(client, decision.principal.kid);
          if (!tenantId) return err("Evidence tenant binding not found", 403);

          if (seg[1] === "upload-intents" && seg.length === 2 && method === "POST") {
            const b = await body();
            if (tenantMismatch(b.org_id, tenantId)) return err("org_id does not match authenticated tenant", 403);
            const result = await createEvidenceUploadIntent({
              org_id: tenantId,
              company_id: b.company_id as string | undefined,
              app: b.app as string,
              kind: b.kind as string,
              original_name: b.original_name as string,
              content_type: b.content_type as string | undefined,
              size: Number(b.size),
              checksum: b.checksum as string,
              checksum_algorithm: b.checksum_algorithm as "sha256" | undefined,
              classification: b.classification as string | undefined,
              version: b.version as number | undefined,
              provenance_type: b.provenance_type as string | undefined,
              provenance_id: b.provenance_id as string | undefined,
              provenance_ref: b.provenance_ref as string | undefined,
              external_references: Array.isArray(b.external_references)
                ? b.external_references.filter((value): value is string => typeof value === "string")
                : undefined,
              idempotency_key: b.idempotency_key as string | undefined,
              retention_until: b.retention_until as string | undefined,
              retention_policy: b.retention_policy as string | undefined,
              storage_class: b.storage_class as string | undefined,
              legal_hold: b.legal_hold as boolean | undefined,
              immutable: b.immutable as boolean | undefined,
              metadata: b.metadata as Record<string, unknown> | undefined,
              expires_in_seconds: b.expires_in_seconds as number | undefined,
            }, serverStorage, evDb);
            return json(b.include_upload_url === true ? result : redactEvidenceUploadCredentials(result), 201);
          }
          if (seg[1] === "upload-intents" && seg.length === 4 && seg[3] === "complete" && method === "POST") {
            const intent = await store.evGetUploadIntent(client, seg[2]!);
            const asset = intent ? await evidenceAssetForTenant(client, tenantId, intent.asset_id) : null;
            if (!intent || !asset) return err("Evidence upload intent not found", 404);
            return json(await completeEvidenceUpload(seg[2]!, serverStorage, evDb));
          }
          if (seg[1] === "assets" && seg.length === 2 && method === "GET") {
            if (tenantMismatch(q("org_id"), tenantId)) return err("org_id does not match authenticated tenant", 403);
            return json(await store.evListFileAssets(client, {
              org_id: tenantId,
              company_id: q("company_id"),
              app: q("app"),
              kind: q("kind"),
              status: asAssetStatus(q("status")),
              checksum: q("checksum"),
              provenance_type: q("provenance_type"),
              provenance_id: q("provenance_id"),
              provenance_ref: q("provenance_ref"),
              version: url.searchParams.has("version") ? Number(q("version")) : undefined,
              classification: q("classification"),
              retention_policy: q("retention_policy"),
              external_reference: q("external_reference"),
              idempotency_key: q("idempotency_key"),
              limit: url.searchParams.has("limit") ? Number(q("limit")) : undefined,
              offset: url.searchParams.has("offset") ? Number(q("offset")) : undefined,
            }));
          }
          if (seg[1] === "assets" && seg.length === 3 && method === "GET") {
            const asset = await evidenceAssetForTenant(client, tenantId, seg[2]!);
            return asset ? json(asset) : err("Evidence asset not found", 404);
          }
          if (seg[1] === "assets" && seg.length === 4 && seg[3] === "links" && method === "POST") {
            const b = await body();
            const asset = await evidenceAssetForTenant(client, tenantId, seg[2]!);
            if (!asset) return err("Evidence asset not found", 404);
            if (tenantMismatch(b.org_id, tenantId)) return err("org_id does not match authenticated tenant", 403);
            return json(await linkEvidenceAsset({
              asset_id: seg[2]!,
              org_id: tenantId,
              company_id: b.company_id as string | undefined,
              app: b.app as string,
              source_type: b.source_type as string,
              source_id: b.source_id as string,
              kind: b.kind as string,
              metadata: b.metadata as Record<string, unknown> | undefined,
            }, evDb), 201);
          }
          if (seg[1] === "assets" && seg.length === 4 && seg[3] === "links" && method === "GET") {
            if (!await evidenceAssetForTenant(client, tenantId, seg[2]!)) return err("Evidence asset not found", 404);
            return json(await store.evListFileLinks(client, seg[2]!));
          }
          if (seg[1] === "assets" && seg.length === 4 && seg[3] === "sign-download" && method === "POST") {
            if (!await evidenceAssetForTenant(client, tenantId, seg[2]!)) return err("Evidence asset not found", 404);
            const b = await body();
            return json(await signEvidenceDownload({
              asset_id: seg[2]!,
              actor_id: b.actor_id as string | undefined,
              purpose: b.purpose as string | undefined,
              expires_in_seconds: b.expires_in_seconds as number | undefined,
            }, serverStorage, evDb));
          }
          if (seg[1] === "assets" && seg.length === 4 && seg[3] === "verify" && method === "POST") {
            if (!await evidenceAssetForTenant(client, tenantId, seg[2]!)) return err("Evidence asset not found", 404);
            return json(await verifyEvidenceAsset(seg[2]!, serverStorage, evDb));
          }
          if (seg[1] === "assets" && seg.length === 4 && seg[3] === "access-events" && method === "GET") {
            if (!await evidenceAssetForTenant(client, tenantId, seg[2]!)) return err("Evidence asset not found", 404);
            return json(await store.evListAccessEvents(client, seg[2]!, url.searchParams.has("limit") ? Number(q("limit")) : 50));
          }
        }

        return err("Not found", 404);
      } catch (e) {
        // An unservable page is the caller's mistake, not the server's: answer
        // 400 with the numbers attached so a client can page without scraping
        // the prose. Anything else is still a 5xx.
        if (e instanceof store.PageLimitError) {
          return err(e.message, 400, { max_limit: e.max_limit, requested_limit: e.requested_limit });
        }
        if (e instanceof store.PageOffsetError) {
          return err(e.message, 400, { requested_offset: e.requested_offset });
        }
        return err((e as Error).message, 500);
      }
    },
  };
}

async function authorizedFileLocator(
  client: TypedQueryClient,
  kid: string,
  fileId: string,
): Promise<RemoteFileLocator | null> {
  const tenantId = await store.getApiKeyTenant(client, kid);
  if (!tenantId) return null;

  const locator = await store.getRemoteFileLocator(client, fileId);
  if (!locator) return null;

  // Private content always fails closed: both the verified key and the
  // server-owned object must carry the same explicit tenant binding.
  if (!locator.tenant_id || tenantId !== locator.tenant_id) return null;
  return locator;
}

function tenantMismatch(requested: unknown, tenantId: string): boolean {
  return requested !== undefined && requested !== null && requested !== "" && requested !== tenantId;
}

async function evidenceAssetForTenant(
  client: TypedQueryClient,
  tenantId: string,
  assetId: string,
) {
  const asset = await store.evGetFileAsset(client, assetId);
  return asset?.org_id === tenantId ? asset : null;
}
