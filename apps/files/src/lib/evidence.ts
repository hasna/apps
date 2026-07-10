import { createReadStream, copyFileSync, existsSync, mkdirSync, statSync, renameSync } from "fs";
import { dirname, join, basename } from "path";
import { pathToFileURL } from "url";
import { lookup as mimeLookup } from "mime-types";
import { getDataDir } from "../db/database.js";
import {
  createFileAccessEvent,
  createFileAsset,
  createFileLink,
  createFileUploadIntent,
  getFileAsset,
  getFileUploadIntent,
  listFileAccessEvents,
  listFileAssets,
  listFileLinks,
  markFileUploadIntentCompleted,
  updateFileAssetStatus,
  type ListFileAssetsOptions,
} from "../db/evidence.js";
import { copyS3Object, deleteFromS3, getPresignedPutUrl, getPresignedUrl, headS3Object, uploadBufferToS3 } from "./s3.js";
import { sha256File } from "./hasher.js";
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
 *     the default — used by the {@link LocalStore} and CLI/MCP in local mode);
 *   - the cloud Postgres functions in `server/pg-store.ts`, bound by the `/v1`
 *     evidence routes so the self-hosted service writes the shared vault.
 *
 * Every orchestration function below routes its metadata reads/writes through
 * this seam so the SAME choreography drives both transports — never a second,
 * mode-specific code path. Methods may be sync (sqlite) or async (Postgres); the
 * orchestration awaits them uniformly.
 */
export interface CreateUploadIntentInput {
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
  createFileAsset(input: CreateFileAssetInput): FileAsset | Promise<FileAsset>;
  getFileAsset(id: string): FileAsset | null | Promise<FileAsset | null>;
  createFileUploadIntent(input: CreateUploadIntentInput): FileUploadIntent | Promise<FileUploadIntent>;
  getFileUploadIntent(id: string): FileUploadIntent | null | Promise<FileUploadIntent | null>;
  markFileUploadIntentCompleted(id: string): FileUploadIntent | null | Promise<FileUploadIntent | null>;
  updateFileAssetStatus(input: UpdateFileAssetStatusInput): FileAsset | null | Promise<FileAsset | null>;
  createFileLink(input: CreateFileLinkInput): FileLink | Promise<FileLink>;
  createFileAccessEvent(input: CreateFileAccessEventInput): FileAccessEvent | Promise<FileAccessEvent>;
}

/** Default (on-box sqlite) evidence DB seam. */
export const sqliteEvidenceDb: EvidenceDb = {
  createFileAsset,
  getFileAsset,
  createFileUploadIntent,
  getFileUploadIntent,
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
}

/**
 * Safe receipt returned after an upload, or by agent-facing intent commands.
 * Transport URLs and required signing headers are deliberately absent.
 */
export interface EvidenceUploadReceipt {
  asset: Pick<FileAsset,
    | "id"
    | "status"
    | "scan_status"
    | "checksum"
    | "checksum_algorithm"
    | "size"
    | "storage_provider"
    | "verified_at"
  >;
  intent: Pick<FileUploadIntent,
    | "id"
    | "asset_id"
    | "expires_at"
    | "status"
    | "expected_checksum"
    | "expected_checksum_algorithm"
    | "expected_size"
    | "created_at"
    | "completed_at"
  >;
}

export function toEvidenceUploadReceipt(
  result: EvidenceUploadResult,
  status: FileUploadIntent["status"] = result.intent.status,
): EvidenceUploadReceipt {
  const { intent } = result;
  const { asset } = result;
  return {
    asset: {
      id: asset.id,
      status: asset.status,
      scan_status: asset.scan_status,
      checksum: asset.checksum,
      checksum_algorithm: asset.checksum_algorithm,
      size: asset.size,
      storage_provider: asset.storage_provider,
      verified_at: asset.verified_at,
    },
    intent: {
      id: intent.id,
      asset_id: intent.asset_id,
      expires_at: intent.expires_at,
      status,
      expected_checksum: intent.expected_checksum,
      expected_checksum_algorithm: intent.expected_checksum_algorithm,
      expected_size: intent.expected_size,
      created_at: intent.created_at,
      completed_at: intent.completed_at,
    },
  };
}

/** Redact query-bearing transport URLs before an error reaches a transcript. */
export function redactSensitiveTransportText(value: string): string {
  return value
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (candidate) => {
      const query = candidate.indexOf("?");
      return query === -1 ? candidate : "[REDACTED_TRANSPORT_URL]";
    })
    .replace(
      /(^|[?&\s])[^?&=\s]*(?:credential|signature|session|security[-_]?token)[^?&=\s]*=[^&\s]*/gi,
      "$1[REDACTED]",
    );
}

