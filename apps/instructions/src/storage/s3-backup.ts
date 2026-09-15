import { normalizeInstructionsS3Prefix } from "./s3-config.js";
import { assertSafeInstructionsObjectKey, type InstructionsObjectStore } from "./s3-object-store.js";

export const INSTRUCTIONS_BACKUP_MANIFEST_SCHEMA = "hasna.instructions.backup-object/v1" as const;

export interface InstructionsBackupManifest {
  schema: typeof INSTRUCTIONS_BACKUP_MANIFEST_SCHEMA;
  app: "instructions";
  backupId: string;
  payloadKey: string;
  manifestKey: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  createdAt: string;
}

export interface InstructionsBackupKeys {
  rootKey: string;
  payloadKey: string;
  manifestKey: string;
}

export interface InstructionsBackupPushInput {
  store: InstructionsObjectStore;
  prefix: string;
  backupId: string;
  bytes: Uint8Array;
  contentType?: string;
  createdAt?: Date;
}

export interface InstructionsBackupPushPlan extends InstructionsBackupKeys {
  operation: "push";
  dryRun: true;
  noNetwork: true;
  backupId: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
}

export interface InstructionsBackupPushResult {
  status: "created" | "existing";
  manifest: InstructionsBackupManifest;
}

export interface InstructionsBackupReadInput {
  store: InstructionsObjectStore;
  prefix: string;
  backupId: string;
}

export interface InstructionsBackupPullResult {
  manifest: InstructionsBackupManifest;
  bytes: Uint8Array;
}

