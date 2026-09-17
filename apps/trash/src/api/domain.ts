import { createHash } from "node:crypto";
import { z } from "zod";

export const MAX_PAYLOAD_BYTES = 2_147_483_648;
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_CAPSULE_BYTES = MAX_PAYLOAD_BYTES + MAX_MANIFEST_BYTES + 12;

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function parseInput<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "request"))].slice(0, 5);
    throw new ApiError(400, "invalid_request", `Invalid request fields: ${fields.join(", ")}.`);
  }
  return result.data;
}

export const idSchema = z.string().uuid();
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const labelSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/);
export const stationNameSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
export const retentionSchema = z.number().int().min(1).max(3650).nullable();
export const agentSchema = z.object({
  name: labelSchema,
  harness: z.enum(["codex", "claude", "opencode", "cursor"]).nullable(),
  session: labelSchema.nullable(),
}).strict();
export const stationSchema = z.object({
  name: stationNameSchema,
  hostname: z.string().min(1).max(253).regex(/^[^\x00-\x1f\x7f]+$/),
  source: z.enum(["environment", "tailscale", "hostname"]),
  platform: z.enum(["darwin", "linux"]),
  architecture: z.enum(["arm64", "x64"]),
}).strict();

export const artifactSchema = z.object({
  format: z.literal("hasna.trash.capsule.v1"),
  sha256: digestSchema,
  sizeBytes: z.number().int().min(12).max(MAX_CAPSULE_BYTES),
}).strict();

export const captureSchema = z.object({
  id: idSchema,
  stationId: idSchema,
  originalPath: z.string().min(2).max(4096).startsWith("/").refine((path) => !path.includes("\0")),
  kind: z.enum(["file", "dir", "symlink"]),
  sizeBytes: z.number().int().min(0).max(MAX_PAYLOAD_BYTES),
  sha256: digestSchema,
  mode: z.number().int().min(0).max(0o7777),
  artifact: artifactSchema,
  agent: agentSchema,
  retentionDays: retentionSchema.default(90),
}).strict();

export const entryStateSchema = z.enum(["uploading", "ready", "trashed", "restoring", "restored", "deleting", "expired"]);
export const backupStateSchema = z.enum(["none", "requested", "running", "failed", "verified"]);
export const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(4096).optional(),
  station: stationNameSchema.optional(),
  agent: labelSchema.optional(),
  path: z.string().min(1).max(256).optional(),
  kind: z.enum(["file", "dir", "symlink"]).optional(),
  state: entryStateSchema.optional(),
  backup: backupStateSchema.optional(),
  held: z.enum(["true", "false"]).optional(),
}).strict();

export type CaptureInput = z.infer<typeof captureSchema>;
export type StationInput = z.infer<typeof stationSchema>;
export type ListQuery = z.infer<typeof listSchema>;
export type EntryState = z.infer<typeof entryStateSchema>;
export type BackupState = z.infer<typeof backupStateSchema>;
export type Station = StationInput & { id: string; createdAt: string; updatedAt: string };

export type Entry = CaptureInput & {
  version: number;
  stationName: string;
  state: EntryState;
  capturedAt: string;
  expiresAt: string | null;
  held: boolean;
  backup: BackupState;
  objectKey: string;
  objectVersion: string | null;
  downloadUntil?: string | null;
  restoredAt?: string | null;
  trashedAt?: string | null;
  restoreLease?: { id: string; principal: string; stationId: string; until: string } | null;
  backupLease?: { id: string; principal: string; until: string } | null;
  backupReceipt?: { id: string; destination: string; artifactSha256: string; verifiedAt: string; held: true; restoreVerified: true } | null;
  deletionLease?: { id: string; until: string } | null;
};

/** Explicit detail reads expose recovery metadata, never storage authority. */
export function entryDetails(entry: Entry) {
  const { objectKey: _key, objectVersion: _version, restoreLease: _restore, backupLease: _backup, deletionLease: _deletion, ...details } = entry;
  return details;
}

/** The default list projection deliberately excludes full metadata and blob grants. */
export function compactEntry<T extends Pick<Entry, "id" | "version" | "originalPath" | "kind" | "sizeBytes" | "stationName" | "capturedAt" | "expiresAt" | "held" | "backup" | "state">>(entry: T) {
  const path = Array.from(entry.originalPath);
  return {
    id: entry.id,
    version: entry.version,
    path: path.length > 240 ? `${path.slice(0, 240).join("")}…` : entry.originalPath,
    ...(path.length > 240 ? { pathTruncated: true } : {}),
    kind: entry.kind,
    bytes: entry.sizeBytes,
    station: entry.stationName,
    capturedAt: entry.capturedAt,
    expiresAt: entry.expiresAt,
    held: entry.held,
    backup: entry.backup,
    state: entry.state,
  };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new ApiError(400, "invalid_json", "The request must contain only JSON values.");
}

export function requestDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
