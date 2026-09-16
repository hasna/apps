import { normalizeInstructionsS3Prefix } from "./s3-config.js";
import {
  assertSafeInstructionsObjectKey,
  assertSafeInstructionsObjectVersionId,
  type InstructionsObjectCreateResult,
  type InstructionsObjectStore,
} from "./s3-object-store.js";

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

export interface InstructionsBackupObjectVersions {
  payloadVersionId: string;
  manifestVersionId: string;
}

export interface InstructionsBackupPushResult {
  status: "created" | "existing";
  manifest: InstructionsBackupManifest;
  versions?: InstructionsBackupObjectVersions;
}

export interface InstructionsBackupReadInput {
  store: InstructionsObjectStore;
  prefix: string;
  backupId: string;
  /** Exact immutable payload version authority. Must be paired with manifestVersionId. */
  payloadVersionId?: string;
  /** Exact immutable manifest version authority. Must be paired with payloadVersionId. */
  manifestVersionId?: string;
}

export interface InstructionsBackupPullResult {
  manifest: InstructionsBackupManifest;
  bytes: Uint8Array;
  versionPinned: boolean;
  versions?: InstructionsBackupObjectVersions;
}

export interface InstructionsBackupVerification {
  ok: true;
  backupId: string;
  payloadKey: string;
  manifestKey: string;
  sha256: string;
  sizeBytes: number;
  versionPinned: boolean;
  versions?: InstructionsBackupObjectVersions;
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
    assertBytesMatch(existingPayload, existingManifest.sha256, existingManifest.sizeBytes, "backup payload integrity");
    return {
      status: "existing",
      manifest: existingManifest,
      ...await resolveCurrentVersions(input.store, existingManifest),
    };
  }

  const payloadCreate = await createImmutableObject(input.store, plan.payloadKey, input.bytes, plan.contentType);
  if (payloadCreate.status === "existing") {
    const existingPayload = await input.store.get(plan.payloadKey);
    if (!existingPayload) throw new Error("Instructions backup payload object is missing");
    assertBytesMatch(existingPayload, plan.sha256, plan.sizeBytes, "existing immutable payload");
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
  const manifestCreate = await createImmutableObject(
    input.store,
    plan.manifestKey,
    serializeManifest(manifest),
    "application/json",
  );
  if (manifestCreate.status === "created") {
    const versions = completeCreatedVersions(payloadCreate, manifestCreate);
    return { status: "created", manifest, ...(versions ? { versions } : {}) };
  }

  const racedManifestBytes = await input.store.get(plan.manifestKey);
  if (!racedManifestBytes) throw new Error("Instructions backup manifest object is missing");
  const existingManifest = parseManifest(racedManifestBytes, plan, input.backupId);
  assertManifestMatchesPayload(existingManifest, input.bytes);
  const existingPayload = await input.store.get(existingManifest.payloadKey);
  if (!existingPayload) throw new Error("Instructions backup payload object is missing");
  assertBytesMatch(existingPayload, existingManifest.sha256, existingManifest.sizeBytes, "backup payload integrity");
  return {
    status: "existing",
    manifest: existingManifest,
    ...await resolveCurrentVersions(input.store, existingManifest),
  };
}

export async function pullInstructionsBackup(
  input: InstructionsBackupReadInput,
): Promise<InstructionsBackupPullResult> {
  const versions = normalizeReadVersions(input);
  const keys = buildInstructionsBackupKeys(input.prefix, input.backupId);
  const manifestBytes = await input.store.get(
    keys.manifestKey,
    versions ? { versionId: versions.manifestVersionId } : undefined,
  );
  if (!manifestBytes) throw new Error("Instructions backup manifest object is missing");
  const manifest = parseManifest(manifestBytes, keys, input.backupId);
  const bytes = await input.store.get(
    manifest.payloadKey,
    versions ? { versionId: versions.payloadVersionId } : undefined,
  );
  if (!bytes) throw new Error("Instructions backup payload object is missing");
  assertBytesMatch(bytes, manifest.sha256, manifest.sizeBytes, "backup payload integrity");

  if (versions) {
    const [manifestMetadata, payloadMetadata] = await Promise.all([
      input.store.head(keys.manifestKey, { versionId: versions.manifestVersionId }),
      input.store.head(manifest.payloadKey, { versionId: versions.payloadVersionId }),
    ]);
    if (manifestMetadata?.versionId !== versions.manifestVersionId || payloadMetadata?.versionId !== versions.payloadVersionId) {
      throw new Error("Instructions backup immutable version authority check failed");
    }
    if (payloadMetadata.size !== manifest.sizeBytes) {
      throw new Error("Instructions backup payload version size check failed");
    }
  }

  return {
    manifest,
    bytes,
    versionPinned: Boolean(versions),
    ...(versions ? { versions } : {}),
  };
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
    versionPinned: result.versionPinned,
    ...(result.versions ? { versions: result.versions } : {}),
  };
}

async function createImmutableObject(
  store: InstructionsObjectStore,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<InstructionsObjectCreateResult> {
  if (!store.putIfAbsent) {
    throw new Error("Instructions object store does not support atomic immutable creation");
  }
  return store.putIfAbsent(key, bytes, { contentType });
}

function completeCreatedVersions(
  payload: InstructionsObjectCreateResult,
  manifest: InstructionsObjectCreateResult,
): InstructionsBackupObjectVersions | undefined {
  if (!payload.versionId || !manifest.versionId) return undefined;
  return { payloadVersionId: payload.versionId, manifestVersionId: manifest.versionId };
}

async function resolveCurrentVersions(
  store: InstructionsObjectStore,
  manifest: InstructionsBackupManifest,
): Promise<{ versions?: InstructionsBackupObjectVersions }> {
  const [payload, manifestObject] = await Promise.all([
    store.head(manifest.payloadKey),
    store.head(manifest.manifestKey),
  ]);
  if (!payload?.versionId || !manifestObject?.versionId) return {};
  return {
    versions: {
      payloadVersionId: payload.versionId,
      manifestVersionId: manifestObject.versionId,
    },
  };
}

function normalizeReadVersions(input: InstructionsBackupReadInput): InstructionsBackupObjectVersions | undefined {
  const payloadVersionId = input.payloadVersionId?.trim();
  const manifestVersionId = input.manifestVersionId?.trim();
  if (Boolean(payloadVersionId) !== Boolean(manifestVersionId)) {
    throw new Error("Instructions backup payload and manifest version ids must be provided together");
  }
  if (!payloadVersionId || !manifestVersionId) return undefined;
  assertSafeInstructionsObjectVersionId(payloadVersionId);
  assertSafeInstructionsObjectVersionId(manifestVersionId);
  return { payloadVersionId, manifestVersionId };
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
