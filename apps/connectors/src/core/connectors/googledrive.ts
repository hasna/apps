import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { connectorsHome } from "../../lib/paths.js";
import { z } from "zod";
import { defineConnector } from "../connector.js";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export const GOOGLE_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

const DEFAULT_FILE_FIELDS = [
  "id",
  "name",
  "mimeType",
  "parents",
  "version",
  "md5Checksum",
  "size",
  "modifiedTime",
  "createdTime",
  "trashed",
  "webViewLink",
  "webContentLink",
].join(",");

const DEFAULT_EXPORT_FORMATS = {
  document: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  spreadsheet: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  presentation: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  drawing: "image/png",
} as const;

const EXPORT_EXTENSIONS: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/svg+xml": ".svg",
};

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

interface GoogleDriveContext {
  profile: string;
}

interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
}

const listFilesSchema = z.object({
  pageSize: z.coerce.number().int().positive().max(1000).optional(),
  pageToken: z.string().optional(),
  q: z.string().optional(),
  fields: z.string().optional(),
  orderBy: z.string().optional(),
  corpora: z.enum(["user", "drive", "allDrives"]).optional(),
  driveId: z.string().optional(),
  supportsAllDrives: z.boolean().optional(),
  includeItemsFromAllDrives: z.boolean().optional(),
});

const listDrivesSchema = z.object({
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  pageToken: z.string().optional(),
  q: z.string().optional(),
});

const fileIdSchema = z.object({
  fileId: z.string(),
  fields: z.string().optional(),
});

const downloadSchema = z.object({
  fileId: z.string(),
  file: z.object({
    id: z.string(),
    name: z.string(),
    mimeType: z.string(),
  }).optional(),
  exportMimeType: z.string().optional(),
});

const profilesStatusSchema = z.object({
  profile: z.string().optional(),
});

export const googleDriveConnector = defineConnector<GoogleDriveContext>({
  meta: {
    name: "googledrive",
    displayName: "Google Drive",
    description: "Profile-aware Google Drive discovery and file download operations.",
    category: "storage",
    tags: ["google", "drive", "files", "storage"],
  },
  auth: {
    type: "oauth2",
    supportsProfiles: true,
    fields: [
      { key: "clientId", env: "GOOGLE_CLIENT_ID", label: "OAuth client ID" },
      { key: "clientSecret", env: "GOOGLE_CLIENT_SECRET", label: "OAuth client secret", secret: true },
    ],
  },
  createContext: ({ profile }) => ({ profile: profile || "default" }),
  operations: {
    "profiles.list": {
      summary: "List configured Google Drive profiles.",
      execute: () => ({ profiles: listProfiles() }),
    },
    "profiles.status": {
      summary: "List Google Drive profile authentication status.",
      inputSchema: profilesStatusSchema,
      execute: (_ctx, input) => ({ profiles: listProfileStatuses(input.profile) }),
    },
    "files.list": {
      summary: "List Google Drive files.",
      inputSchema: listFilesSchema,
      execute: async ({ context }, input) => requestJson(context.profile, "/files", {
        pageSize: input.pageSize ?? 1000,
        pageToken: input.pageToken,
        q: input.q,
        fields: input.fields ?? `nextPageToken,files(${DEFAULT_FILE_FIELDS})`,
        orderBy: input.orderBy ?? "modifiedTime desc",
        corpora: input.corpora,
        driveId: input.driveId,
        supportsAllDrives: input.supportsAllDrives ?? true,
        includeItemsFromAllDrives: input.includeItemsFromAllDrives ?? false,
      }),
    },
    "files.get": {
      summary: "Get Google Drive file metadata.",
      inputSchema: fileIdSchema,
      execute: async ({ context }, input) => requestJson(context.profile, `/files/${encodeURIComponent(input.fileId)}`, {
        fields: input.fields ?? DEFAULT_FILE_FIELDS,
        supportsAllDrives: true,
      }),
    },
    "files.download": {
      summary: "Download or export a Google Drive file as base64 content.",
      inputSchema: downloadSchema,
      execute: async ({ context }, input) => {
        const file = input.file ?? await requestJson<GoogleDriveFile>(
          context.profile,
          `/files/${encodeURIComponent(input.fileId)}`,
          { fields: DEFAULT_FILE_FIELDS, supportsAllDrives: true },
        );
        const exportMimeType = file.mimeType.startsWith("application/vnd.google-apps.")
          ? input.exportMimeType ?? defaultExportMimeType(file.mimeType)
          : undefined;
        const data = await requestBinary(
          context.profile,
          exportMimeType ? `/files/${encodeURIComponent(file.id)}/export` : `/files/${encodeURIComponent(file.id)}`,
          exportMimeType
            ? { mimeType: exportMimeType, supportsAllDrives: true }
            : { alt: "media", supportsAllDrives: true },
        );
        const mimeType = exportMimeType ?? file.mimeType ?? "application/octet-stream";
        return {
          dataBase64: Buffer.from(data).toString("base64"),
          filename: exportMimeType ? `${file.name}${extensionForMimeType(exportMimeType)}` : file.name,
          mimeType,
        };
      },
    },
    "drives.list": {
      summary: "List Google shared drives.",
      inputSchema: listDrivesSchema,
      execute: async ({ context }, input) => requestJson(context.profile, "/drives", {
        pageSize: input.pageSize ?? 100,
        pageToken: input.pageToken,
        q: input.q,
      }),
    },
  },
});

async function requestJson<T = unknown>(profile: string, path: string, params: Record<string, string | number | boolean | undefined>): Promise<T> {
  const response = await request(profile, path, params);
  const text = await response.text();
  return text ? JSON.parse(text) as T : {} as T;
}

