import { isAbsolute, relative, resolve } from "path";
import { getFile } from "../db/files.js";
import { getGoogleDriveImportedObjectByFileRecordId } from "../db/google-drive.js";
import { getSource } from "../db/sources.js";
import { downloadFromS3 } from "./s3.js";
import type { FileWithTags, GoogleDriveImportedObject, S3Config, Source } from "../types/index.js";

export type ResolvedFileStorageKind = "local" | "s3" | "google_drive_canonical_s3" | "google_drive_destination_s3" | "google_drive_destination_local";

export interface ResolvedFileObject {
  file: FileWithTags;
  source: Source;
  storageSource: Source;
  storageKind: ResolvedFileStorageKind;
  objectKey: string;
  googleDriveObject?: GoogleDriveImportedObject;
  canonical?: {
    bucket: string;
    key: string;
    sha256?: string;
    raw_bucket?: string;
    raw_key?: string;
    promotion_status?: string;
  };
}

export function resolveFileObject(fileId: string): ResolvedFileObject {
  const file = getFile(fileId);
  if (!file) throw new Error(`File not found: ${fileId}`);

  const source = getSource(file.source_id);
  if (!source) throw new Error(`Source not found for file: ${file.id}`);

  const imported = getGoogleDriveImportedObjectByFileRecordId(file.id);
  if (imported?.canonical_bucket && imported.canonical_key) {
    const storageSource: Source = {
      ...source,
      id: `${source.id}:canonical`,
      name: `${source.name} canonical object storage`,
      type: "s3",
      bucket: imported.canonical_bucket,
      prefix: undefined,
      region: canonicalRegion(),
      config: canonicalS3Config(imported.destination_source_id),
    };
    return {
      file,
      source,
      storageSource,
      storageKind: "google_drive_canonical_s3",
      objectKey: imported.canonical_key,
      googleDriveObject: imported,
      canonical: {
        bucket: imported.canonical_bucket,
        key: imported.canonical_key,
        sha256: imported.canonical_sha256,
        raw_bucket: imported.raw_bucket,
        raw_key: imported.raw_key,
        promotion_status: imported.promotion_status,
      },
    };
  }

  const destination = imported?.destination_source_id ? getSource(imported.destination_source_id) : null;
  if (destination?.type === "s3" && imported?.storage_key) {
    return {
      file,
      source,
      storageSource: destination,
      storageKind: "google_drive_destination_s3",
      objectKey: imported.storage_key,
      googleDriveObject: imported,
    };
  }
  if (destination?.type === "local" && imported?.storage_key) {
    const objectKey = validateManagedObjectKey(imported.storage_key);
    return {
      file,
      source,
      storageSource: destination,
      storageKind: "google_drive_destination_local",
      objectKey,
      googleDriveObject: imported,
    };
  }

  if (source.type === "local" || source.type === "s3") {
    const objectKey = source.type === "local" ? validateManagedObjectKey(file.path) : file.path;
    return {
      file,
      source,
      storageSource: source,
      storageKind: source.type,
      objectKey,
      googleDriveObject: imported ?? undefined,
    };
  }

  throw new Error(`Google Drive object mapping not found for file: ${file.id}`);
}

export async function downloadResolvedFileObject(resolved: ResolvedFileObject, destPath: string): Promise<string> {
  if (resolved.storageSource.type === "local") {
    return safeLocalObjectPath(resolved.storageSource, resolved.objectKey);
  }

  await downloadFromS3(resolved.storageSource, resolved.objectKey, destPath);
  return destPath;
}

export function resolvedFileObjectSummary(resolved: ResolvedFileObject): Record<string, unknown> {
  return {
    file: resolved.file,
    storage: {
      kind: resolved.storageKind,
      source_id: resolved.storageSource.id,
      source_name: resolved.storageSource.name,
      provider: resolved.storageSource.type,
      path: resolved.storageSource.type === "local" ? safeLocalObjectPath(resolved.storageSource, resolved.objectKey) : undefined,
      bucket: resolved.storageSource.bucket,
      region: resolved.storageSource.region,
      key: resolved.storageSource.type === "s3" ? resolved.objectKey : undefined,
      canonical: resolved.canonical,
    },
  };
}

function validateManagedObjectKey(key: string): string {
  if (!key || key.includes("\0") || key.includes("\\")) {
    throw new Error("Local object key is not a safe managed relative path.");
  }
  if (key.startsWith("/") || /^[A-Za-z]:\//.test(key)) {
    throw new Error("Local object key must be relative.");
  }
  const parts = key.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Local object key contains unsafe path segments.");
  }
  return parts.join("/");
}

function safeLocalObjectPath(source: Source, objectKey: string): string {
  if (!source.path) throw new Error("Local source is missing a root path.");
  const safeKey = validateManagedObjectKey(objectKey);
  const rootPath = resolve(source.path);
  const candidate = resolve(rootPath, safeKey);
  const rel = relative(rootPath, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Resolved local object path escapes the source root.");
  }
  return candidate;
}

function canonicalRegion(): string {
  return process.env.HASNA_FILES_AWS_REGION
    ?? process.env.HASNA_FILES_S3_REGION
    ?? process.env.AWS_REGION
    ?? process.env.AWS_DEFAULT_REGION
    ?? "us-east-1";
}

function canonicalS3Config(destinationSourceId?: string): S3Config {
  const envProfile = process.env.HASNA_FILES_AWS_PROFILE ?? process.env.AWS_PROFILE;
  if (envProfile) return { profile: envProfile };

  const destination = destinationSourceId ? getSource(destinationSourceId) : null;
  if (destination?.type === "s3") return destination.config as S3Config;

  return {};
}
