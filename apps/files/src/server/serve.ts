import { getCurrentMachine, listMachines } from "../db/machines.js";
import { createSource, listSources, getSource, deleteSource } from "../db/sources.js";
import { listFiles, getFile, getFilesSince } from "../db/files.js";
import { searchFiles } from "../db/search.js";
import { tagFile, untagFile, listTags } from "../db/tags.js";
import { createCollection, listCollections, addToCollection, removeFromCollection } from "../db/collections.js";
import { createProject, listProjects, addToProject, removeFromProject } from "../db/projects.js";
import { indexLocalSource } from "../lib/indexer.js";
import { syncGoogleDriveSource } from "../lib/google-drive.js";
import { indexS3Source, downloadFromS3 } from "../lib/s3.js";
import {
  completeEvidenceUpload,
  createEvidenceUploadIntent,
  getFileAsset,
  linkEvidenceAsset,
  listFileAccessEvents,
  listFileAssets,
  listFileLinks,
  sanitizeEvidenceTransportError,
  signEvidenceDownload,
  verifyEvidenceAsset,
  type EvidenceStorageOptions,
} from "../lib/evidence.js";
import { join } from "path";
import { homedir } from "os";
import { createRequire } from "module";
import type { FileAssetStatus, GoogleDriveConfig, S3Config, SourceType } from "../types/index.js";
import { createV1Handler } from "./v1.js";
import { cloudEnabled, getCloudClient } from "./pg-store.js";
import { checkHealth } from "../generated/storage-kit/health.js";
import { CLOUD_MIGRATIONS } from "../db/cloud-migrations.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

/** Storage mode reported by /health, /ready, /version. */
function serviceMode(): "remote" | "local" {
  return cloudEnabled() ? "remote" : "local";
}

/**
 * Read-only readiness probe: reachable AND fully migrated. Unlike the kit's
 * checkReady (which CREATEs the ledger table), this only SELECTs, so it works
 * under the least-privilege runtime app role (no schema CREATE grant).
 */
async function readiness(client: TypedQueryClient): Promise<{ ok: boolean; latencyMs: number; pending: string[]; error?: string }> {
  const start = Date.now();
  const health = await checkHealth(client);
  if (!health.ok) return { ok: false, latencyMs: health.latencyMs, pending: [], error: health.error };
  try {
    const rows = await client.many<{ id: string }>("SELECT id FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.id));
    const pending = CLOUD_MIGRATIONS.filter((m) => !applied.has(m.id)).map((m) => m.id);
    return { ok: pending.length === 0, latencyMs: Date.now() - start, pending };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, pending: [], error: `migration ledger unreadable: ${(e as Error).message}` };
  }
}

type RestCapability = "mutations" | "destructive" | "imports" | "signed_urls" | "downloads" | "indexing";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function err(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}

function requireRestCapability(capability: RestCapability): Response | null {
  if (restCapabilityEnabled(capability)) return null;
  return err(
    `REST capability '${capability}' is disabled. Set ${restCapabilityEnvName(capability)}=1 or OPEN_FILES_REST_ALLOW_ALL=1 to enable this route.`,
    403,
  );
}

function restCapabilityEnabled(capability: RestCapability): boolean {
  return truthyEnv(process.env.OPEN_FILES_REST_ALLOW_ALL)
    || truthyEnv(process.env.OPEN_FILES_ALLOW_ALL)
    || truthyEnv(process.env[restCapabilityEnvName(capability)])
    || truthyEnv(process.env[`OPEN_FILES_ALLOW_${capability.toUpperCase()}`]);
}

function restCapabilityEnvName(capability: RestCapability): string {
  return `OPEN_FILES_REST_ALLOW_${capability.toUpperCase()}`;
}

function truthyEnv(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  try { return await req.json() as Record<string, unknown>; }
  catch { return {}; }
}

const FILE_ASSET_STATUSES = ["pending_upload", "uploaded", "verified", "archived", "deleted"] as const satisfies readonly FileAssetStatus[];