export interface EvidenceDownloadGrant {
  asset: FileAsset;
  url: string;
  expires_at: string;
}

export const DEFAULT_EVIDENCE_S3_BUCKET = "hasna-xyz-opensource-files-prod";
export const DEFAULT_EVIDENCE_S3_REGION = "us-east-1";

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

export function buildEvidenceObjectKey(input: {
  org_id: string;
  company_id?: string;
  app: string;
  kind: string;
  asset_id: string;
  original_name: string;
  prefix?: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return [
    trimSlashes(input.prefix ?? ""),
    "orgs",
    cleanSegment(input.org_id),
    "companies",
    cleanSegment(input.company_id ?? "_global"),
    cleanSegment(input.app),
    yyyy,
    mm,
    cleanSegment(input.kind),
    cleanSegment(input.asset_id),
    cleanFilename(input.original_name),
  ].filter(Boolean).join("/");
}

export async function createEvidenceUploadIntent(
  input: CreateEvidenceUploadInput,
  storageOverrides: EvidenceStorageOptions = {},
  db: EvidenceDb = sqliteEvidenceDb,
): Promise<EvidenceUploadResult> {
  validateUploadInput(input);
  const storage = getEvidenceStorageOptions(storageOverrides);
  const assetId = `asset_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const objectKey = buildEvidenceObjectKey({ ...input, asset_id: assetId, prefix: storage.prefix });
  const quarantineKey = `quarantine/${objectKey}`;
  const contentType = input.content_type ?? (mimeLookup(input.original_name) || "application/octet-stream").toString();
  const asset = await db.createFileAsset({
    ...input,
    id: assetId,
    content_type: contentType,
    checksum_algorithm: input.checksum_algorithm ?? "sha256",
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

  if (asset.id !== assetId) {
    throw new Error("Evidence asset id allocation mismatch");
  }

  const expiresAt = new Date(Date.now() + (input.expires_in_seconds ?? 600) * 1000).toISOString();
  const requiredHeaders = makeRequiredUploadHeaders(asset);
  const intent = await db.createFileUploadIntent({
    asset_id: asset.id,
    expires_at: expiresAt,
    expected_checksum: asset.checksum,
    expected_checksum_algorithm: asset.checksum_algorithm,
    expected_size: asset.size,
    required_headers: requiredHeaders,
  });

  const uploadUrl = storage.provider === "s3"
    ? await getPresignedPutUrl(makeEvidenceSource(storage), quarantineKey, {
        expiresIn: input.expires_in_seconds ?? 600,
        contentType,
        contentLength: input.size,
        checksumSha256: asset.checksum,
        metadata: evidenceMetadata(asset),
      })
    : pathToFileURL(localObjectPath(storage, quarantineKey, asset)).toString();

  await db.createFileAccessEvent({
    asset_id: asset.id,
    org_id: asset.org_id,
    company_id: asset.company_id,
    app: asset.app,
    action: "create_upload",
    metadata: { intent_id: intent.id, storage_provider: storage.provider },
  });

  return { asset, intent: { ...intent, upload_url: uploadUrl, required_headers: requiredHeaders } };
}

export type UploadEvidenceFileInput = Omit<CreateEvidenceUploadInput, "size" | "checksum" | "content_type" | "original_name"> & {
  path: string;
  original_name?: string;
};

export async function uploadEvidenceFile(
  input: UploadEvidenceFileInput,
  storageOverrides: EvidenceStorageOptions = {},
  db: EvidenceDb = sqliteEvidenceDb,
): Promise<EvidenceUploadReceipt> {
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
  return toEvidenceUploadReceipt({
    asset: completed,
    intent: (await db.getFileUploadIntent(result.intent.id))!,
  }, "completed");
}

export async function completeEvidenceUpload(
  intentId: string,
  storageOverrides: EvidenceStorageOptions = {},
  db: EvidenceDb = sqliteEvidenceDb,
): Promise<FileAsset> {
  const intent = await db.getFileUploadIntent(intentId);
  if (!intent) throw new Error(`Upload intent not found: ${intentId}`);
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
      await copyS3Object(source, quarantineKey, asset.object_key, evidenceMetadata(asset), asset.content_type);
      await deleteFromS3(source, quarantineKey);
    }
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
  else if (checksum !== asset.checksum && checksum !== Buffer.from(asset.checksum, "hex").toString("base64")) {
    diagnostics.push("checksum_mismatch");
  }
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

function cleanSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._=-]+/g, "-").replace(/^-+|-+$/g, "") || "_";
}

function cleanFilename(value: string): string {
  return value.trim().replace(/[\\/]/g, "-").replace(/[^a-zA-Z0-9._ -]+/g, "-").slice(0, 160) || "file";
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
