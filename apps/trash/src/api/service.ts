import { createHash, randomUUID } from "node:crypto";
import { ApiKeyStore, verifyApiKey } from "@hasna/contracts/auth";
import { z } from "zod";
import { OPENAPI } from "./openapi.js";
import { VERSION } from "../version.js";
import { ApiError, captureSchema, digestSchema, entryDetails, idSchema, labelSchema, listSchema, parseInput, requestDigest, retentionSchema, stationSchema, type Entry } from "./domain.js";
import type { PgTrashStore } from "./store.js";
import type { TrashObjects } from "./objects.js";

const empty = z.object({}).strict();
const DAY = 86_400_000;
const LEASE_MS = 30 * 60_000;
const receiptSchema = z.object({
  id: labelSchema, destination: labelSchema, artifactSha256: digestSchema,
  verifiedAt: z.string().datetime(), held: z.literal(true), restoreVerified: z.literal(true),
}).strict();

async function boundedJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") throw new ApiError(415, "content_type", "Send application/json.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_json", "Supply a JSON request body.");
  const chunks: Uint8Array[] = []; let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 10_000);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64 * 1024) throw new ApiError(413, "body_too_large", "The JSON request exceeds 64 KiB.");
      chunks.push(value);
    }
    if (timedOut) throw new ApiError(408, "body_timeout", "The JSON request exceeded its read deadline.");
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_json", "Supply one valid JSON request under 64 KiB.");
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

function requireVersion(request: Request) {
  const value = request.headers.get("if-match");
  if (!value || !/^[1-9][0-9]{0,8}$/.test(value)) throw new ApiError(428, "version_required", "Supply the current numeric version in If-Match.");
  return Number(value);
}

function eligible(entry: Entry, now: number) {
  if (["deleting", "expired"].includes(entry.state)) throw new ApiError(410, "entry_expired", "This entry is being removed or has expired.");
  if (entry.expiresAt && Date.parse(entry.expiresAt) <= now && !entry.held && !["requested", "running", "failed"].includes(entry.backup)) {
    throw new ApiError(410, "entry_expired", "This entry has reached its retention deadline.");
  }
}

