import { createWriteStream, mkdirSync, writeFileSync } from "fs";
import { basename, dirname, extname, join, posix } from "path";
import { pipeline } from "stream/promises";
import { lookup as mimeLookup } from "mime-types";
import { getCurrentMachine } from "../db/machines.js";
import { markFileDeletedById, upsertFile } from "../db/files.js";
import {
  getGoogleDriveImportedObject,
  listDeletedGoogleDriveImportedObjects,
  listGoogleDriveImportedObjects,
  markGoogleDriveSynced,
  markGoogleDriveSyncError,
  upsertGoogleDriveImportedObject,
  markMissingGoogleDriveObjectsDeleted,
} from "../db/google-drive.js";
import { getDb } from "../db/database.js";
import { getSource, listSources, markSourceIndexed } from "../db/sources.js";
import { hashBuffer } from "./hasher.js";
import { loadConfig } from "./config.js";
import { uploadBufferToS3 } from "./s3.js";
import {
  GOOGLE_FOLDER_MIME,
  createConnectorProfileGoogleDriveClient,
  listGoogleDriveProfileStatusesFromConnectorConfig,
  listGoogleDriveProfilesFromConnectorConfig,
  type GoogleDriveApiFile,
  type GoogleDriveClient,
  type GoogleDriveDownloadedFile,
  type GoogleDriveDownloadedStream,
} from "./google-drive-client.js";
import type {
  GoogleDriveConfig,
  GoogleDriveItem,
  GoogleDrivePreflightResult,
  GoogleDriveProfileStatus,
  GoogleDriveSharedDrive,
  GoogleDriveImportedObject,
  IndexStats,
  Source,
} from "../types/index.js";

const DRIVE_FIELDS = "nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,version,md5Checksum)";
const STREAM_TO_S3_THRESHOLD_BYTES = 64 * 1024 * 1024;

type GoogleDriveStorageType = "s3" | "local";

type GoogleDriveStorageAdapter = {
  uploadS3: typeof uploadBufferToS3;
  writeLocal: (source: Source, relativePath: string, data: Buffer) => Promise<string>;
  writeLocalStream: (source: Source, relativePath: string, body: NodeJS.ReadableStream) => Promise<string>;
};

let clientFactory: (profile: string) => GoogleDriveClient = createConnectorProfileGoogleDriveClient;
let profileStatusProvider: (profile?: string) => Promise<GoogleDriveProfileStatus[]> = listGoogleDriveProfileStatusesFromConnectorConfig;
let storageAdapter: GoogleDriveStorageAdapter = {
  uploadS3: uploadBufferToS3,
  writeLocal: async (source, relativePath, data) => {
    if (!source.path) throw new Error("Local destination source missing path");
    const localPath = join(source.path, relativePath);
    mkdirSync(dirname(localPath), { recursive: true });
    writeFileSync(localPath, data);
    return relativePath;
  },
  writeLocalStream: async (source, relativePath, body) => {
    if (!source.path) throw new Error("Local destination source missing path");
    const localPath = join(source.path, relativePath);
    mkdirSync(dirname(localPath), { recursive: true });
    await pipeline(body, createWriteStream(localPath));
    return relativePath;
  },
};

export function setGoogleDriveClientFactoryForTests(factory?: (profile: string) => GoogleDriveClient): void {
  clientFactory = factory ?? createConnectorProfileGoogleDriveClient;
}

export function setGoogleDriveProfileStatusProviderForTests(
  provider?: (profile?: string) => Promise<GoogleDriveProfileStatus[]>,
): void {
  profileStatusProvider = provider ?? listGoogleDriveProfileStatusesFromConnectorConfig;
}

export function setGoogleDriveStorageAdapterForTests(adapter?: Partial<GoogleDriveStorageAdapter>): void {
  storageAdapter = {
    uploadS3: adapter?.uploadS3 ?? uploadBufferToS3,
    writeLocal: adapter?.writeLocal ?? (async (source, relativePath, data) => {
      if (!source.path) throw new Error("Local destination source missing path");
      const localPath = join(source.path, relativePath);
      mkdirSync(dirname(localPath), { recursive: true });
      writeFileSync(localPath, data);
      return relativePath;
    }),
    writeLocalStream: adapter?.writeLocalStream ?? (async (source, relativePath, body) => {
      if (!source.path) throw new Error("Local destination source missing path");
      const localPath = join(source.path, relativePath);
      mkdirSync(dirname(localPath), { recursive: true });
      await pipeline(body, createWriteStream(localPath));
      return relativePath;
    }),
  };
}