export interface InstructionsBackupVerification {
  ok: true;
  backupId: string;
  payloadKey: string;
  manifestKey: string;
  sha256: string;
  sizeBytes: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function buildInstructionsBackupKeys(prefix: string, backupId: string): InstructionsBackupKeys {
  const normalizedPrefix = normalizeInstructionsS3Prefix(prefix);
  const encodedBackupId = encodeBackupId(backupId);
  const rootKey = `${normalizedPrefix}backups/${encodedBackupId}`;
  const keys = {
    rootKey,
    payloadKey: `${rootKey}/payload`,
    manifestKey: `${rootKey}/manifest.json`,
  };
  assertSafeInstructionsObjectKey(keys.payloadKey);
  assertSafeInstructionsObjectKey(keys.manifestKey);
  return keys;
}

/** Pure planning: intentionally does not inspect or call the supplied store. */
export async function planInstructionsBackupPush(
  input: InstructionsBackupPushInput,
): Promise<InstructionsBackupPushPlan> {
  const keys = buildInstructionsBackupKeys(input.prefix, input.backupId);
  return {
    operation: "push",
    dryRun: true,
    noNetwork: true,
    backupId: input.backupId,
    ...keys,
    sha256: sha256(input.bytes),
    sizeBytes: input.bytes.byteLength,
    contentType: normalizeContentType(input.contentType),
  };
}

export async function pushInstructionsBackup(
  input: InstructionsBackupPushInput,
): Promise<InstructionsBackupPushResult> {
  const plan = await planInstructionsBackupPush(input);
  const existingManifestBytes = await input.store.get(plan.manifestKey);
  if (existingManifestBytes) {
    const existingManifest = parseManifest(existingManifestBytes, plan, input.backupId);
    assertManifestMatchesPayload(existingManifest, input.bytes);
    const existingPayload = await input.store.get(existingManifest.payloadKey);
    if (!existingPayload) throw new Error("Instructions backup payload object is missing");
    assertBytesMatch(
      existingPayload,
      existingManifest.sha256,
      existingManifest.sizeBytes,
      "backup payload integrity",
    );
    return { status: "existing", manifest: existingManifest };
  }

  const existingPayload = await input.store.get(plan.payloadKey);
  if (existingPayload) {
    assertBytesMatch(existingPayload, plan.sha256, plan.sizeBytes, "existing immutable payload");
  } else {
    await input.store.put(plan.payloadKey, input.bytes, { contentType: plan.contentType });
  }

  const manifest: InstructionsBackupManifest = {
    schema: INSTRUCTIONS_BACKUP_MANIFEST_SCHEMA,
    app: "instructions",
    backupId: input.backupId,
    payloadKey: plan.payloadKey,
    manifestKey: plan.manifestKey,
    sha256: plan.sha256,
    sizeBytes: plan.sizeBytes,
    contentType: plan.contentType,
    createdAt: normalizeCreatedAt(input.createdAt),
  };
  await input.store.put(plan.manifestKey, serializeManifest(manifest), { contentType: "application/json" });
  return { status: "created", manifest };
}

export async function pullInstructionsBackup(
  input: InstructionsBackupReadInput,
): Promise<InstructionsBackupPullResult> {
  const keys = buildInstructionsBackupKeys(input.prefix, input.backupId);
  const manifestBytes = await input.store.get(keys.manifestKey);
  if (!manifestBytes) throw new Error("Instructions backup manifest object is missing");
  const manifest = parseManifest(manifestBytes, keys, input.backupId);
  const bytes = await input.store.get(manifest.payloadKey);
  if (!bytes) throw new Error("Instructions backup payload object is missing");
  assertBytesMatch(bytes, manifest.sha256, manifest.sizeBytes, "backup payload integrity");
  return { manifest, bytes };
}

export async function verifyInstructionsBackup(
  input: InstructionsBackupReadInput,
): Promise<InstructionsBackupVerification> {
  const result = await pullInstructionsBackup(input);
  return {
    ok: true,
    backupId: result.manifest.backupId,
    payloadKey: result.manifest.payloadKey,
    manifestKey: result.manifest.manifestKey,
    sha256: result.manifest.sha256,
    sizeBytes: result.manifest.sizeBytes,
  };
}

function encodeBackupId(backupId: string): string {
  const trimmed = backupId.trim();
  if (
    !trimmed ||
    trimmed.length > 128 ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("\\") ||
    CONTROL_CHARACTERS.test(trimmed)
  ) {
    throw new Error("Instructions backup id is invalid");
  }
  return encodeURIComponent(trimmed);
}

function normalizeContentType(value: string | undefined): string {
  const contentType = value?.trim() || "application/octet-stream";
  if (contentType.length > 255 || CONTROL_CHARACTERS.test(contentType)) {
    throw new Error("Instructions backup content type is invalid");
  }
  return contentType;
}

function normalizeCreatedAt(value: Date | undefined): string {
  const date = value ?? new Date();
  if (!Number.isFinite(date.getTime())) throw new Error("Instructions backup creation timestamp is invalid");
  return date.toISOString();
}

function serializeManifest(manifest: InstructionsBackupManifest): Uint8Array {
  return encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

function parseManifest(
  bytes: Uint8Array,
  keys: Pick<InstructionsBackupKeys, "payloadKey" | "manifestKey">,
  backupId: string,
): InstructionsBackupManifest {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error("Instructions backup manifest is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Instructions backup manifest is invalid");
  }
  const manifest = value as Partial<InstructionsBackupManifest>;
  if (
    manifest.schema !== INSTRUCTIONS_BACKUP_MANIFEST_SCHEMA ||
    manifest.app !== "instructions" ||
    manifest.backupId !== backupId ||
    manifest.payloadKey !== keys.payloadKey ||
    manifest.manifestKey !== keys.manifestKey ||
    typeof manifest.sha256 !== "string" ||
    !SHA256_PATTERN.test(manifest.sha256) ||
    typeof manifest.sizeBytes !== "number" ||
    !Number.isSafeInteger(manifest.sizeBytes) ||
    manifest.sizeBytes < 0 ||
    typeof manifest.contentType !== "string" ||
    !manifest.contentType ||
    typeof manifest.createdAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.createdAt))
  ) {
    throw new Error("Instructions backup manifest failed validation");
  }
  assertSafeInstructionsObjectKey(manifest.payloadKey);
  assertSafeInstructionsObjectKey(manifest.manifestKey);
  return manifest as InstructionsBackupManifest;
}

function assertManifestMatchesPayload(manifest: InstructionsBackupManifest, bytes: Uint8Array): void {
  const digest = sha256(bytes);
  if (manifest.sha256 !== digest || manifest.sizeBytes !== bytes.byteLength) {
    throw new Error("Instructions backup is immutable; the existing backup id refers to different bytes");
  }
}

function assertBytesMatch(bytes: Uint8Array, expectedSha256: string, expectedSize: number, label: string): void {
  if (bytes.byteLength !== expectedSize || sha256(bytes) !== expectedSha256) {
    throw new Error(`Instructions ${label} check failed`);
  }
}

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}