export function createTrashHandler(store: PgTrashStore, objects: TrashObjects, options: { signingSecret: string | Buffer; now?: () => number }) {
  const keys = new ApiKeyStore(store.authQueryClient());
  const auth = verifyApiKey({ app: "trash", signingSecret: options.signingSecret, keyStatus: keys.keyStatus, requireTenant: true });
  const now = options.now ?? Date.now;
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  return async function fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url); const route = url.pathname;
      if (request.url.length > 8192) throw new ApiError(414, "url_too_long", "Request URL exceeds its limit.");
      if (request.method === "GET" && route === "/openapi.json") return json(OPENAPI);
      if (request.method === "GET" && route === "/health") return json({ status: "ok", app: "trash" });
      if (request.method === "GET" && route === "/version") return json({ app: "trash", version: VERSION });
      if (request.method === "GET" && route === "/ready") {
        await Promise.all([store.ready(), objects.ready()]);
        return json({ status: "ready", app: "trash", version: VERSION, storage: "postgresql" });
      }
      if (!route.startsWith("/v1/")) throw new ApiError(404, "not_found", "Route was not found.");
      const workerRoute = /^\/v1\/entries\/[^/]+\/backup\/(claim|complete|fail)$/.test(route);
      const scope = workerRoute ? "trash:backup" : request.method === "GET" ? "trash:read" : "trash:write";
      const decision = await auth.authenticate(request.headers, { method: request.method, path: route, requiredScopes: [scope] });
      if (!decision.ok) return json({ error: { code: decision.reason, message: "Trash authentication was refused." } }, decision.status);
      const principal = decision.principal; const tenant = principal.tid!;
      if (request.method === "GET" && route === "/v1/status") {
        let station = null;
        try { station = await store.stationForKey(tenant, principal.kid); }
        catch (error) { if (!(error instanceof ApiError && error.code === "station_setup_required")) throw error; }
        return json({ app: "trash", version: VERSION, station, retentionDays: 90, listLimit: { default: 20, max: 100 } });
      }
      if (request.method === "GET" && route === "/v1/entries") {
        const query: Record<string, string> = {};
        for (const [key, value] of url.searchParams) {
          if (Object.hasOwn(query, key)) throw new ApiError(400, "duplicate_query", "Duplicate query fields are not supported.");
          Object.defineProperty(query, key, { value, enumerable: true });
        }
        return json(await store.list(tenant, parseInput(listSchema, query)));
      }
      const match = /^\/v1\/entries\/([^/]+)(?:\/(upload|verify|commit|hold|retention|restore|restore\/complete|backup|backup\/claim|backup\/complete|backup\/fail))?$/.exec(route);
      const id = match ? parseInput(idSchema, match[1]) : null;
      if (request.method === "GET" && id && !match![2]) return json(entryDetails(await store.entry(tenant, id)));
      if (request.method !== "POST") throw new ApiError(405, "method_not_allowed", "This route does not support that method.");
      const body = await boundedJson(request);
      const key = request.headers.get("idempotency-key") ?? "";
      if (route === "/v1/stations/register") {
        const input = parseInput(stationSchema, body);
        // The signed issued-to subject is the station authority; daemon labels are provenance.
        if (principal.agent !== input.name) throw new ApiError(403, "station_identity_mismatch", "The detected station does not match this key's issued-to station.");
        return json(await store.mutate(tenant, principal.kid, route, key, input, (tx) => store.registerStation(tenant, principal.kid, input, tx)));
      }
      if (route === "/v1/entries") {
        const input = parseInput(captureSchema, body);
        const result = await store.mutate(tenant, principal.kid, route, key, input, async (tx) => {
          const station = await store.stationForKey(tenant, principal.kid, tx);
          if (input.stationId !== station.id) throw new ApiError(403, "station_mismatch", "Capture must use the authenticated station.");
          const entry: Entry = { ...input, version: 1, stationName: station.name, state: "uploading", capturedAt: new Date(now()).toISOString(),
            expiresAt: null, held: false, backup: "none", objectKey: `trash/${createHash("sha256").update(tenant).digest("hex")}/${input.id}`, objectVersion: null };
          return entryDetails(await store.insertEntry(tenant, entry, tx));
        });
        return json(result, 201);
      }
      if (!id || !match![2]) throw new ApiError(404, "not_found", "Route was not found.");
      const action = match![2];
      const version = requireVersion(request);
      const result = await store.mutate(tenant, principal.kid, route, key, { version, body }, async (tx) => {
        const entry = await store.entry(tenant, id, tx, true);
        if (entry.version !== version) throw new ApiError(409, "version_conflict", "The entry changed; reload before retrying.");
        const save = async (next: Entry) => entryDetails(await store.replaceEntry(tenant, next, version, tx));
        const origin = async () => {
          const station = await store.stationForKey(tenant, principal.kid, tx);
          if (station.id !== entry.stationId) throw new ApiError(403, "station_mismatch", "Only the capture station may commit removal of its source.");
        };
        // A lease acquired before expiry may finish while it still protects the object.
        if (action === "restore/complete") {
          if (["deleting", "expired"].includes(entry.state)) throw new ApiError(410, "entry_expired", "This entry has expired.");
        } else eligible(entry, now());
        if (["upload", "verify", "commit"].includes(action)) await origin();
        if (action === "upload") {
          parseInput(empty, body);
          if (entry.state !== "uploading") throw new ApiError(409, "state_conflict", "This entry no longer accepts uploads.");
          return { entry: entryDetails(entry), transfer: await objects.upload(entry) };
        }
        if (action === "verify") {
          parseInput(empty, body);
          if (!["uploading", "ready", "trashed", "restored"].includes(entry.state)) throw new ApiError(409, "state_conflict", "This entry cannot be verified in its current state.");
          const verified = await objects.verify(entry);
          if (!verified.version || requestDigest(verified.receipt) !== requestDigest({ kind: entry.kind, mode: entry.mode, sizeBytes: entry.sizeBytes, sha256: entry.sha256, artifact: entry.artifact })) {
            throw new ApiError(422, "artifact_mismatch", "Stored bytes do not match the capture receipt.");
          }
          if (entry.objectVersion) {
            if (verified.version !== entry.objectVersion) throw new ApiError(422, "artifact_mismatch", "Verification must read the recorded object version.");
            return entryDetails(entry);
          }
          return save({ ...entry, state: "ready", objectVersion: verified.version });
        }
        if (action === "commit") {
          parseInput(empty, body);
          if (entry.state !== "ready" || !entry.objectVersion) throw new ApiError(409, "state_conflict", "Verify the stored payload before committing source removal.");
          const trashedAt = new Date(now()).toISOString();
          return save({ ...entry, state: "trashed", trashedAt, expiresAt: entry.retentionDays === null ? null : new Date(now() + entry.retentionDays * DAY).toISOString() });
        }
        if (action === "hold") {
          const input = parseInput(z.object({ held: z.boolean() }).strict(), body);
          return save({ ...entry, held: input.held });
        }
        if (action === "retention") {
          const input = parseInput(z.object({ retentionDays: retentionSchema }).strict(), body);
          const expiresAt = !entry.trashedAt || input.retentionDays === null ? null : new Date(Date.parse(entry.trashedAt) + input.retentionDays * DAY).toISOString();
          return save({ ...entry, retentionDays: input.retentionDays, expiresAt });
        }
        if (action === "restore") {
          const input = parseInput(z.object({ crossStation: z.boolean().default(false) }).strict(), body);
          if (!["ready", "trashed", "restored"].includes(entry.state) || !entry.objectVersion) throw new ApiError(409, "state_conflict", "The payload is not ready for recovery.");
          const station = await store.stationForKey(tenant, principal.kid, tx);
          if (station.id !== entry.stationId && !input.crossStation) throw new ApiError(409, "cross_station_destination_required", "Cross-station recovery requires an explicit destination.");
          const active = entry.restoreLease && Date.parse(entry.restoreLease.until) > now() ? entry.restoreLease : null;
          if (active && active.principal !== principal.kid) throw new ApiError(409, "restore_busy", "Another client holds an active recovery lease.");
          const lease = { id: active?.id ?? randomUUID(), principal: principal.kid, stationId: station.id, until: new Date(now() + LEASE_MS).toISOString() };
          const transfer = await objects.download(entry);
          const saved = await save({ ...entry, downloadUntil: lease.until, restoreLease: lease });
          return { entry: saved, lease: { id: lease.id, until: lease.until }, transfer };
        }
        if (action === "restore/complete") {
          const input = parseInput(z.object({ leaseId: idSchema, sha256: digestSchema }).strict(), body);
          if (entry.restoreLease?.id !== input.leaseId || entry.restoreLease.principal !== principal.kid || Date.parse(entry.restoreLease.until) <= now()) {
            throw new ApiError(409, "restore_lease_invalid", "The recovery lease is missing, expired or belongs to another client.");
          }
          if (input.sha256 !== entry.sha256) throw new ApiError(422, "restore_mismatch", "The restored payload does not match its capture.");
          return save({ ...entry, state: "restored", restoredAt: new Date(now()).toISOString(), restoreLease: null, downloadUntil: null });
        }
        if (action === "backup") {
          parseInput(empty, body);
          if (!["trashed", "restored"].includes(entry.state)) throw new ApiError(409, "state_conflict", "Complete capture before requesting Backup.");
          if (entry.backup !== "none") throw new ApiError(409, "backup_exists", "A Backup request already exists.");
          return save({ ...entry, backup: "requested" });
        }
        if (action === "backup/claim") {
          parseInput(empty, body);
          if (!["requested", "failed", "running"].includes(entry.backup)) throw new ApiError(409, "backup_state", "There is no pending Backup request.");
          if (entry.backupLease && Date.parse(entry.backupLease.until) > now()) throw new ApiError(409, "backup_busy", "A Backup worker already holds this job.");
          const lease = { id: randomUUID(), principal: principal.kid, until: new Date(now() + LEASE_MS).toISOString() };
          const transfer = await objects.download(entry);
          return { entry: await save({ ...entry, backup: "running", backupLease: lease }), job: { id: lease.id, until: lease.until }, transfer };
        }
        if (action === "backup/complete" || action === "backup/fail") {
          const input = parseInput(z.object({ jobId: idSchema, receipt: receiptSchema.optional() }).strict(), body);
          if (entry.backup !== "running" || entry.backupLease?.id !== input.jobId || entry.backupLease.principal !== principal.kid || Date.parse(entry.backupLease.until) <= now()) {
            throw new ApiError(409, "backup_lease_invalid", "The Backup job is missing, expired or belongs to another worker.");
          }
          if (action === "backup/fail") return save({ ...entry, backup: "failed", backupLease: null });
          if (!input.receipt || input.receipt.artifactSha256 !== entry.artifact.sha256 || Date.parse(input.receipt.verifiedAt) > now() + 60_000) {
            throw new ApiError(422, "backup_unverified", "Backup must prove the exact artifact is held and can be restored.");
          }
          return save({ ...entry, backup: "verified", backupLease: null, backupReceipt: input.receipt });
        }
        throw new ApiError(404, "not_found", "Route was not found.");
      });
      return json(result);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status);
      return json({ error: { code: "service_unavailable", message: "Trash could not complete this operation; retry with the same idempotency key." } }, 503);
    }
  };
}