async function requestBinary(profile: string, path: string, params: Record<string, string | number | boolean | undefined>): Promise<ArrayBuffer> {
  return (await request(profile, path, params)).arrayBuffer();
}

async function request(profile: string, path: string, params: Record<string, string | number | boolean | undefined>): Promise<Response> {
  const token = await getValidAccessToken(profile);
  const url = new URL(`${DRIVE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google Drive request failed (${response.status}): ${extractGoogleError(body) || response.statusText}`);
  }
  return response;
}

async function getValidAccessToken(profile: string): Promise<string> {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;
  const tokens = loadTokens(profile);
  if (!tokens?.accessToken && !tokens?.refreshToken) {
    throw new Error(`Google Drive profile "${profile}" is not authenticated. Run: connectors auth googledrive`);
  }
  if (tokens.accessToken && (!tokens.expiresAt || Date.now() < tokens.expiresAt - REFRESH_BUFFER_MS)) return tokens.accessToken;
  if (!tokens.refreshToken) return tokens.accessToken ?? "";
  return (await refreshAccessToken(profile, tokens)).accessToken ?? "";
}

async function refreshAccessToken(profile: string, currentTokens: OAuth2Tokens): Promise<OAuth2Tokens> {
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
  const data = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; token_type?: string; scope?: string; error?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(`Google Drive token refresh failed: ${data.error_description || data.error || response.statusText}`);
  const tokens: OAuth2Tokens = {
    accessToken: data.access_token,
    refreshToken: currentTokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    tokenType: data.token_type ?? currentTokens.tokenType,
    scope: data.scope ?? currentTokens.scope,
  };
  saveTokens(profile, tokens);
  return tokens;
}

function listProfiles(): string[] {
  const profiles = new Set<string>();
  for (const baseDir of configDirs()) {
    const profilesDir = join(baseDir, "profiles");
    if (!existsSync(profilesDir)) continue;
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) profiles.add(entry.name);
      if (entry.isFile() && entry.name.endsWith(".json")) profiles.add(basename(entry.name, ".json"));
    }
  }
  return Array.from(profiles).sort((a, b) => a.localeCompare(b));
}

function listProfileStatuses(profile?: string): Array<{
  profile: string;
  configured: boolean;
  authenticated: boolean;
  expired: boolean;
  expiresAt: number | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasOAuthCredentials: boolean;
  authRequired: boolean;
  message: string;
}> {
  const profiles = profile ? [profile] : listProfiles();
  const uniqueProfiles = profiles.length ? profiles : ["default"];
  const now = Date.now();

  return uniqueProfiles.map((name) => {
    const tokens = loadTokens(name);
    const credentials = loadCredentials(name);
    const hasAccessToken = Boolean(tokens?.accessToken || process.env.GOOGLE_ACCESS_TOKEN);
    const hasRefreshToken = Boolean(tokens?.refreshToken);
    const hasOAuthCredentials = Boolean(credentials.clientId && credentials.clientSecret);
    const expiresAt = tokens?.expiresAt ?? null;
    const expired = Boolean(expiresAt && now >= expiresAt - REFRESH_BUFFER_MS);
    const authenticated = Boolean(process.env.GOOGLE_ACCESS_TOKEN || hasRefreshToken || (hasAccessToken && !expired));
    const configured = authenticated || hasOAuthCredentials;
    const authRequired = !authenticated || (expired && !hasRefreshToken);

    return {
      profile: name,
      configured,
      authenticated,
      expired,
      expiresAt,
      hasAccessToken,
      hasRefreshToken,
      hasOAuthCredentials,
      authRequired,
      message: authRequired
        ? `Google Drive profile "${name}" needs authentication. Run: connectors auth googledrive`
        : expired
          ? `Google Drive profile "${name}" access token is expired but can refresh.`
          : `Google Drive profile "${name}" is authenticated.`,
    };
  });
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

function loadTokens(profile: string): OAuth2Tokens | null {
  for (const baseDir of configDirs()) {
    const fromProfile = readJson<OAuth2Tokens>(join(baseDir, "profiles", profile, "tokens.json"));
    if (fromProfile) return fromProfile;
    const flat = readJson<{ tokens?: OAuth2Tokens } & OAuth2Tokens>(join(baseDir, "profiles", `${profile}.json`));
    if (flat) return flat.tokens ?? (flat.accessToken || flat.refreshToken ? flat : null);
  }
  return null;
}

function saveTokens(profile: string, tokens: OAuth2Tokens): void {
  const baseDir = configDirs().find((dir) => existsSync(dir)) ?? configDirs()[0];
  const profileDir = join(baseDir, "profiles", profile);
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, "tokens.json"), JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

function configDirs(): string[] {
  const explicit = process.env.HASNA_GOOGLE_DRIVE_CONNECTOR_DIR ?? process.env.GOOGLE_DRIVE_CONNECTOR_DIR;
  if (explicit) return [explicit];
  const baseDir = connectorsHome();
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

function defaultExportMimeType(googleMimeType: string): string {
  if (googleMimeType.endsWith(".document")) return DEFAULT_EXPORT_FORMATS.document;
  if (googleMimeType.endsWith(".spreadsheet")) return DEFAULT_EXPORT_FORMATS.spreadsheet;
  if (googleMimeType.endsWith(".presentation")) return DEFAULT_EXPORT_FORMATS.presentation;
  if (googleMimeType.endsWith(".drawing")) return DEFAULT_EXPORT_FORMATS.drawing;
  throw new Error(`Cannot export Google Workspace file type: ${googleMimeType}`);
}

function extensionForMimeType(mimeType: string): string {
  return EXPORT_EXTENSIONS[mimeType] ?? "";
}

function extractGoogleError(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? body;
  } catch {
    return body;
  }
}
