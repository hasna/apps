import { createReadStream, copyFileSync, existsSync, mkdirSync, statSync, renameSync } from "fs";
import { dirname, join, basename } from "path";
import { pathToFileURL } from "url";
import { lookup as mimeLookup } from "mime-types";
import { getDataDir } from "../db/database.js";
import {
  createFileAccessEvent,
  createFileAssetConvergent,
  createFileLink,
  createFileUploadIntent,
  getFileAsset,
  getFileAssetByIdempotencyKey,
  getFileUploadIntent,
  getFileUploadIntentForAsset,
  listFileAccessEvents,
  listFileAssets,
  listFileLinks,
  markFileUploadIntentCompleted,
  updateFileAssetStatus,
  type ListFileAssetsOptions,
} from "../db/evidence.js";
import { copyS3Object, deleteFromS3, getPresignedPutUrl, getPresignedUrl, headS3Object, uploadBufferToS3 } from "./s3.js";
import { sha256Buffer, sha256File } from "./hasher.js";
import {
  buildEvidenceManifest,
  buildEvidenceManifestKey,
  buildEvidenceObjectKey,
} from "./artifact-keys.js";
import type {
  CreateFileAccessEventInput,
  CreateFileAssetInput,
  CreateFileLinkInput,
  FileAccessEvent,
  FileAsset,
  FileLink,
  FileScanStatus,
  FileStorageProvider,
  FileUploadIntent,
  S3Config,
  Source,
} from "../types/index.js";

/**
 * The DB seam behind evidence orchestration. There are two implementations:
 *
 *   - the on-box `db/evidence.ts` sqlite functions ({@link sqliteEvidenceDb},
 *     the default — used by the {@link LocalStore} and CLI/MCP on the local
 *     transport);
 *   - the Postgres functions in `server/pg-store.ts`, bound by the `/v1`
 *     evidence routes so the files service writes the shared vault.
 *
 * Every orchestration function below routes its metadata reads/writes through
 * this seam so the SAME choreography drives both transports — never a second,
 * transport-specific code path. Methods may be sync (sqlite) or async
 * (Postgres); the orchestration awaits them uniformly.
 */
