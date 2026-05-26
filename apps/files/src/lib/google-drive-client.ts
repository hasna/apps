import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { runConnectorOperation } from "@hasna/connectors";
import type { GoogleDriveExportFormats, GoogleDriveProfileStatus } from "../types/index.js";

export const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

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

export interface GoogleDriveDownloadedStream {
  body: NodeJS.ReadableStream;
  filename: string;
  mimeType: string;
  size?: number;
}

export interface GoogleDriveClient {
  listFiles(options: GoogleDriveListFilesOptions): Promise<{ files: GoogleDriveApiFile[]; nextPageToken?: string }>;
  listSharedDrives(options?: GoogleDriveListSharedDrivesOptions): Promise<{ drives: GoogleDriveApiSharedDrive[]; nextPageToken?: string }>;
  downloadFile(file: GoogleDriveApiFile, exportFormats?: GoogleDriveExportFormats): Promise<GoogleDriveDownloadedFile>;
  downloadFileStream?(file: GoogleDriveApiFile, exportFormats?: GoogleDriveExportFormats): Promise<GoogleDriveDownloadedStream>;
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

interface OAuth2Tokens {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

interface OAuthCredentials {
  clientId?: string;
  clientSecret?: string;
}

interface LoadedTokens {
  tokens: OAuth2Tokens;
  baseDir: string;
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
    if (response.dataBase64 === undefined) {
      throw new Error(`Google Drive download for "${file.name}" returned no data`);
    }
    const data = Buffer.from(response.dataBase64, "base64");
    return {
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      filename: response.filename ?? file.name,
      mimeType: response.mimeType ?? file.mimeType ?? "application/octet-stream",
    };
  }

  async downloadFileStream(file: GoogleDriveApiFile, exportFormats: GoogleDriveExportFormats = {}): Promise<GoogleDriveDownloadedStream> {
    if (file.mimeType.startsWith("application/vnd.google-apps.")) {
      const downloaded = await this.downloadFile(file, exportFormats);
      return {
        body: Readable.from(Buffer.from(downloaded.data)),
        filename: downloaded.filename,
        mimeType: downloaded.mimeType,
        size: downloaded.data.byteLength,
      };
    }

    const response = await requestGoogleDrive(this.profile, `/files/${encodeURIComponent(file.id)}`, {
      alt: "media",
      supportsAllDrives: true,
    });
    if (!response.body) throw new Error(`Google Drive download for "${file.name}" returned no stream`);
    return {
      body: Readable.fromWeb(response.body as any),
      filename: file.name,
      mimeType: response.headers.get("content-type")?.split(";")[0] || file.mimeType || "application/octet-stream",
      size: file.size ? Number(file.size) : Number(response.headers.get("content-length") ?? 0) || undefined,
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

async function requestGoogleDrive(
  profile: string,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<Response> {
  const token = await getValidAccessToken(profile);
  const url = new URL(`${DRIVE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/octet-stream",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google Drive request failed (${response.status}): ${extractGoogleError(body) || response.statusText}`);
  }
  return response;
}

async function getValidAccessToken(profile: string): Promise<string> {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;
  const loaded = loadTokens(profile);
  const tokens = loaded?.tokens;
  if (!tokens?.accessToken && !tokens?.refreshToken) {
    throw new Error(`Google Drive profile "${profile}" is not authenticated. Run: connectors auth googledrive`);
  }
  if (tokens.accessToken && (!tokens.expiresAt || Date.now() < tokens.expiresAt - REFRESH_BUFFER_MS)) return tokens.accessToken;
  if (!tokens.refreshToken) return tokens.accessToken ?? "";
  return (await refreshAccessToken(profile, tokens, loaded?.baseDir)).accessToken ?? "";
}

async function refreshAccessToken(profile: string, currentTokens: OAuth2Tokens, preferredBaseDir?: string): Promise<OAuth2Tokens> {
  const credentials = loadCredentials(profile);
  if (!credentials.clientId || !credentials.clientSecret) throw new Error("Google Drive OAuth credentials are not configured. Run: connectors auth googledrive");
  if (!currentTokens.refreshToken) throw new Error(`Google Drive profile "${profile}" has no refresh token. Run: connectors auth googledrive`);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: currentTokens.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json().catch(() => ({})) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) throw new Error(`Google Drive token refresh failed: ${data.error_description || data.error || response.statusText}`);
  const tokens: OAuth2Tokens = {
    accessToken: data.access_token,
    refreshToken: currentTokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    tokenType: data.token_type ?? currentTokens.tokenType,
    scope: data.scope ?? currentTokens.scope,
  };
  saveTokens(profile, tokens, preferredBaseDir);
  return tokens;
}

function loadCredentials(profile: string): OAuthCredentials {
  const envClientId = process.env.GOOGLE_CLIENT_ID;
  const envClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (envClientId && envClientSecret) return { clientId: envClientId, clientSecret: envClientSecret };
  for (const baseDir of configDirs()) {
    const credentials = {
      ...readJson<OAuthCredentials>(join(baseDir, "credentials.json")),
      ...readJson<OAuthCredentials>(join(baseDir, "profiles", profile, "config.json")),
    };
    if (credentials.clientId || credentials.clientSecret) return credentials;
  }
  return {};
}

function loadTokens(profile: string): LoadedTokens | null {
  for (const baseDir of configDirs()) {
    const fromProfile = readJson<OAuth2Tokens>(join(baseDir, "profiles", profile, "tokens.json"));
    if (fromProfile) return { tokens: fromProfile, baseDir };
    const flat = readJson<{ tokens?: OAuth2Tokens } & OAuth2Tokens>(join(baseDir, "profiles", `${profile}.json`));
    const tokens = flat?.tokens ?? (flat?.accessToken || flat?.refreshToken ? flat : null);
    if (tokens) return { tokens, baseDir };
  }
  return null;
}

function saveTokens(profile: string, tokens: OAuth2Tokens, preferredBaseDir?: string): void {
  const dirs = configDirs();
  const baseDir = preferredBaseDir ?? dirs.find((dir) => existsSync(dir)) ?? dirs[0];
  if (!baseDir) throw new Error("Google Drive connector configuration directory is unavailable");
  const profileDir = join(baseDir, "profiles", profile);
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, "tokens.json"), JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

function configDirs(): string[] {
  const explicit = process.env.HASNA_GOOGLE_DRIVE_CONNECTOR_DIR ?? process.env.GOOGLE_DRIVE_CONNECTOR_DIR;
  if (explicit) return [explicit];
  const baseDir = process.env.HASNA_CONNECTORS_DIR ?? join(homedir(), ".hasna", "connectors");
  return [join(baseDir, "googledrive"), join(baseDir, "connect-googledrive")];
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function extractGoogleError(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; error_description?: string };
    if (typeof parsed.error === "object" && parsed.error?.message) return parsed.error.message;
    if (typeof parsed.error === "string") return parsed.error_description || parsed.error;
  } catch {
    // Google sometimes returns plain text for failed media downloads.
  }
  return body.slice(0, 500);
}