function evidenceStorageFromBody(body: Record<string, unknown>): EvidenceStorageOptions {
  const provider = optionalString(body.storage_provider) ?? optionalString(body.storage);
  return {
    provider: provider as EvidenceStorageOptions["provider"] | undefined,
    bucket: optionalString(body.bucket),
    region: optionalString(body.region),
    profile: optionalString(body.aws_profile),
    prefix: optionalString(body.prefix),
    localRoot: optionalString(body.local_root),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = optionalString(body[key]);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function requiredNumber(body: Record<string, unknown>, key: string): number {
  const value = optionalNumber(body[key]);
  if (value === undefined) throw new Error(`${key} is required`);
  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalAssetStatus(value: string | null): FileAssetStatus | undefined {
  if (!value) return undefined;
  if ((FILE_ASSET_STATUSES as readonly string[]).includes(value)) return value as FileAssetStatus;
  throw new Error(`Invalid status: ${value}`);
}

export function startServer(port: number): void {
  const v1 = createV1Handler();
  Bun.serve({
    port,
    idleTimeout: 30,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      if (method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" } });

      // ── Liveness / readiness / version (unauthenticated) ───────────────
      if (path === "/health") return json({ status: "ok", version: pkg.version, mode: serviceMode() });
      if (path === "/version") return json({ status: "ok", version: pkg.version, mode: serviceMode() });
      if (path === "/ready") {
        if (!cloudEnabled()) return json({ status: "ok", version: pkg.version, mode: "local" });
        try {
          const ready = await readiness(getCloudClient());
          if (!ready.ok) {
            return json({ status: "degraded", version: pkg.version, mode: "remote", latency_ms: ready.latencyMs, pending_migrations: ready.pending, error: ready.error }, 503);
          }
          return json({ status: "ok", version: pkg.version, mode: "remote", latency_ms: ready.latencyMs });
        } catch (e) {
          return json({ status: "error", version: pkg.version, mode: "remote", error: (e as Error).message }, 503);
        }
      }

      // ── Versioned /v1 API (API-key authenticated, PURE REMOTE) ─────────
      const v1res = await v1.handle(req, url);
      if (v1res) return v1res;

      // ── Sources ──────────────────────────────────────────────────────────
      if (path === "/sources" && method === "GET") {
        const machine_id = url.searchParams.get("machine_id") ?? undefined;
        return json(listSources(machine_id));
      }
      if (path === "/sources" && method === "POST") {
        const denied = requireRestCapability("mutations");
        if (denied) return denied;
        const body = await parseBody(req);
        const machine = getCurrentMachine();
        const type = (body.type as SourceType | undefined) ?? "local";
        const source = createSource({
          type,
          path: body.path as string | undefined,
          bucket: body.bucket as string | undefined,
          prefix: body.prefix as string | undefined,
          region: body.region as string | undefined,
          name: (body.name as string | undefined) ?? (body.bucket as string) ?? (body.path as string),
          config: (body.config as S3Config | GoogleDriveConfig) ?? {},
          machine_id: machine.id,
        });
        return json(source, 201);
      }
      if (path.match(/^\/sources\/[^/]+$/) && method === "DELETE") {
        const denied = requireRestCapability("destructive");
        if (denied) return denied;
        const id = path.split("/")[2]!;
        deleteSource(id);
        return json({ ok: true });
      }
      if (path.match(/^\/sources\/[^/]+\/index$/) && method === "POST") {
        const denied = requireRestCapability("indexing");
        if (denied) return denied;
        const id = path.split("/")[2]!;
        const source = getSource(id);
        if (!source) return err("Source not found", 404);
        const machine = getCurrentMachine();
        const stats = source.type === "s3"
          ? await indexS3Source(source, machine.id)
          : source.type === "google_drive"
            ? await syncGoogleDriveSource(source)
            : await indexLocalSource(source, machine.id);
        return json(stats);
      }

      // ── Files ─────────────────────────────────────────────────────────────
      if (path === "/files" && method === "GET") {
        const opts = {
          source_id: url.searchParams.get("source_id") ?? undefined,
          machine_id: url.searchParams.get("machine_id") ?? undefined,
          tag: url.searchParams.get("tag") ?? undefined,
          collection_id: url.searchParams.get("collection_id") ?? undefined,
          project_id: url.searchParams.get("project_id") ?? undefined,
          ext: url.searchParams.get("ext") ?? undefined,
          limit: parseInt(url.searchParams.get("limit") ?? "50"),
          offset: parseInt(url.searchParams.get("offset") ?? "0"),
        };
        const q = url.searchParams.get("q");
        const sinceVersion = url.searchParams.get("since_version");
        if (sinceVersion) {
          const files = getFilesSince(parseInt(sinceVersion), opts.limit, opts.offset);
          return json(files);
        }
        const files = q ? searchFiles(q, opts) : listFiles(opts);
        return json(files);
      }
      if (path.match(/^\/files\/[^/]+$/) && method === "GET") {
        const id = path.split("/")[2]!;
        const file = getFile(id);
        if (!file) return err("File not found", 404);
        return json(file);
      }
      if (path.match(/^\/files\/[^/]+\/download$/) && method === "GET") {
        const denied = requireRestCapability("downloads");
        if (denied) return denied;
        const id = path.split("/")[2]!;
        const file = getFile(id);
        if (!file) return err("File not found", 404);
        const source = getSource(file.source_id);
        if (!source) return err("Source not found", 404);
        if (source.type === "local") {
          const fullPath = join(source.path!, file.path);
          return json({ local_path: fullPath });
        }
        const dest = join(homedir(), "Downloads", file.name);
        await downloadFromS3(source, file.path, dest);
        return json({ downloaded_to: dest });
      }
      if (path.match(/^\/files\/[^/]+\/tags$/) && method === "POST") {
        const denied = requireRestCapability("mutations");
        if (denied) return denied;
        const id = path.split("/")[2]!;
        const body = await parseBody(req);
        const tags = (body.tags as string[]) ?? [];
        for (const t of tags) tagFile(id, t);
        return json({ ok: true });
      }
      if (path.match(/^\/files\/[^/]+\/tags$/) && method === "DELETE") {
        const denied = requireRestCapability("mutations");
        if (denied) return denied;
        const id = path.split("/")[2]!;
        const body = await parseBody(req);
        const tags = (body.tags as string[]) ?? [];
        for (const t of tags) untagFile(id, t);
        return json({ ok: true });
      }

      // ── Tags ──────────────────────────────────────────────────────────────
      if (path === "/tags" && method === "GET") return json(listTags());

      // ── Collections ───────────────────────────────────────────────────────
      if (path === "/collections" && method === "GET") return json(listCollections());
      if (path === "/collections" && method === "POST") {
        const denied = requireRestCapability("mutations");
        if (denied) return denied;
        const body = await parseBody(req);
        return json(createCollection(body.name as string, body.description as string | undefined), 201);
      }
      if (path.match(/^\/collections\/[^/]+\/files$/) && method === "POST") {
        const denied = requireRestCapability("mutations");
        if (denied) return denied;
        const id = path.split("/")[2]!;
        const body = await parseBody(req);
        addToCollection(id, body.file_id as string);
        return json({ ok: true });
      }
      if (path.match(/^\/collections\/[^/]+\/files\/[^/]+$/) && method === "DELETE") {
        const denied = requireRestCapability("mutations");
        if (denied) return denied;
        const parts = path.split("/");
        removeFromCollection(parts[2]!, parts[4]!);
        return json({ ok: true });
      }

      // ── Projects ──────────────────────────────────────────────────────────
      if (path === "/projects" && method === "GET") return json(listProjects());
      if (path === "/projects" && method === "POST") {
        const denied = requireRestCapability("mutations");
        if (denied) return denied;
        const body = await parseBody(req);
        return json(createProject(body.name as string, body.description as string | undefined), 201);
      }
      if (path.match(/^\/projects\/[^/]+\/files$/) && method === "POST") {
        const denied = requireRestCapability("mutations");
        if (denied) return denied;
        const id = path.split("/")[2]!;
        const body = await parseBody(req);
        addToProject(id, body.file_id as string);
        return json({ ok: true });
      }
      if (path.match(/^\/projects\/[^/]+\/files\/[^/]+$/) && method === "DELETE") {
        const denied = requireRestCapability("mutations");
        if (denied) return denied;
        const parts = path.split("/");
        removeFromProject(parts[2]!, parts[4]!);
        return json({ ok: true });
      }

      // ── Machines ──────────────────────────────────────────────────────────
      if (path === "/machines" && method === "GET") return json(listMachines());
      if (path === "/machines/current" && method === "GET") return json(getCurrentMachine());

      // ── Sync ──────────────────────────────────────────────────────────────
      if (path === "/sync" && method === "POST") {
        const denied = requireRestCapability("mutations");
        if (denied) return denied;
        const body = await parseBody(req);
        const peers = (body.peers as string[]) ?? [];
        if (!peers.length) return err("peers array required");
        const { syncWithPeers } = await import("../lib/sync.js");
        const results = await syncWithPeers(peers);
        return json(results);
      }

      // ── Agents ──────────────────────────────────────────────────────────
      if (path === "/agents" && method === "GET") {
        const { listAgents: listDbAgents } = await import("../db/agents.js");
        return json(listDbAgents());
      }
      if (path.match(/^\/agents\/[^/]+\/activity$/) && method === "GET") {
        const agentId = path.split("/")[2]!;
        const { getAgentActivity } = await import("../db/activity.js");
        const limit = parseInt(url.searchParams.get("limit") ?? "50");
        const offset = parseInt(url.searchParams.get("offset") ?? "0");
        return json(getAgentActivity(agentId, { limit, offset }));
      }

      // ── File History ───────────────────────────────────────────────────
      if (path.match(/^\/files\/[^/]+\/history$/) && method === "GET") {
        const fileId = path.split("/")[2]!;
        const { getFileHistory } = await import("../db/activity.js");
        const limit = parseInt(url.searchParams.get("limit") ?? "50");
        const offset = parseInt(url.searchParams.get("offset") ?? "0");
        return json(getFileHistory(fileId, { limit, offset }));
      }

      // ── Evidence Vault ─────────────────────────────────────────────────
      try {
        if (path === "/evidence/assets" && method === "GET") {
          return json(listFileAssets({
            org_id: url.searchParams.get("org_id") ?? undefined,
            company_id: url.searchParams.get("company_id") ?? undefined,
            app: url.searchParams.get("app") ?? undefined,
            kind: url.searchParams.get("kind") ?? undefined,
            status: optionalAssetStatus(url.searchParams.get("status")),
            checksum: url.searchParams.get("checksum") ?? undefined,
            limit: parseInt(url.searchParams.get("limit") ?? "50"),
            offset: parseInt(url.searchParams.get("offset") ?? "0"),
          }));
        }

        if (path === "/evidence/upload-intents" && method === "POST") {
          const denied = requireRestCapability("signed_urls") ?? requireRestCapability("mutations");
          if (denied) return denied;
          const body = await parseBody(req);
          const result = await createEvidenceUploadIntent({
            org_id: requiredString(body, "org_id"),
            company_id: optionalString(body.company_id),
            app: requiredString(body, "app"),
            kind: requiredString(body, "kind"),
            original_name: requiredString(body, "original_name"),
            content_type: optionalString(body.content_type),
            size: requiredNumber(body, "size"),
            checksum: requiredString(body, "checksum"),
            classification: optionalString(body.classification),
            retention_until: optionalString(body.retention_until),
            retention_policy: optionalString(body.retention_policy),
            storage_class: optionalString(body.storage_class),
            legal_hold: optionalBoolean(body.legal_hold),
            immutable: optionalBoolean(body.immutable),
            metadata: optionalRecord(body.metadata),
            expires_in_seconds: optionalNumber(body.expires_in_seconds),
          }, evidenceStorageFromBody(body));
          return json(result, 201);
        }

        const completeMatch = path.match(/^\/evidence\/upload-intents\/([^/]+)\/complete$/);
        if (completeMatch && method === "POST") {
          const denied = requireRestCapability("mutations");
          if (denied) return denied;
          const body = await parseBody(req);
          return json(await completeEvidenceUpload(completeMatch[1]!, evidenceStorageFromBody(body)));
        }

        const linkMatch = path.match(/^\/evidence\/assets\/([^/]+)\/links$/);
        if (linkMatch && method === "POST") {
          const denied = requireRestCapability("mutations");
          if (denied) return denied;
          const body = await parseBody(req);
          return json(await linkEvidenceAsset({
            asset_id: linkMatch[1]!,
            org_id: requiredString(body, "org_id"),
            company_id: optionalString(body.company_id),
            app: requiredString(body, "app"),
            source_type: requiredString(body, "source_type"),
            source_id: requiredString(body, "source_id"),
            kind: requiredString(body, "kind"),
            metadata: optionalRecord(body.metadata),
          }), 201);
        }

        const signMatch = path.match(/^\/evidence\/assets\/([^/]+)\/download-url$/);
        if (signMatch && method === "POST") {
          const denied = requireRestCapability("signed_urls") ?? requireRestCapability("downloads");
          if (denied) return denied;
          const body = await parseBody(req);
          return json(await signEvidenceDownload({
            asset_id: signMatch[1]!,
            actor_id: optionalString(body.actor_id),
            purpose: optionalString(body.purpose),
            expires_in_seconds: optionalNumber(body.expires_in_seconds),
          }, evidenceStorageFromBody(body)));
        }

        const verifyMatch = path.match(/^\/evidence\/assets\/([^/]+)\/verify$/);
        if (verifyMatch && method === "POST") {
          const denied = requireRestCapability("indexing");
          if (denied) return denied;
          const body = await parseBody(req);
          return json(await verifyEvidenceAsset(verifyMatch[1]!, evidenceStorageFromBody(body)));
        }

        const auditMatch = path.match(/^\/evidence\/assets\/([^/]+)\/audit$/);
        if (auditMatch && method === "GET") {
          const asset = getFileAsset(auditMatch[1]!);
          if (!asset) return err("Evidence asset not found", 404);
          return json({
            asset,
            links: listFileLinks(asset.id),
            events: listFileAccessEvents(asset.id, parseInt(url.searchParams.get("limit") ?? "50")),
          });
        }
      } catch (error) {
        return err(sanitizeEvidenceTransportError(error).message);
      }

      // ── Stats ──────────────────────────────────────────────────────────
      if (path === "/stats" && method === "GET") {
        const { getDb: getStatsDb } = await import("../db/database.js");
        const db = getStatsDb();
        const totals = db.query<any, []>("SELECT COUNT(*) as total_files, COALESCE(SUM(size), 0) as total_size FROM files WHERE status='active'").get()!;
        const by_ext = db.query<any, []>("SELECT ext, COUNT(*) as count FROM files WHERE status='active' GROUP BY ext ORDER BY count DESC LIMIT 20").all();
        const by_source = db.query<any, []>("SELECT f.source_id, s.name, COUNT(*) as count FROM files f JOIN sources s ON s.id=f.source_id WHERE f.status='active' GROUP BY f.source_id ORDER BY count DESC").all();
        return json({ ...totals, by_ext, by_source });
      }

      return err("Not found", 404);
    },
  });

  console.log(`files-serve running on http://localhost:${port}`);
}
