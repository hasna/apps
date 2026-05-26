import { runConnectorOperation } from "@hasna/connectors";
import type { GoogleDriveExportFormats, GoogleDriveProfileStatus } from "../types/index.js";

export const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";

const DEFAULT_EXPORT_FORMATS: Required<GoogleDriveExportFormats> = {
  document: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  spreadsheet: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  presentation: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  drawing: "image/png",
};

export interface GoogleDriveApiFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  version?: string;
  md5Checksum?: string;
  size?: string;
  modifiedTime?: string;
}

export interface GoogleDriveApiSharedDrive {
  id: string;
  name: string;
}

export interface GoogleDriveListFilesOptions {
  pageSize?: number;
  pageToken?: string;
  q?: string;
  fields?: string;
  orderBy?: string;
  corpora?: "user" | "drive" | "allDrives";
  driveId?: string;
  supportsAllDrives?: boolean;
  includeItemsFromAllDrives?: boolean;
}

export interface GoogleDriveListSharedDrivesOptions {
  pageSize?: number;
  pageToken?: string;
  q?: string;
}

export interface GoogleDriveDownloadedFile {
  data: ArrayBuffer;
  filename: string;
  mimeType: string;
}

export interface GoogleDriveClient {
  listFiles(options: GoogleDriveListFilesOptions): Promise<{ files: GoogleDriveApiFile[]; nextPageToken?: string }>;
  listSharedDrives(options?: GoogleDriveListSharedDrivesOptions): Promise<{ drives: GoogleDriveApiSharedDrive[]; nextPageToken?: string }>;
  downloadFile(file: GoogleDriveApiFile, exportFormats?: GoogleDriveExportFormats): Promise<GoogleDriveDownloadedFile>;
}

interface ConnectorProfilesResponse {
  profiles?: string[];
}

interface ConnectorProfileStatusesResponse {
  profiles?: GoogleDriveProfileStatus[];
}

interface ConnectorListFilesResponse {
  files?: GoogleDriveApiFile[];
  nextPageToken?: string;
}

interface ConnectorListDrivesResponse {
  drives?: GoogleDriveApiSharedDrive[];
  nextPageToken?: string;
}

interface ConnectorDownloadResponse {
  dataBase64?: string;
  filename?: string;
  mimeType?: string;
}

export async function listGoogleDriveProfilesFromConnectorConfig(): Promise<string[]> {
  const response = await runGoogleDriveOperation<ConnectorProfilesResponse>("profiles.list");
  return [...(response.profiles ?? [])].sort((a, b) => a.localeCompare(b));
}

export async function listGoogleDriveProfileStatusesFromConnectorConfig(profile?: string): Promise<GoogleDriveProfileStatus[]> {
  const response = await runGoogleDriveOperation<ConnectorProfileStatusesResponse>("profiles.status", undefined, { profile });
  return [...(response.profiles ?? [])].sort((a, b) => a.profile.localeCompare(b.profile));
}

export function createConnectorProfileGoogleDriveClient(profile: string): GoogleDriveClient {
  return new ConnectorSdkGoogleDriveClient(profile);
}

class ConnectorSdkGoogleDriveClient implements GoogleDriveClient {
  constructor(private readonly profile: string) {}

  async listFiles(options: GoogleDriveListFilesOptions): Promise<{ files: GoogleDriveApiFile[]; nextPageToken?: string }> {
    const response = await runGoogleDriveOperation<ConnectorListFilesResponse>("files.list", this.profile, {
      pageSize: options.pageSize ?? 1000,
      pageToken: options.pageToken,
      q: options.q,
      fields: options.fields,
      orderBy: options.orderBy,
      corpora: options.corpora,
      driveId: options.driveId,
      supportsAllDrives: options.supportsAllDrives ?? true,
      includeItemsFromAllDrives: options.includeItemsFromAllDrives ?? false,
    });
    return {
      files: response.files ?? [],
      nextPageToken: response.nextPageToken,
    };
  }

  async listSharedDrives(options: GoogleDriveListSharedDrivesOptions = {}): Promise<{ drives: GoogleDriveApiSharedDrive[]; nextPageToken?: string }> {
    const response = await runGoogleDriveOperation<ConnectorListDrivesResponse>("drives.list", this.profile, {
      pageSize: options.pageSize ?? 100,
      pageToken: options.pageToken,
      q: options.q,
    });
    return {
      drives: response.drives ?? [],
      nextPageToken: response.nextPageToken,
    };
  }

  async downloadFile(file: GoogleDriveApiFile, exportFormats: GoogleDriveExportFormats = {}): Promise<GoogleDriveDownloadedFile> {
    const response = await runGoogleDriveOperation<ConnectorDownloadResponse>("files.download", this.profile, {
      fileId: file.id,
      file: {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
      },
      exportMimeType: file.mimeType.startsWith("application/vnd.google-apps.")
        ? getExportMimeType(file.mimeType, exportFormats)
        : undefined,
    });
    if (!response.dataBase64) {
      throw new Error(`Google Drive download for "${file.name}" returned no data`);
    }
    const data = Buffer.from(response.dataBase64, "base64");
    return {
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      filename: response.filename ?? file.name,
      mimeType: response.mimeType ?? file.mimeType ?? "application/octet-stream",
    };
  }
}

async function runGoogleDriveOperation<T>(
  operation: string,
  profile?: string,
  input?: Record<string, unknown>,
): Promise<T> {
  const result = await runConnectorOperation<T>({
    connector: "googledrive",
    operation,
    profile,
    input,
  });
  if (!result.success) {
    throw new Error(result.stderr || `Google Drive connector operation "${operation}" failed`);
  }
  if (result.data === undefined) {
    throw new Error(`Google Drive connector operation "${operation}" returned no data`);
  }
  return result.data;
}

function getExportMimeType(googleMimeType: string, exportFormats: GoogleDriveExportFormats): string {
  if (googleMimeType.endsWith(".document")) return exportFormats.document ?? DEFAULT_EXPORT_FORMATS.document;
  if (googleMimeType.endsWith(".spreadsheet")) return exportFormats.spreadsheet ?? DEFAULT_EXPORT_FORMATS.spreadsheet;
  if (googleMimeType.endsWith(".presentation")) return exportFormats.presentation ?? DEFAULT_EXPORT_FORMATS.presentation;
  if (googleMimeType.endsWith(".drawing")) return exportFormats.drawing ?? DEFAULT_EXPORT_FORMATS.drawing;
  throw new Error(`Cannot export Google Workspace file type: ${googleMimeType}`);
}
