import { VERSION } from "../version.js";

type Schema = Record<string, unknown>;
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const string = (extra: Schema = {}): Schema => ({ type: "string", ...extra });
const uuid = string({ format: "uuid" });
const digest = string({ pattern: "^[a-f0-9]{64}$" });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: "object", properties, required, additionalProperties: false });
const integer = (minimum: number, maximum?: number): Schema => ({ type: "integer", minimum, ...(maximum === undefined ? {} : { maximum }) });
const retention = { ...integer(1, 3650), nullable: true, description: "Days from committed removal; null means never expire." };
const parameter = (name: string) => ({ $ref: `#/components/parameters/${name}` });
const response = (name: string, description = "Success") => ({ description, content: { "application/json": { schema: ref(name) } } });
const errors = { "400": response("Error", "Invalid request"), "401": response("Error", "Missing or invalid credential"), "403": response("Error", "Insufficient scope or station mismatch"), "404": response("Error", "Not found"), "409": response("Error", "Version, state or idempotency conflict"), "410": response("Error", "Entry expired"), "428": response("Error", "If-Match required"), "503": response("Error", "Dependency unavailable") };
const body = (schema: Schema) => ({ required: true, content: { "application/json": { schema } } });
const action = (summary: string, schema: Schema, result = "Entry", worker = false) => ({ post: {
  summary, description: worker ? "Requires trash:backup worker scope." : "Requires trash:write scope.",
  parameters: [parameter("EntryId"), parameter("IfMatch"), parameter("IdempotencyKey")], requestBody: body(schema), responses: { "200": response(result), ...errors },
} });
const artifact = object({ format: string({ enum: ["hasna.trash.capsule.v1"] }), sha256: digest, sizeBytes: integer(12, 2_164_260_876) });
const agent = object({ name: string({ maxLength: 128 }), harness: string({ enum: ["codex", "claude", "opencode", "cursor"], nullable: true }), session: string({ maxLength: 128, nullable: true }) });
const stationProperties = { name: string({ pattern: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$" }), hostname: string({ maxLength: 253 }), source: string({ enum: ["environment", "tailscale", "hostname"] }), platform: string({ enum: ["darwin", "linux"] }), architecture: string({ enum: ["arm64", "x64"] }) };
const captureProperties = { id: uuid, stationId: uuid, originalPath: string({ maxLength: 4096 }), kind: string({ enum: ["file", "dir", "symlink"] }), sizeBytes: integer(0, 2_147_483_648), sha256: digest, mode: integer(0, 511), artifact: ref("Artifact"), agent: ref("Agent"), retentionDays: { ...retention, default: 90 } };
const date = string({ format: "date-time" });
const state = string({ enum: ["uploading", "ready", "trashed", "restoring", "restored", "deleting", "expired"] });
const backup = string({ enum: ["none", "requested", "running", "failed", "verified"] });
const lease = object({ id: uuid, until: date });
const backupReceipt = object({ id: string({ maxLength: 128 }), destination: string({ maxLength: 128 }), artifactSha256: digest, verifiedAt: date, held: { type: "boolean", enum: [true] }, restoreVerified: { type: "boolean", enum: [true] } });
const listParameters = Object.entries({ limit: { ...integer(1, 100), default: 20 }, cursor: string({ maxLength: 4096 }), station: stationProperties.name, agent: string({ maxLength: 128 }), path: string({ maxLength: 256, description: "Literal substring search." }), kind: captureProperties.kind, state, backup, held: string({ enum: ["true", "false"] }) }).map(([name, schema]) => ({ name, in: "query", required: false, schema }));

export const OPENAPI = {
  openapi: "3.0.3", info: { title: "Hasna Trash", version: VERSION, description: "Station-bound reversible deletion with PostgreSQL metadata, versioned S3 capsules, 90-day default retention and protected Backup handoff. JSON requests are limited to 64 KiB. Clients use https://api.hasna.com/trash and append /v1." },
  servers: [{ url: "https://api.hasna.com/trash" }], security: [{ bearerAuth: [] }],
  paths: {
    "/health": { get: { summary: "Process health", security: [], responses: { "200": response("Health") } } },
    "/ready": { get: { summary: "PostgreSQL and versioned S3 readiness", security: [], responses: { "200": response("Readiness"), "503": response("Error") } } },
    "/version": { get: { summary: "Package version", security: [], responses: { "200": response("Version") } } },
    "/openapi.json": { get: { summary: "OpenAPI document", security: [], responses: { "200": { description: "OpenAPI 3 document" } } } },
    "/v1/status": { get: { summary: "Bound station and service defaults", responses: { "200": response("Status"), ...errors } } },
    "/v1/stations/register": { post: { summary: "Register the station named by this signed credential", parameters: [parameter("IdempotencyKey")], requestBody: body(ref("StationInput")), responses: { "200": response("Station"), ...errors } } },
    "/v1/entries": {
      get: { summary: "Compact paginated metadata; restored and expired entries excluded unless filtered explicitly", parameters: listParameters, responses: { "200": response("EntryPage"), ...errors } },
      post: { summary: "Reserve a capture before uploading; never removes a source", parameters: [parameter("IdempotencyKey")], requestBody: body(ref("Capture")), responses: { "201": response("Entry"), ...errors } },
    },
    "/v1/entries/{id}": { get: { summary: "One full metadata record; excludes storage keys, object versions and private leases", parameters: [parameter("EntryId")], responses: { "200": response("Entry"), ...errors } } },
    "/v1/entries/{id}/upload": action("Create a short-lived create-only upload grant", object({}), "UploadGrant"),
    "/v1/entries/{id}/verify": action("Verify the complete capsule and exact object version", object({})),
    "/v1/entries/{id}/commit": action("Confirm staged source removal and start retention", object({})),
    "/v1/entries/{id}/hold": action("Set the independent user retention hold", object({ held: { type: "boolean" } })),
    "/v1/entries/{id}/retention": action("Change retention from committed removal time", object({ retentionDays: retention })),
    "/v1/entries/{id}/restore": action("Lease an immutable download for restore; destination is chosen on the client", object({ crossStation: { type: "boolean" } }), "RecoveryGrant"),
    "/v1/entries/{id}/restore/complete": action("Acknowledge a verified local restore", object({ leaseId: uuid, sha256: digest })),
    "/v1/entries/{id}/backup": action("Request Backup and protect the Trash copy until verified handoff", object({})),
    "/v1/entries/{id}/backup/claim": action("Claim a Backup job with an immutable download", object({}), "BackupGrant", true),
    "/v1/entries/{id}/backup/complete": action("Record a verified, held and restore-tested Backup receipt", object({ jobId: uuid, receipt: ref("BackupReceipt") }), "Entry", true),
    "/v1/entries/{id}/backup/fail": action("Record a failed handoff while retaining protection", object({ jobId: uuid }), "Entry", true),
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Signed revocable Hasna app key with trash:read/trash:write or separate trash:backup worker scope." } },
    parameters: { EntryId: { name: "id", in: "path", required: true, schema: uuid }, IfMatch: { name: "If-Match", in: "header", required: true, schema: string({ pattern: "^[1-9][0-9]{0,8}$" }) }, IdempotencyKey: { name: "Idempotency-Key", in: "header", required: true, schema: string({ minLength: 8, maxLength: 128 }), description: "Reuse only for the exact same principal, operation and canonical request." } },
    schemas: {
      Error: object({ error: object({ code: string(), message: string() }) }),
      Health: object({ status: string({ enum: ["ok"] }), app: string({ enum: ["trash"] }) }),
      Version: object({ app: string({ enum: ["trash"] }), version: string() }),
      Readiness: object({ status: string({ enum: ["ready"] }), app: string({ enum: ["trash"] }), version: string(), storage: string({ enum: ["postgresql"] }) }),
      Status: object({ app: string(), version: string(), station: { ...ref("Station"), nullable: true }, retentionDays: integer(90, 90), listLimit: object({ default: integer(20, 20), max: integer(100, 100) }) }),
      StationInput: object(stationProperties), Station: object({ ...stationProperties, id: uuid, createdAt: date, updatedAt: date }),
      Artifact: artifact, Agent: agent, Capture: object(captureProperties, Object.keys(captureProperties).filter((key) => key !== "retentionDays")),
      Entry: object({ ...captureProperties, version: integer(1), stationName: string(), state, capturedAt: date, expiresAt: { ...date, nullable: true }, held: { type: "boolean" }, backup, downloadUntil: { ...date, nullable: true }, restoredAt: { ...date, nullable: true }, trashedAt: { ...date, nullable: true }, backupReceipt: { ...ref("BackupReceipt"), nullable: true } }, [...Object.keys(captureProperties), "version", "stationName", "state", "capturedAt", "expiresAt", "held", "backup"]),
      CompactEntry: object({ id: uuid, version: integer(1), path: string({ maxLength: 481 }), pathTruncated: { type: "boolean" }, kind: captureProperties.kind, bytes: integer(0), station: string(), capturedAt: date, expiresAt: { ...date, nullable: true }, held: { type: "boolean" }, backup, state }, ["id", "version", "path", "kind", "bytes", "station", "capturedAt", "expiresAt", "held", "backup", "state"]),
      EntryPage: object({ items: { type: "array", maxItems: 100, items: ref("CompactEntry") }, nextCursor: string({ nullable: true }) }),
      Transfer: object({ url: string({ format: "uri", description: "Sensitive short-lived signed S3 URL; never log." }), method: string({ enum: ["GET", "PUT"] }), headers: { type: "object", additionalProperties: { type: "string" } }, expiresAt: date }),
      UploadGrant: object({ entry: ref("Entry"), transfer: ref("Transfer") }),
      RecoveryGrant: object({ entry: ref("Entry"), lease, transfer: ref("Transfer") }),
      BackupGrant: object({ entry: ref("Entry"), job: lease, transfer: ref("Transfer") }), BackupReceipt: backupReceipt,
    },
  },
};