export interface CreateUploadIntentInput {
  id?: string;
  asset_id: string;
  expires_at: string;
  expected_checksum: string;
  expected_checksum_algorithm: string;
  expected_size: number;
  required_headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface UpdateFileAssetStatusInput {
  id: string;
  status: FileAsset["status"];
  scan_status?: FileScanStatus;
  verified?: boolean;
}

export interface EvidenceDb {
  createFileAsset(input: CreateFileAssetInput): { asset: FileAsset; created: boolean } | Promise<{ asset: FileAsset; created: boolean }>;
  getFileAsset(id: string): FileAsset | null | Promise<FileAsset | null>;
  getFileAssetByIdempotencyKey(
    orgId: string,
    app: string,
    idempotencyKey: string,
  ): FileAsset | null | Promise<FileAsset | null>;
  createFileUploadIntent(input: CreateUploadIntentInput): FileUploadIntent | Promise<FileUploadIntent>;
  getFileUploadIntent(id: string): FileUploadIntent | null | Promise<FileUploadIntent | null>;
  getFileUploadIntentForAsset(assetId: string): FileUploadIntent | null | Promise<FileUploadIntent | null>;
  markFileUploadIntentCompleted(id: string): FileUploadIntent | null | Promise<FileUploadIntent | null>;
  updateFileAssetStatus(input: UpdateFileAssetStatusInput): FileAsset | null | Promise<FileAsset | null>;
  createFileLink(input: CreateFileLinkInput): FileLink | Promise<FileLink>;
  createFileAccessEvent(input: CreateFileAccessEventInput): FileAccessEvent | Promise<FileAccessEvent>;
}

/** Default (on-box sqlite) evidence DB seam. */
export const sqliteEvidenceDb: EvidenceDb = {
  createFileAsset: createFileAssetConvergent,
  getFileAsset,
  getFileAssetByIdempotencyKey,
  createFileUploadIntent,
  getFileUploadIntent,
  getFileUploadIntentForAsset,
  markFileUploadIntentCompleted,
  updateFileAssetStatus,
  createFileLink,
  createFileAccessEvent,
};

export interface EvidenceStorageOptions {
  provider?: FileStorageProvider;
  bucket?: string;
  region?: string;
  profile?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  prefix?: string;
  localRoot?: string;
}

export interface CreateEvidenceUploadInput {
  org_id: string;
  company_id?: string;
  app: string;
  kind: string;
  original_name: string;
  content_type?: string;
  size: number;
  checksum: string;
  checksum_algorithm?: "sha256";
  classification?: string;
  version?: number;
  provenance_type?: string;
  provenance_id?: string;
  provenance_ref?: string;
  external_references?: string[];
  idempotency_key?: string;
  retention_until?: string;
  retention_policy?: string;
  storage_class?: string;
  legal_hold?: boolean;
  immutable?: boolean;
  metadata?: Record<string, unknown>;
  expires_in_seconds?: number;
}

export interface EvidenceUploadResult {
  asset: FileAsset;
  intent: FileUploadIntent;
  replayed: boolean;
}

export interface EvidenceCredentialOutputOptions {
  includeUploadUrl?: boolean;
}

/**
 * Remove the credential-bearing destination from an upload result before it
 * crosses a completed/high-level command boundary. The low-level intent
 * creator still needs the URL long enough for a client to upload the bytes,
 * but callers must opt in before that URL is emitted to logs or JSON output.
 */
export function redactEvidenceUploadCredentials(result: EvidenceUploadResult): EvidenceUploadResult {
  const intent = { ...result.intent };
  delete intent.upload_url;
  return { asset: result.asset, intent, replayed: result.replayed };
}

export interface EvidenceDownloadGrant {
  asset: FileAsset;
  url: string;
  expires_at: string;
}

// SECURITY: this OSS package must never ship a literal internal S3 bucket
// name. There is no default bucket — operators must configure one via
// HASNA_FILES_S3_BUCKET / HASNA_FILES_EVIDENCE_BUCKET (env) or an explicit
// --bucket / `bucket` override; evidence storage calls fail clearly (never
// silently write to the wrong place) when neither is set.
export const DEFAULT_EVIDENCE_S3_BUCKET = "";
export const DEFAULT_EVIDENCE_S3_REGION = "us-east-1";

/**
 * Evidence storage options, env-resolved.
 *
 * Bucket selection: `HASNA_FILES_S3_BUCKET` is the shared files bucket;
 * `HASNA_FILES_EVIDENCE_BUCKET` (the `EVIDENCE_S3_BUCKET` alias) is the
 * legacy dedicated-evidence bucket. Either works — evidence object keys are
 * identical in both (`evidence/<org>/<sha256>` under the optional prefix), so
 * the alias exists purely to keep deployments that already configured a
 * separate bucket working, and consolidating into the shared bucket later is
 * a copy, never a rewrite (hasna/apps#1650).
 */

export function getEvidenceStorageOptions(overrides: EvidenceStorageOptions = {}): Required<EvidenceStorageOptions> {
  const provider = overrides.provider ?? (process.env.HASNA_FILES_EVIDENCE_STORAGE as FileStorageProvider | undefined) ?? "s3";
  return {
    provider,
    bucket: overrides.bucket ?? process.env.HASNA_FILES_S3_BUCKET ?? process.env.HASNA_FILES_EVIDENCE_BUCKET ?? DEFAULT_EVIDENCE_S3_BUCKET,
    region: overrides.region ?? process.env.HASNA_FILES_AWS_REGION ?? process.env.HASNA_FILES_S3_REGION ?? process.env.HASNA_FILES_EVIDENCE_REGION ?? DEFAULT_EVIDENCE_S3_REGION,
    profile: overrides.profile ?? process.env.HASNA_FILES_AWS_PROFILE ?? process.env.HASNA_FILES_EVIDENCE_AWS_PROFILE ?? process.env.AWS_PROFILE ?? "",
    endpoint: overrides.endpoint ?? process.env.HASNA_FILES_S3_ENDPOINT ?? process.env.HASNA_FILES_EVIDENCE_S3_ENDPOINT ?? "",
    forcePathStyle: overrides.forcePathStyle ?? envBoolean("HASNA_FILES_S3_FORCE_PATH_STYLE") ?? envBoolean("HASNA_FILES_EVIDENCE_S3_FORCE_PATH_STYLE") ?? false,
    prefix: trimSlashes(overrides.prefix ?? process.env.HASNA_FILES_S3_PREFIX ?? process.env.HASNA_FILES_EVIDENCE_PREFIX ?? ""),
    localRoot: overrides.localRoot ?? process.env.HASNA_FILES_EVIDENCE_LOCAL_ROOT ?? join(getDataDir(), "evidence"),
  };
}

/**
 * Canonical content-addressed evidence object key (hasna/apps#1650):
 * `<prefix>/evidence/<org_id>/<sha256>[.<ext>]`. Deterministic in
 * (org, content) — a duplicate upload for the same org lands on the SAME key,
 * so it never produces a second object. The extension is operator tooling
 * only and never participates in addressing. Defined in src/lib/artifact-keys.ts
 * and re-exported here to keep the public export name stable.
 */
export { buildEvidenceObjectKey, buildEvidenceManifestKey, isLegacyEvidenceKey } from "./artifact-keys.js";

export async function createEvidenceUploadIntent(
  input: CreateEvidenceUploadInput,
  storageOverrides: EvidenceStorageOptions = {},
  db: EvidenceDb = sqliteEvidenceDb,
): Promise<EvidenceUploadResult> {
  validateUploadInput(input);
  const storage = getEvidenceStorageOptions(storageOverrides);
  const contentType = input.content_type ?? (mimeLookup(input.original_name) || "application/octet-stream").toString();
  const normalizedInput = normalizeEvidenceInput(input, contentType);

  if (normalizedInput.idempotency_key) {
    const existing = await db.getFileAssetByIdempotencyKey(
      normalizedInput.org_id,
      normalizedInput.app,
      normalizedInput.idempotency_key,
    );
    if (existing) {
      assertImmutableReplay(existing, normalizedInput, storage);
      const intent = await db.getFileUploadIntentForAsset(existing.id);
      if (!intent) throw new Error(`Upload intent not found for replayed evidence asset: ${existing.id}`);
      const replayIntent = await withEvidenceUploadUrl(existing, intent, storage, input.expires_in_seconds ?? 600);
      await db.createFileAccessEvent({
        asset_id: existing.id,
        org_id: existing.org_id,
        company_id: existing.company_id,
        app: existing.app,
        action: "create_upload",
        metadata: { intent_id: intent.id, storage_provider: storage.provider, replayed: true },
      });
      return { asset: existing, intent: replayIntent, replayed: true };
    }
  }

  const assetId = normalizedInput.idempotency_key
    ? deterministicEvidenceId("asset", normalizedInput.org_id, normalizedInput.app, normalizedInput.idempotency_key)
    : `asset_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const objectKey = buildEvidenceObjectKey({
    org_id: normalizedInput.org_id,
    checksum: normalizedInput.checksum,
    original_name: normalizedInput.original_name,
    prefix: storage.prefix,
  });
  const quarantineKey = `quarantine/${objectKey}`;
  const created = await db.createFileAsset({
    ...normalizedInput,
    id: assetId,
    storage_provider: storage.provider,
    // `bucket` is the storage container for the asset. For s3 that is the S3
    // bucket; for local it is the resolved on-box evidence root. Persisting it
    // here is what lets a LATER `complete`/`verify`/`sign-download` invocation
    // locate the bytes without re-passing `--local-root` — otherwise the root
    // is re-resolved to the default and the object appears missing.
    bucket: storage.provider === "s3" ? storage.bucket : storage.localRoot,
    region: storage.provider === "s3" ? storage.region : undefined,
    object_key: objectKey,
    quarantine_key: quarantineKey,
  });
  const asset = created.asset;

  if (created.created && asset.id !== assetId) {
    throw new Error("Evidence asset id allocation mismatch");
  }
  if (!created.created) assertImmutableReplay(asset, normalizedInput, storage);

  const expiresAt = new Date(Date.now() + (input.expires_in_seconds ?? 600) * 1000).toISOString();
  const requiredHeaders = makeRequiredUploadHeaders(asset);
  const intent = await db.createFileUploadIntent({
    id: normalizedInput.idempotency_key ? deterministicEvidenceId("upl", asset.id) : undefined,
    asset_id: asset.id,
    expires_at: expiresAt,
    expected_checksum: asset.checksum,
    expected_checksum_algorithm: asset.checksum_algorithm,
    expected_size: asset.size,
    required_headers: requiredHeaders,
  });

  const uploadIntent = await withEvidenceUploadUrl(asset, intent, storage, input.expires_in_seconds ?? 600);

  await db.createFileAccessEvent({
    asset_id: asset.id,
    org_id: asset.org_id,
    company_id: asset.company_id,
    app: asset.app,
    action: "create_upload",
    metadata: { intent_id: intent.id, storage_provider: storage.provider, replayed: !created.created },
  });

  return { asset, intent: uploadIntent, replayed: !created.created };
}

export type UploadEvidenceFileInput = Omit<CreateEvidenceUploadInput, "size" | "checksum" | "content_type" | "original_name"> & {
  path: string;
  original_name?: string;
};

export async function uploadEvidenceFile(
  input: UploadEvidenceFileInput,
  storageOverrides: EvidenceStorageOptions = {},
  db: EvidenceDb = sqliteEvidenceDb,
): Promise<EvidenceUploadResult> {
  if (!existsSync(input.path)) throw new Error(`File not found: ${input.path}`);
  const stat = statSync(input.path);
  const result = await createEvidenceUploadIntent({
    ...input,
    original_name: input.original_name ?? basename(input.path),
    content_type: (mimeLookup(input.path) || "application/octet-stream").toString(),
    size: stat.size,
    checksum: sha256File(input.path),
    checksum_algorithm: "sha256",
  }, storageOverrides, db);

  if (result.replayed && result.asset.status === "verified") {
    return redactEvidenceUploadCredentials(result);
  }

  const storage = getEvidenceStorageOptions(storageOverrides);
  const key = result.asset.quarantine_key ?? result.asset.object_key;
  if (storage.provider === "s3") {
    await uploadBufferToS3(
      makeEvidenceSource(storage),
      createReadStream(input.path),
      key,
      result.asset.content_type,
      result.asset.size,
      evidenceMetadata(result.asset),
      result.asset.checksum,
    );
  } else {
    const dest = localObjectPath(storage, key, result.asset);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(input.path, dest);
  }

  const completed = await completeEvidenceUpload(result.intent.id, storageOverrides, db);
  return redactEvidenceUploadCredentials({
    asset: completed,
    intent: (await db.getFileUploadIntent(result.intent.id))!,
    replayed: result.replayed,
  });
}

export async function completeEvidenceUpload(
  intentId: string,
  storageOverrides: EvidenceStorageOptions = {},
  db: EvidenceDb = sqliteEvidenceDb,
): Promise<FileAsset> {
  const intent = await db.getFileUploadIntent(intentId);
  if (!intent) throw new Error(`Upload intent not found: ${intentId}`);
  if (intent.status === "completed") {
    const completed = await db.getFileAsset(intent.asset_id);
    if (completed?.status === "verified") return completed;
  }
  if (intent.status !== "pending") throw new Error(`Upload intent is not pending: ${intent.status}`);
  if (Date.parse(intent.expires_at) < Date.now()) throw new Error(`Upload intent expired: ${intentId}`);

  const asset = await db.getFileAsset(intent.asset_id);
  if (!asset) throw new Error(`File asset not found: ${intent.asset_id}`);
  const storage = getEvidenceStorageOptions(storageOverrides);
  const quarantineKey = asset.quarantine_key ?? asset.object_key;

  if (asset.storage_provider === "s3") {
    const source = makeEvidenceSource(storage, asset);
    const head = await headS3Object(source, quarantineKey);
    if (!head) throw new Error(`Uploaded object not found: ${quarantineKey}`);
    assertUploadedObjectMatches(asset, head.size, head.metadata.checksum ?? head.checksum_sha256);
    if (quarantineKey !== asset.object_key) {
      // Content-addressed dedup: when the canonical object already exists with
      // the same checksum (a duplicate upload), skip the copy — only the
      // quarantine object is removed, so a duplicate never leaves a second
      // object (hasna/apps#1650).
      const finalHead = await headS3Object(source, asset.object_key);
      const finalAlreadyMatches = finalHead !== null && sameChecksum(asset, finalHead.metadata.checksum ?? finalHead.checksum_sha256);
      if (!finalAlreadyMatches) {
        await copyS3Object(source, quarantineKey, asset.object_key, evidenceMetadata(asset), asset.content_type);
      }
      await deleteFromS3(source, quarantineKey);
    }
    // Per-asset manifest: content address + provenance summary so the bucket
    // listing is restorable without the database.
    const manifestBytes = Buffer.from(JSON.stringify(buildEvidenceManifest(asset, asset.object_key), null, 2));
    await uploadBufferToS3(
      source,
      manifestBytes,
      buildEvidenceManifestKey({ org_id: asset.org_id, asset_id: asset.id, prefix: storage.prefix }),
      "application/json",
      manifestBytes.byteLength,
      undefined,
      sha256Buffer(manifestBytes),
    );
  } else {
    const sourcePath = localObjectPath(storage, quarantineKey, asset);
    if (!existsSync(sourcePath)) throw new Error(`Uploaded file not found: ${sourcePath}`);
    assertUploadedObjectMatches(asset, statSync(sourcePath).size, sha256File(sourcePath));
    const finalPath = localObjectPath(storage, asset.object_key, asset);
    mkdirSync(dirname(finalPath), { recursive: true });
    renameSync(sourcePath, finalPath);
  }

  await db.markFileUploadIntentCompleted(intent.id);
  const verified = await db.updateFileAssetStatus({ id: asset.id, status: "verified", scan_status: "skipped", verified: true });
  if (!verified) throw new Error(`Failed to verify file asset: ${asset.id}`);
  await db.createFileAccessEvent({
    asset_id: verified.id,
    org_id: verified.org_id,
    company_id: verified.company_id,
    app: verified.app,
    action: "complete_upload",
    metadata: { intent_id: intent.id },
  });
  return verified;
}

export async function linkEvidenceAsset(input: CreateFileLinkInput, db: EvidenceDb = sqliteEvidenceDb): Promise<FileLink> {
  const link = await db.createFileLink(input);
  await db.createFileAccessEvent({
    asset_id: input.asset_id,
    org_id: input.org_id,
    company_id: input.company_id,
    app: input.app,
    action: "link",
    metadata: { source_type: input.source_type, source_id: input.source_id, kind: input.kind },
  });
  return link;
}

export interface SignEvidenceDownloadInput {
  asset_id: string;
  actor_id?: string;
  purpose?: string;
  expires_in_seconds?: number;
}

export async function signEvidenceDownload(
  input: SignEvidenceDownloadInput,
  storageOverrides: EvidenceStorageOptions = {},
  db: EvidenceDb = sqliteEvidenceDb,
): Promise<EvidenceDownloadGrant> {
  const asset = await db.getFileAsset(input.asset_id);
  if (!asset) throw new Error(`File asset not found: ${input.asset_id}`);
  if (asset.status !== "verified") throw new Error(`File asset is not verified: ${asset.status}`);

  const storage = getEvidenceStorageOptions(storageOverrides);
  const expiresIn = input.expires_in_seconds ?? 300;
  const url = asset.storage_provider === "s3"
    ? await getPresignedUrl(makeEvidenceSource(storage, asset), asset.object_key, expiresIn)
    : pathToFileURL(localObjectPath(storage, asset.object_key, asset)).toString();
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  await db.createFileAccessEvent({
    asset_id: asset.id,
    org_id: asset.org_id,
    company_id: asset.company_id,
    app: asset.app,
    actor_id: input.actor_id,
    action: "sign_download",
    purpose: input.purpose,
    metadata: { expires_at: expiresAt },
  });

  return { asset, url, expires_at: expiresAt };
}

export interface EvidenceVerifyResult {
  asset: FileAsset;
  ok: boolean;
  diagnostics: string[];
}

export async function verifyEvidenceAsset(
  assetId: string,
  storageOverrides: EvidenceStorageOptions = {},
  db: EvidenceDb = sqliteEvidenceDb,
): Promise<EvidenceVerifyResult> {
  const asset = await db.getFileAsset(assetId);
  if (!asset) throw new Error(`File asset not found: ${assetId}`);
  const storage = getEvidenceStorageOptions(storageOverrides);
  const diagnostics: string[] = [];

  if (asset.storage_provider === "s3") {
    const head = await headS3Object(makeEvidenceSource(storage, asset), asset.object_key);
    if (!head) diagnostics.push("object_missing");
    else collectObjectDiagnostics(asset, head.size, head.metadata.checksum ?? head.checksum_sha256, diagnostics);
  } else {
    const path = localObjectPath(storage, asset.object_key, asset);
    if (!existsSync(path)) diagnostics.push("object_missing");
    else collectObjectDiagnostics(asset, statSync(path).size, sha256File(path), diagnostics);
  }

  await db.createFileAccessEvent({
    asset_id: asset.id,
    org_id: asset.org_id,
    company_id: asset.company_id,
    app: asset.app,
    action: "verify",
    metadata: { ok: diagnostics.length === 0, diagnostics },
  });

  return { asset, ok: diagnostics.length === 0, diagnostics };
}

export { getFileAsset, listFileAccessEvents, listFileAssets, listFileLinks };
export type { ListFileAssetsOptions, FileAccessEvent };

function validateUploadInput(input: CreateEvidenceUploadInput): void {
  if (!input.org_id.trim()) throw new Error("org_id is required");
  if (!input.app.trim()) throw new Error("app is required");
  if (!input.kind.trim()) throw new Error("kind is required");
  if (!input.original_name.trim()) throw new Error("original_name is required");
  if (!Number.isInteger(input.size) || input.size < 0) throw new Error("size must be an integer >= 0");
  if ((input.checksum_algorithm ?? "sha256") !== "sha256") throw new Error("Only sha256 checksums are supported for evidence assets");
  if (!/^[a-f0-9]{64}$/i.test(input.checksum)) throw new Error("checksum must be a sha256 hex digest");
  if (input.retention_until && Number.isNaN(Date.parse(input.retention_until))) throw new Error("retention_until must be an ISO date string");
  if (input.storage_class && !/^[A-Za-z0-9_.-]{1,64}$/.test(input.storage_class)) throw new Error("storage_class contains unsupported characters");
  if (input.immutable === false) throw new Error("Evidence assets are immutable and cannot set immutable=false");
  if (input.version !== undefined && (!Number.isInteger(input.version) || input.version < 1)) {
    throw new Error("version must be an integer >= 1");
  }
  if (input.provenance_type !== undefined && !input.provenance_type.trim()) throw new Error("provenance_type cannot be empty");
  if (input.provenance_id !== undefined && !input.provenance_id.trim()) throw new Error("provenance_id cannot be empty");
  if (input.idempotency_key !== undefined && !input.idempotency_key.trim()) throw new Error("idempotency_key cannot be empty");
  if (input.external_references?.some((ref) => !ref.trim())) throw new Error("external_references cannot contain empty values");
}

function normalizeEvidenceInput(
  input: CreateEvidenceUploadInput,
  contentType: string,
): CreateEvidenceUploadInput & {
  content_type: string;
  checksum_algorithm: "sha256";
  classification: string;
  version: number;
  provenance_type: string;
  provenance_id: string;
  external_references: string[];
  immutable: true;
} {
  return {
    ...input,
    content_type: contentType,
    checksum_algorithm: input.checksum_algorithm ?? "sha256",
    classification: input.classification ?? "general",
    version: input.version ?? 1,
    provenance_type: input.provenance_type?.trim() || "direct_upload",
    provenance_id: input.provenance_id?.trim() || input.idempotency_key?.trim() || input.checksum.toLowerCase(),
    provenance_ref: input.provenance_ref?.trim() || undefined,
    external_references: [...new Set((input.external_references ?? []).map((ref) => ref.trim()))].sort(),
    idempotency_key: input.idempotency_key?.trim() || undefined,
    immutable: true,
    metadata: input.metadata ?? {},
  };
}

async function withEvidenceUploadUrl(
  asset: FileAsset,
  intent: FileUploadIntent,
  storage: Required<EvidenceStorageOptions>,
  expiresIn: number,
): Promise<FileUploadIntent> {
  const requiredHeaders = makeRequiredUploadHeaders(asset);
  if (intent.status !== "pending") return intent;
  const key = asset.quarantine_key ?? asset.object_key;
  const uploadUrl = storage.provider === "s3"
    ? await getPresignedPutUrl(makeEvidenceSource(storage, asset), key, {
        expiresIn,
        contentType: asset.content_type,
        contentLength: asset.size,
        checksumSha256: asset.checksum,
        metadata: evidenceMetadata(asset),
      })
    : pathToFileURL(localObjectPath(storage, key, asset)).toString();
  return { ...intent, upload_url: uploadUrl, required_headers: requiredHeaders };
}

function assertImmutableReplay(
  existing: FileAsset,
  desired: ReturnType<typeof normalizeEvidenceInput>,
  storage: Required<EvidenceStorageOptions>,
): void {
  const expected: Record<string, unknown> = {
    org_id: desired.org_id,
    company_id: desired.company_id,
    app: desired.app,
    kind: desired.kind,
    classification: desired.classification,
    version: desired.version,
    provenance_type: desired.provenance_type,
    provenance_id: desired.provenance_id,
    provenance_ref: desired.provenance_ref,
    external_references: desired.external_references,
    original_name: desired.original_name,
    content_type: desired.content_type,
    size: desired.size,
    checksum: desired.checksum.toLowerCase(),
    checksum_algorithm: desired.checksum_algorithm,
    storage_provider: storage.provider,
    bucket: storage.provider === "s3" ? storage.bucket : storage.localRoot,
    region: storage.provider === "s3" ? storage.region : undefined,
    retention_until: desired.retention_until,
    retention_policy: desired.retention_policy,
    storage_class: desired.storage_class,
    legal_hold: desired.legal_hold ?? false,
    immutable: true,
    metadata: desired.metadata,
  };
  const actual: Record<string, unknown> = {
    org_id: existing.org_id,
    company_id: existing.company_id,
    app: existing.app,
    kind: existing.kind,
    classification: existing.classification,
    version: existing.version,
    provenance_type: existing.provenance_type,
    provenance_id: existing.provenance_id,
    provenance_ref: existing.provenance_ref,
    external_references: [...existing.external_references].sort(),
    original_name: existing.original_name,
    content_type: existing.content_type,
    size: existing.size,
    checksum: existing.checksum.toLowerCase(),
    checksum_algorithm: existing.checksum_algorithm,
    storage_provider: existing.storage_provider,
    bucket: existing.bucket,
    region: existing.region,
    retention_until: existing.retention_until,
    retention_policy: existing.retention_policy,
    storage_class: existing.storage_class,
    legal_hold: existing.legal_hold,
    immutable: existing.immutable,
    metadata: existing.metadata,
  };
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(`Immutable evidence replay conflict for idempotency key: ${desired.idempotency_key}`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function deterministicEvidenceId(prefix: "asset" | "upl", ...parts: string[]): string {
  const digest = sha256Buffer(Buffer.from(parts.join("\u0000"), "utf8"));
  return `${prefix}_${digest.slice(0, prefix === "asset" ? 16 : 12)}`;
}

function makeEvidenceSource(storage: Required<EvidenceStorageOptions>, asset?: FileAsset): Source {
  const config: S3Config = {};
  if (storage.profile) config.profile = storage.profile;
  if (storage.endpoint) config.endpoint = storage.endpoint;
  if (storage.forcePathStyle) config.forcePathStyle = true;
  return {
    id: "src_evidence",
    name: "hasna-files-evidence",
    type: "s3",
    bucket: asset?.bucket ?? storage.bucket,
    prefix: storage.prefix || undefined,
    region: asset?.region ?? storage.region,
    config,
    machine_id: "evidence",
    enabled: true,
    file_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function evidenceMetadata(asset: FileAsset): Record<string, string> {
  return {
    "asset-id": asset.id,
    "org-id": asset.org_id,
    "app": asset.app,
    "kind": asset.kind,
    "checksum": asset.checksum,
    "checksum-algorithm": asset.checksum_algorithm,
    ...(asset.storage_class ? { "storage-class": asset.storage_class } : {}),
  };
}

function makeRequiredUploadHeaders(asset: FileAsset): Record<string, string> {
  return {
    "content-type": asset.content_type,
    "x-amz-checksum-sha256": Buffer.from(asset.checksum, "hex").toString("base64"),
    "x-amz-meta-asset-id": asset.id,
    "x-amz-meta-org-id": asset.org_id,
    "x-amz-meta-app": asset.app,
    "x-amz-meta-kind": asset.kind,
    "x-amz-meta-checksum": asset.checksum,
    "x-amz-meta-checksum-algorithm": asset.checksum_algorithm,
  };
}

function assertUploadedObjectMatches(asset: FileAsset, size: number, checksum?: string): void {
  const diagnostics: string[] = [];
  collectObjectDiagnostics(asset, size, checksum, diagnostics);
  if (diagnostics.length) throw new Error(`Uploaded object failed verification: ${diagnostics.join(", ")}`);
}

function collectObjectDiagnostics(asset: FileAsset, size: number, checksum: string | undefined, diagnostics: string[]): void {
  if (size !== asset.size) diagnostics.push(`size_mismatch:${size}:expected:${asset.size}`);
  if (!checksum) diagnostics.push("checksum_missing");
  else if (!sameChecksum(asset, checksum)) {
    diagnostics.push("checksum_mismatch");
  }
}

function sameChecksum(asset: FileAsset, checksum: string | undefined): boolean {
  if (!checksum) return false;
  return checksum === asset.checksum || checksum === Buffer.from(asset.checksum, "hex").toString("base64");
}

/**
 * Resolve the on-disk path for a local evidence object. The root is taken from
 * the asset's persisted container (`asset.bucket`, stamped at intent creation)
 * when available so that byte resolution is stable across CLI invocations, and
 * only falls back to the freshly-resolved `storage.localRoot` when the asset
 * carries no persisted root (e.g. the intent-creation call itself).
 */
function localObjectPath(storage: Required<EvidenceStorageOptions>, key: string, asset?: Pick<FileAsset, "bucket">): string {
  return join(asset?.bucket ?? storage.localRoot, key);
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function envBoolean(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return undefined;
}
