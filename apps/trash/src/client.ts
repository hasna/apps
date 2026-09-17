import { randomUUID } from "node:crypto";
import { createClientTransport, HasnaHttpError, type HasnaHttpTransport } from "@hasna/contracts/client";
import { captureSchema, entryDetails, idSchema, listSchema, parseInput, stationSchema, type CaptureInput, type Entry, type ListQuery, type Station, type StationInput } from "./api/domain.js";
import type { TransferGrant } from "./api/objects.js";

export type RemoteEntry = ReturnType<typeof entryDetails>;
export type CompactEntry = ReturnType<typeof import("./api/domain.js").compactEntry>;
export type EntryPage = { items: CompactEntry[]; nextCursor: string | null };
export type ApiStatus = { app: "trash"; version: string; station: Station | null; retentionDays: number; listLimit: { default: number; max: number } };
export type RecoveryGrant = { entry: RemoteEntry; lease: { id: string; until: string }; transfer: TransferGrant };
export type BackupGrant = { entry: RemoteEntry; job: { id: string; until: string }; transfer: TransferGrant };
export type TrashApiOptions = { env?: NodeJS.ProcessEnv; fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> };

const ERROR_CODES = new Set([
  "invalid_request", "invalid_json", "not_found", "version_required", "version_conflict", "idempotency_required", "idempotency_conflict",
  "station_setup_required", "station_conflict", "station_identity_mismatch", "station_mismatch", "entry_exists", "entry_expired", "state_conflict",
  "artifact_mismatch", "object_store_unavailable", "object_version_required", "cross_station_destination_required", "restore_busy", "restore_lease_invalid", "restore_mismatch",
  "backup_exists", "backup_state", "backup_busy", "backup_lease_invalid", "backup_unverified", "invalid_cursor", "duplicate_query", "body_too_large", "body_timeout",
  "service_unavailable", "storage_unavailable", "missing_token", "unknown_key", "revoked", "expired", "insufficient_scope", "tenant_required", "status_unavailable",
]);

export class TrashApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(status === 401 || status === 403 ? "Trash refused authentication or permission; check the configured hosted credential."
      : status === 409 ? "Trash state changed or the operation conflicts; inspect the entry before retrying."
      : "Trash could not complete the hosted request.");
    this.name = "TrashApiError";
  }
}

/** Metadata-only hosted client. It never opens a local metadata store. */
export class TrashApi {
  #http: HasnaHttpTransport;
  constructor(options: TrashApiOptions = {}) {
    this.#http = createClientTransport("trash", options.env ?? process.env, { fetchImpl: options.fetchImpl, timeoutMs: 150_000 }).client;
  }
  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, options: { version?: number; key?: string; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
    try {
      return await this.#http.request<T>(method, path, body, {
        ...(method === "POST" ? { idempotencyKey: options.key ?? randomUUID() } : {}),
        ...(options.version === undefined ? {} : { headers: { "if-match": String(options.version) } }),
        ...(options.query ? { query: options.query } : {}),
      });
    } catch (error) {
      if (error instanceof HasnaHttpError) {
        const body = error.body as { error?: { code?: unknown } } | undefined;
        const value = body?.error?.code;
        const code = typeof value === "string" && ERROR_CODES.has(value) ? value : "request_failed";
        throw new TrashApiError(error.status, code);
      }
      throw new TrashApiError(503, "hosted_unavailable");
    }
  }
  status() { return this.call<ApiStatus>("GET", "/status"); }
  registerStation(station: StationInput, key?: string) { return this.call<Station>("POST", "/stations/register", parseInput(stationSchema, station), { key }); }
  async list(query: Partial<ListQuery> = {}): Promise<EntryPage> {
    const parsed = parseInput(listSchema, query);
    return this.call("GET", "/entries", undefined, { query: parsed });
  }
  async get(id: string) { return this.call<RemoteEntry>("GET", `/entries/${parseInput(idSchema, id)}`); }
  reserve(input: CaptureInput, key?: string) { return this.call<RemoteEntry>("POST", "/entries", parseInput(captureSchema, input), { key }); }
  private async action<T>(id: string, version: number, action: string, body: unknown, key?: string) {
    if (!Number.isSafeInteger(version) || version < 1) throw new TrashApiError(400, "invalid_version");
    return this.call<T>("POST", `/entries/${parseInput(idSchema, id)}/${action}`, body, { version, key });
  }
  upload(id: string, version: number, key?: string) { return this.action<{ entry: RemoteEntry; transfer: TransferGrant }>(id, version, "upload", {}, key); }
  verify(id: string, version: number, key?: string) { return this.action<RemoteEntry>(id, version, "verify", {}, key); }
  commit(id: string, version: number, key?: string) { return this.action<RemoteEntry>(id, version, "commit", {}, key); }
  hold(id: string, version: number, held: boolean, key?: string) { return this.action<RemoteEntry>(id, version, "hold", { held }, key); }
  retention(id: string, version: number, retentionDays: number | null, key?: string) { return this.action<RemoteEntry>(id, version, "retention", { retentionDays }, key); }
  backup(id: string, version: number, key?: string) { return this.action<RemoteEntry>(id, version, "backup", {}, key); }
  recovery(id: string, version: number, crossStation: boolean, key?: string) { return this.action<RecoveryGrant>(id, version, "restore", { crossStation }, key); }
  restored(id: string, version: number, leaseId: string, sha256: string, key?: string) { return this.action<RemoteEntry>(id, version, "restore/complete", { leaseId, sha256 }, key); }
  claimBackup(id: string, version: number, key?: string) { return this.action<BackupGrant>(id, version, "backup/claim", {}, key); }
  completeBackup(id: string, version: number, jobId: string, receipt: NonNullable<Entry["backupReceipt"]>, key?: string) { return this.action<RemoteEntry>(id, version, "backup/complete", { jobId, receipt }, key); }
  failBackup(id: string, version: number, jobId: string, key?: string) { return this.action<RemoteEntry>(id, version, "backup/fail", { jobId }, key); }
}