export function listGoogleDriveProfiles(): Promise<string[]> {
  return listGoogleDriveProfilesFromConnectorConfig();
}

export function listGoogleDriveProfileStatuses(profile?: string): Promise<GoogleDriveProfileStatus[]> {
  return profileStatusProvider(profile);
}

function getGoogleDriveConfig(source: Source): GoogleDriveConfig {
  if (source.type !== "google_drive") throw new Error("Source is not a Google Drive source");
  const config = source.config as GoogleDriveConfig;
  if (!config.profile) throw new Error("Google Drive source missing profile");
  return config;
}

function getDestinationSource(source: Source): { source: Source; storage_type: GoogleDriveStorageType } {
  const config = getGoogleDriveConfig(source);
  const configuredId = config.destination_source_id || getConfiguredDefaultDestinationSourceId();

  if (configuredId) {
    const destination = getSource(configuredId);
    if (!destination) throw new Error(`Destination source not found: ${configuredId}`);
    if (destination.type !== "s3" && destination.type !== "local") {
      throw new Error("Google Drive import destination must be an S3 or local source");
    }
    if (destination.type === "s3" && !destination.bucket) throw new Error("Destination S3 source missing bucket");
    if (destination.type === "local" && !destination.path) throw new Error("Destination local source missing path");
    return { source: destination, storage_type: destination.type };
  }

  const machineS3 = listSources(source.machine_id).find((item) => item.enabled && item.type === "s3" && item.bucket);
  const anyS3 = machineS3 ?? listSources().find((item) => item.enabled && item.type === "s3" && item.bucket);
  if (anyS3) return { source: anyS3, storage_type: "s3" };

  throw new Error(
    "Google Drive sync needs an S3 destination by default. Add an S3 source, set google_drive_default_destination_source_id, or pass a local destination source.",
  );
}

function getConfiguredDefaultDestinationSourceId(): string | undefined {
  const value = loadConfig().google_drive_default_destination_source_id;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function listGoogleDriveSharedDrives(source: Source): Promise<GoogleDriveSharedDrive[]> {
  const config = getGoogleDriveConfig(source);
  const client = clientFactory(config.profile);
  return listAllSharedDrives(client);
}

export async function listGoogleDriveItems(source: Source): Promise<GoogleDriveItem[]> {
  const config = getGoogleDriveConfig(source);
  const client = clientFactory(config.profile);
  return listGoogleDriveItemsWithClient(source, client);
}

export async function preflightGoogleDriveSource(source: Source): Promise<GoogleDrivePreflightResult> {
  const config = getGoogleDriveConfig(source);
  const destination = getDestinationSource(source);
  const errors: string[] = [];
  let auth: GoogleDriveProfileStatus | null = null;
  let items: GoogleDriveItem[] = [];

  try {
    auth = (await profileStatusProvider(config.profile)).find((item) => item.profile === config.profile) ?? null;
    if (auth?.authRequired) errors.push(auth.message);
  } catch (error) {
    errors.push(`Unable to read Google Drive auth status: ${(error as Error).message}`);
  }

  if (!auth?.authRequired) {
    try {
      const client = clientFactory(config.profile);
      items = await listGoogleDriveItemsWithClient(source, client);
    } catch (error) {
      errors.push(`Unable to list Google Drive items: ${(error as Error).message}`);
    }
  }

  return {
    source_id: source.id,
    source_name: source.name,
    profile: config.profile,
    auth,
    destination: {
      source_id: destination.source.id,
      name: destination.source.name,
      type: destination.storage_type,
      bucket: destination.source.bucket,
      prefix: destination.source.prefix,
      region: destination.source.region,
      aws_profile: (destination.source.config as { profile?: string }).profile,
      path: destination.source.path,
    },
    includes: {
      my_drive: config.include_my_drive,
      all_shared_drives: config.include_all_shared_drives,
      shared_drive_ids: config.shared_drive_ids ?? [],
      root_folder_ids: config.root_folder_ids ?? [],
    },
    item_count: items.length,
    drive_counts: countItemsByDrive(items),
    errors,
  };
}

async function listGoogleDriveItemsWithClient(source: Source, client: GoogleDriveClient): Promise<GoogleDriveItem[]> {
  const config = getGoogleDriveConfig(source);
  const items: GoogleDriveItem[] = [];
  if (config.include_my_drive) {
    items.push(...await listMyDriveItems(client, config));
  }
  for (const shared of await getIncludedSharedDrives(source, client)) {
    items.push(...await listSharedDriveItems(client, shared.id, shared.name));
  }
  return items;
}

export async function syncGoogleDriveSource(source: Source): Promise<IndexStats> {
  const config = getGoogleDriveConfig(source);
  const destination = getDestinationSource(source);
  const machine = getCurrentMachine();
  const start = Date.now();
  const stats: IndexStats = { source_id: source.id, added: 0, updated: 0, deleted: 0, errors: 0, duration_ms: 0 };
  let lastImportError: string | undefined;

  try {
    const client = clientFactory(config.profile);
    const items = await listGoogleDriveItemsWithClient(source, client);
    const seen = new Array<{ drive_id: string; file_id: string }>();

    for (const item of items) {
      seen.push({ drive_id: item.drive_id, file_id: item.id });
      try {
        const existing = getGoogleDriveImportedObject(source.id, item.drive_id, item.id);
        if (existing && !shouldImport(config, item, existing, destination.source, destination.storage_type)) continue;

        const importResult = await importGoogleDriveItem(client, item, config, destination.source, destination.storage_type);
        const fileRecord = upsertFile({
          id: existing?.file_record_id,
          source_id: destination.source.id,
          machine_id: machine.id,
          path: importResult.storageKey,
          name: importResult.importedName,
          ext: extname(importResult.importedName).toLowerCase(),
          size: importResult.size,
          mime: importResult.contentType,
          hash: importResult.hash,
          status: "active",
          modified_at: item.modified_at,
        });

        upsertGoogleDriveImportedObject({
          source_id: source.id,
          drive_id: item.drive_id,
          file_id: item.id,
          profile: config.profile,
          parent_id: item.parent_id,
          path: importResult.importedPath,
          name: importResult.importedName,
          mime: importResult.contentType,
          size: importResult.size,
          modified_at: item.modified_at,
          version: item.version,
          hash: importResult.hash,
          storage_type: destination.storage_type,
          storage_key: importResult.storageKey,
          destination_source_id: destination.source.id,
          s3_key: destination.storage_type === "s3" ? importResult.storageKey : "",
          file_record_id: fileRecord.id,
          deleted: false,
          last_imported_at: new Date().toISOString(),
        });

        if (existing) stats.updated++;
        else stats.added++;
      } catch (error) {
        lastImportError = `${item.path}: ${(error as Error).message}`;
        markGoogleDriveSyncError(source.id, lastImportError);
        stats.errors++;
      }
    }

    if (config.delete_behavior === "mark_deleted") {
      stats.deleted += markMissingGoogleDriveObjectsDeleted(source.id, seen);
      for (const record of listDeletedGoogleDriveImportedObjects(source.id)) {
        markFileDeletedById(record.file_record_id);
      }
    }

    markGoogleDriveSynced(source.id, true);
    if (lastImportError) markGoogleDriveSyncError(source.id, lastImportError);
    markSourceIndexed(source.id, listGoogleDriveImportedObjectsCount(source.id));
    markSourceIndexed(destination.source.id, countActiveFiles(destination.source.id));
    stats.duration_ms = Date.now() - start;
    return stats;
  } catch (error) {
    markGoogleDriveSyncError(source.id, (error as Error).message);
    stats.duration_ms = Date.now() - start;
    throw error;
  }
}

function listGoogleDriveImportedObjectsCount(source_id: string): number {
  return listGoogleDriveImportedObjects(source_id).filter((item) => !item.deleted).length;
}

function countActiveFiles(source_id: string): number {
  const row = getDb().query<{ n: number }, [string]>(
    "SELECT COUNT(*) AS n FROM files WHERE source_id = ? AND status = 'active'",
  ).get(source_id);
  return row?.n ?? 0;
}

function countItemsByDrive(items: GoogleDriveItem[]): GoogleDrivePreflightResult["drive_counts"] {
  const counts = new Map<string, GoogleDrivePreflightResult["drive_counts"][number]>();
  for (const item of items) {
    const existing = counts.get(item.drive_id);
    if (existing) {
      existing.count++;
      continue;
    }
    counts.set(item.drive_id, {
      drive_id: item.drive_id,
      drive_name: item.drive_name,
      is_shared_drive: item.is_shared_drive,
      count: 1,
    });
  }
  return [...counts.values()].sort((a, b) => a.drive_name.localeCompare(b.drive_name));
}

async function writeToDestination(
  source: Source,
  storageType: GoogleDriveStorageType,
  importedPath: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  if (storageType === "s3") {
    const key = buildStorageKey(source, importedPath);
    return storageAdapter.uploadS3(source, data, key, contentType, data.byteLength);
  }
  return storageAdapter.writeLocal(source, importedPath, data);
}

async function importGoogleDriveItem(
  client: GoogleDriveClient,
  item: GoogleDriveItem,
  config: GoogleDriveConfig,
  destinationSource: Source,
  storageType: GoogleDriveStorageType,
): Promise<{
  importedName: string;
  importedPath: string;
  contentType: string;
  size: number;
  hash?: string;
  storageKey: string;
}> {
  if (shouldStreamGoogleDriveItem(client, item, storageType)) {
    const downloaded = await client.downloadFileStream!(toApiFile(item), config.export_formats);
    return importGoogleDriveStream(destinationSource, storageType, item, config, downloaded);
  }

  const downloaded = await downloadOrArchiveGoogleDriveItem(client, item, config);
  const importedName = basename(downloaded.filename);
  const importedPath = buildImportedPath(config, item, importedName);
  const contentType = downloaded.mimeType || ((mimeLookup(downloaded.filename) || item.mime || "application/octet-stream") as string);
  const data = Buffer.from(downloaded.data);
  const storageKey = await writeToDestination(destinationSource, storageType, importedPath, data, contentType);
  return {
    importedName,
    importedPath,
    contentType,
    size: data.byteLength,
    hash: item.hash ?? hashBuffer(data),
    storageKey,
  };
}

function shouldStreamGoogleDriveItem(
  client: GoogleDriveClient,
  item: GoogleDriveItem,
  storageType: GoogleDriveStorageType,
): boolean {
  return storageType === "s3"
    && typeof client.downloadFileStream === "function"
    && !item.mime.startsWith("application/vnd.google-apps.")
    && (!item.size || item.size >= STREAM_TO_S3_THRESHOLD_BYTES);
}

async function importGoogleDriveStream(
  source: Source,
  storageType: GoogleDriveStorageType,
  item: GoogleDriveItem,
  config: GoogleDriveConfig,
  downloaded: GoogleDriveDownloadedStream,
): Promise<{
  importedName: string;
  importedPath: string;
  contentType: string;
  size: number;
  hash?: string;
  storageKey: string;
}> {
  const importedName = basename(downloaded.filename);
  const importedPath = buildImportedPath(config, item, importedName);
  const contentType = downloaded.mimeType || ((mimeLookup(downloaded.filename) || item.mime || "application/octet-stream") as string);
  const contentLength = downloaded.size && downloaded.size > 0
    ? downloaded.size
    : item.size > 0
      ? item.size
      : undefined;
  const size = contentLength ?? 0;
  const storageKey = await writeStreamToDestination(source, storageType, importedPath, downloaded.body, contentType, contentLength);
  return {
    importedName,
    importedPath,
    contentType,
    size,
    hash: item.hash,
    storageKey,
  };
}

async function writeStreamToDestination(
  source: Source,
  storageType: GoogleDriveStorageType,
  importedPath: string,
  body: NodeJS.ReadableStream,
  contentType: string,
  contentLength?: number,
): Promise<string> {
  if (storageType === "s3") {
    const key = buildStorageKey(source, importedPath);
    return storageAdapter.uploadS3(source, body as Parameters<typeof uploadBufferToS3>[1], key, contentType, contentLength);
  }
  return storageAdapter.writeLocalStream(source, importedPath, body);
}

async function getIncludedSharedDrives(source: Source, client: GoogleDriveClient): Promise<GoogleDriveSharedDrive[]> {
  const config = getGoogleDriveConfig(source);
  if (!config.include_all_shared_drives && (!config.shared_drive_ids || config.shared_drive_ids.length === 0)) {
    return [];
  }

  const all = await listAllSharedDrives(client);
  if (config.include_all_shared_drives) return all;
  const allowed = new Set(config.shared_drive_ids ?? []);
  return all.filter((item) => allowed.has(item.id));
}

async function listAllSharedDrives(client: GoogleDriveClient): Promise<GoogleDriveSharedDrive[]> {
  const drives: GoogleDriveSharedDrive[] = [];
  let pageToken: string | undefined;
  do {
    const response = await client.listSharedDrives({ pageSize: 100, pageToken });
    drives.push(...response.drives.map((item) => ({ id: item.id, name: item.name })));
    pageToken = response.nextPageToken;
  } while (pageToken);
  return drives;
}

async function listMyDriveItems(client: GoogleDriveClient, config: GoogleDriveConfig): Promise<GoogleDriveItem[]> {
  if (config.root_folder_ids?.length) {
    const files = await listFolderTree(client, config.root_folder_ids);
    return buildGoogleDriveItems(files, "my-drive", "My Drive", false);
  }

  const files = await listAllDriveFiles(async (pageToken) => {
    const response = await client.listFiles({
      pageSize: 1000,
      pageToken,
      q: "trashed = false",
      fields: DRIVE_FIELDS,
      corpora: "user",
      supportsAllDrives: true,
      includeItemsFromAllDrives: false,
    });
    return {
      files: response.files,
      nextPageToken: response.nextPageToken,
    };
  });
  return buildGoogleDriveItems(files, "my-drive", "My Drive", false);
}

async function listFolderTree(client: GoogleDriveClient, rootFolderIds: string[]): Promise<GoogleDriveApiFile[]> {
  const files: GoogleDriveApiFile[] = [];
  const queue = [...rootFolderIds];
  const visited = new Set<string>();

  while (queue.length) {
    const folderId = queue.shift()!;
    if (visited.has(folderId)) continue;
    visited.add(folderId);

    const children = await listAllDriveFiles(async (pageToken) => {
      const response = await client.listFiles({
        pageSize: 1000,
        pageToken,
        q: buildParentQuery([folderId]),
        fields: DRIVE_FIELDS,
        corpora: "user",
        supportsAllDrives: true,
        includeItemsFromAllDrives: false,
      });
      return {
        files: response.files,
        nextPageToken: response.nextPageToken,
      };
    });

    files.push(...children);
    for (const child of children) {
      if (child.mimeType === GOOGLE_FOLDER_MIME) queue.push(child.id);
    }
  }

  return files;
}

async function listSharedDriveItems(client: GoogleDriveClient, driveId: string, driveName: string): Promise<GoogleDriveItem[]> {
  const files = await listAllDriveFiles(async (pageToken) => {
    const response = await client.listFiles({
      pageSize: 1000,
      pageToken,
      q: "trashed = false",
      fields: DRIVE_FIELDS,
      corpora: "drive",
      driveId,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return {
      files: response.files,
      nextPageToken: response.nextPageToken,
    };
  });
  return buildGoogleDriveItems(files, driveId, driveName, true);
}

async function listAllDriveFiles(
  fetchPage: (pageToken?: string) => Promise<{ files: GoogleDriveApiFile[]; nextPageToken?: string }>,
): Promise<GoogleDriveApiFile[]> {
  const files: GoogleDriveApiFile[] = [];
  let pageToken: string | undefined;

  do {
    const response = await fetchPage(pageToken);
    files.push(...response.files);
    pageToken = response.nextPageToken;
  } while (pageToken);

  return files;
}

function buildGoogleDriveItems(files: GoogleDriveApiFile[], driveId: string, driveName: string, isSharedDrive: boolean): GoogleDriveItem[] {
  const byId = new Map(files.map((file) => [file.id, file]));

  return files
    .filter((file) => file.mimeType !== GOOGLE_FOLDER_MIME)
    .map((file) => {
      const parentId = file.parents?.[0];
      const parentPath = buildPath(parentId, byId);
      return {
        id: file.id,
        drive_id: driveId,
        drive_name: driveName,
        is_shared_drive: isSharedDrive,
        parent_id: parentId,
        path: joinPath(parentPath, file.name),
        name: file.name,
        mime: file.mimeType,
        size: Number(file.size ?? 0),
        modified_at: file.modifiedTime,
        hash: file.md5Checksum,
        version: file.version,
      };
    });
}

function buildPath(folderId: string | undefined, byId: Map<string, GoogleDriveApiFile>): string {
  if (!folderId) return "";

  const parts: string[] = [];
  let currentId: string | undefined = folderId;
  while (currentId) {
    const current = byId.get(currentId);
    if (!current || current.mimeType !== GOOGLE_FOLDER_MIME) break;
    parts.unshift(current.name);
    currentId = current.parents?.[0];
  }
  return parts.join("/");
}

function joinPath(parent: string, name: string): string {
  if (!parent) return name;
  return posix.join(parent, name);
}

function buildParentQuery(folderIds: string[]): string {
  return `trashed = false and (${folderIds.map((id) => `'${escapeDriveQueryValue(id)}' in parents`).join(" or ")})`;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildStorageKey(source: Source, importedPath: string): string {
  return source.prefix ? posix.join(source.prefix, importedPath) : importedPath;
}

function shouldImport(
  config: GoogleDriveConfig,
  item: GoogleDriveItem,
  existing: GoogleDriveImportedObject,
  destinationSource: Source,
  storageType: GoogleDriveStorageType,
): boolean {
  const importedPath = buildImportedPath(config, item, existing.name);
  const storageKey = storageType === "s3" || storageType === "local"
    ? buildStorageKey(destinationSource, importedPath)
    : importedPath;

  return existing.path !== importedPath
    || existing.hash !== item.hash
    || existing.modified_at !== item.modified_at
    || existing.version !== item.version
    || existing.destination_source_id !== destinationSource.id
    || existing.storage_type !== storageType
    || existing.storage_key !== storageKey
    || existing.deleted;
}

function buildImportedPath(config: GoogleDriveConfig, item: GoogleDriveItem, importedName: string): string {
  if (config.path_mode === "id_based") {
    return posix.join(safePathSegment(config.profile), safePathSegment(item.drive_id), item.id, importedName);
  }

  const storageName = appendDriveFileId(importedName, item.id);
  const itemPath = item.path === item.name ? storageName : posix.join(dirname(item.path), storageName);
  const driveSegment = item.drive_id === "my-drive" ? "my-drive" : safePathSegment(item.drive_name || item.drive_id);
  return posix.join(safePathSegment(config.profile), driveSegment, itemPath);
}

function safePathSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim() || "unnamed";
}

function appendDriveFileId(filename: string, fileId: string): string {
  const ext = extname(filename);
  const base = ext ? filename.slice(0, -ext.length) : filename;
  return `${base} (${safePathSegment(fileId)})${ext}`;
}

function canDownloadDriveItem(item: GoogleDriveItem): boolean {
  if (!item.mime.startsWith("application/vnd.google-apps.")) return true;
  return [
    "application/vnd.google-apps.document",
    "application/vnd.google-apps.spreadsheet",
    "application/vnd.google-apps.presentation",
    "application/vnd.google-apps.drawing",
  ].includes(item.mime);
}

async function downloadOrArchiveGoogleDriveItem(
  client: GoogleDriveClient,
  item: GoogleDriveItem,
  config: GoogleDriveConfig,
): Promise<GoogleDriveDownloadedFile> {
  if (!canDownloadDriveItem(item)) return createGoogleDriveMetadataArchive(item);

  try {
    return await client.downloadFile(toApiFile(item), config.export_formats);
  } catch (error) {
    if (shouldArchiveGoogleDriveDownloadError(item, error)) {
      return createGoogleDriveMetadataArchive(item, `Google Drive export failed: ${(error as Error).message}`);
    }
    throw error;
  }
}

function shouldArchiveGoogleDriveDownloadError(item: GoogleDriveItem, error: unknown): boolean {
  if (!item.mime.startsWith("application/vnd.google-apps.")) return false;
  const message = (error as Error).message ?? String(error);
  return /cannot be exported/i.test(message);
}

function createGoogleDriveMetadataArchive(item: GoogleDriveItem, reason = "Google Drive item is not exportable as file content through Drive export."): GoogleDriveDownloadedFile {
  const metadata = {
    archived_as: "google-drive-metadata",
    reason,
    id: item.id,
    name: item.name,
    mime: item.mime,
    drive_id: item.drive_id,
    drive_name: item.drive_name,
    is_shared_drive: item.is_shared_drive,
    parent_id: item.parent_id,
    path: item.path,
    size: item.size,
    modified_at: item.modified_at,
    version: item.version,
    hash: item.hash,
  };
  const data = Buffer.from(JSON.stringify(metadata, null, 2) + "\n");
  return {
    data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    filename: `${item.name}.gdrive-metadata.json`,
    mimeType: "application/json",
  };
}

function toApiFile(item: GoogleDriveItem): GoogleDriveApiFile {
  return {
    id: item.id,
    name: item.name,
    mimeType: item.mime,
    parents: item.parent_id ? [item.parent_id] : undefined,
    version: item.version,
    md5Checksum: item.hash,
    size: String(item.size),
    modifiedTime: item.modified_at,
  };
}
