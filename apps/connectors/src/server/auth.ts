/**
 * Auth status detection and token management for the dashboard server.
 * Reads connector CLAUDE.md files to determine auth type, checks profile
 * directories for stored credentials, and handles token operations.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import { homedir } from "os";
import { join } from "path";
import { getConnectorDocs } from "../lib/installer.js";

/** Timeout for external HTTP requests (10 seconds) */
const FETCH_TIMEOUT = 10_000;

/** In-memory CSRF state store for OAuth flows */
const oauthStateStore = new Map<string, { connector: string; createdAt: number }>();

// Google OAuth2 endpoints
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// Scopes per Google connector
const GOOGLE_SCOPES: Record<string, string> = {
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.labels",
    "https://mail.google.com/",
  ].join(" "),
  googlecalendar: [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
  ].join(" "),
  googledrive: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.file",
  ].join(" "),
  googledocs: [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.file",
  ].join(" "),
  googlesheets: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
  ].join(" "),
  googletasks: [
    "https://www.googleapis.com/auth/tasks",
  ].join(" "),
  googlecontacts: [
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/contacts.readonly",
  ].join(" "),
  google: [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ].join(" "),
};

export type AuthType = "oauth" | "apikey" | "bearer";

export interface AuthStatus {
  type: AuthType;
  configured: boolean;
  tokenExpiry?: number;
  hasRefreshToken?: boolean;
  envVars: { variable: string; description: string; set: boolean }[];
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

/**
 * Get the auth type for a connector by parsing its CLAUDE.md
 */
export function getAuthType(name: string): AuthType {
  const docs = getConnectorDocs(name);
  if (!docs?.auth) return "apikey";

  const authLower = docs.auth.toLowerCase();
  if (authLower.includes("oauth")) return "oauth";
  if (authLower.includes("bearer token")) return "bearer";
  return "apikey";
}

/**
 * Get the base config directory for a connector
 */
function getConnectorConfigDir(name: string): string {
  const connectorName = name.startsWith("connect-") ? name : `connect-${name}`;
  return join(homedir(), ".connect", connectorName);
}

/**
 * Get the current profile name for a connector
 */
function getCurrentProfile(name: string): string {
  const configDir = getConnectorConfigDir(name);
  const currentProfileFile = join(configDir, "current_profile");

  if (existsSync(currentProfileFile)) {
    try {
      return readFileSync(currentProfileFile, "utf-8").trim() || "default";
    } catch {
      return "default";
    }
  }
  return "default";
}

/**
 * Load the profile config for a connector (handles both file patterns)
 */
function loadProfileConfig(name: string): Record<string, unknown> {
  const configDir = getConnectorConfigDir(name);
  const profile = getCurrentProfile(name);

  // Pattern 1: profiles/<name>.json (e.g., Stripe)
  const profileFile = join(configDir, "profiles", `${profile}.json`);
  if (existsSync(profileFile)) {
    try {
      return JSON.parse(readFileSync(profileFile, "utf-8"));
    } catch {
      // fall through
    }
  }

  // Pattern 2: profiles/<name>/config.json (e.g., Gmail)
  const profileDirConfig = join(configDir, "profiles", profile, "config.json");
  if (existsSync(profileDirConfig)) {
    try {
      return JSON.parse(readFileSync(profileDirConfig, "utf-8"));
    } catch {
      // fall through
    }
  }

  return {};
}

/**
 * Load OAuth tokens for a connector
 */
function loadTokens(name: string): OAuthTokens | null {
  const configDir = getConnectorConfigDir(name);
  const profile = getCurrentProfile(name);

  // Pattern: profiles/<name>/tokens.json (e.g., Gmail)
  const tokensFile = join(configDir, "profiles", profile, "tokens.json");
  if (existsSync(tokensFile)) {
    try {
      return JSON.parse(readFileSync(tokensFile, "utf-8"));
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Get the full auth status for a connector
 */
export function getAuthStatus(name: string): AuthStatus {
  const authType = getAuthType(name);
  const docs = getConnectorDocs(name);

  // Build env vars list with set/unset status
  const envVars = (docs?.envVars || []).map((v) => ({
    variable: v.variable,
    description: v.description,
    set: !!process.env[v.variable],
  }));

  if (authType === "oauth") {
    const tokens = loadTokens(name);
    const config = loadProfileConfig(name);
    const hasTokens = !!tokens?.accessToken;
    const hasRefreshToken = !!tokens?.refreshToken;
    const tokenExpiry = tokens?.expiresAt;

    return {
      type: "oauth",
      configured: hasTokens || hasRefreshToken,
      tokenExpiry,
      hasRefreshToken,
      envVars,
    };
  }

  // API key / Bearer token
  const config = loadProfileConfig(name);
  const hasKey = Object.values(config).some(
    (v) => typeof v === "string" && v.length > 0
  );
  const hasEnvVar = envVars.some((v) => v.set);

  return {
    type: authType,
    configured: hasKey || hasEnvVar,
    envVars,
  };
}

/**
 * Get required env var names from a connector's CLAUDE.md
 */
export function getEnvVars(name: string): { variable: string; description: string }[] {
  const docs = getConnectorDocs(name);
  return docs?.envVars || [];
}

/**
 * Save an API key to a connector's profile
 */
export function saveApiKey(name: string, key: string, field?: string): void {
  const configDir = getConnectorConfigDir(name);
  const profile = getCurrentProfile(name);

  // Determine which field to save the key as
  const keyField = field || guessKeyField(name);

  // Try pattern 1: profiles/<name>.json
  const profileFile = join(configDir, "profiles", `${profile}.json`);
  const profileDir = join(configDir, "profiles", profile);

  if (existsSync(profileFile)) {
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(readFileSync(profileFile, "utf-8")); } catch { /* use empty */ }
    config[keyField] = key;
    writeFileSync(profileFile, JSON.stringify(config, null, 2));
    return;
  }

  // Try pattern 2: profiles/<name>/config.json
  if (existsSync(profileDir)) {
    const configFile = join(profileDir, "config.json");
    let config: Record<string, unknown> = {};
    if (existsSync(configFile)) {
      try { config = JSON.parse(readFileSync(configFile, "utf-8")); } catch { /* use empty */ }
    }
    config[keyField] = key;
    writeFileSync(configFile, JSON.stringify(config, null, 2));
    return;
  }

  // Create new profile (use pattern 1 by default for API key connectors)
  mkdirSync(join(configDir, "profiles"), { recursive: true });
  writeFileSync(profileFile, JSON.stringify({ [keyField]: key }, null, 2));
}

/**
 * Guess the key field name based on connector name
 */
function guessKeyField(name: string): string {
  const docs = getConnectorDocs(name);
  if (!docs?.envVars.length) return "apiKey";

  // Find the primary key env var and derive the field name
  const keyVar = docs.envVars.find(
    (v) =>
      v.variable.includes("API_KEY") ||
      v.variable.includes("API_SECRET") ||
      v.variable.includes("TOKEN") ||
      v.variable.includes("SECRET")
  );

  if (keyVar) {
    // Convert STRIPE_API_KEY -> apiKey
    const parts = keyVar.variable.toLowerCase().split("_");
    // Remove the connector prefix (e.g., "stripe")
    const withoutPrefix = parts.slice(1);
    if (withoutPrefix.length > 0) {
      return withoutPrefix
        .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
        .join("");
    }
  }

  return "apiKey";
}

/**
 * Get OAuth client credentials for a connector
 */
export function getOAuthConfig(name: string): { clientId?: string; clientSecret?: string } {
  const configDir = getConnectorConfigDir(name);

  // Check credentials.json at base level (shared across profiles)
  const credentialsFile = join(configDir, "credentials.json");
  if (existsSync(credentialsFile)) {
    try {
      const creds = JSON.parse(readFileSync(credentialsFile, "utf-8"));
      return { clientId: creds.clientId, clientSecret: creds.clientSecret };
    } catch {
      // fall through
    }
  }

  // Check profile config
  const config = loadProfileConfig(name);
  return {
    clientId: config.clientId as string | undefined,
    clientSecret: config.clientSecret as string | undefined,
  };
}

/**
 * Build OAuth authorization URL for a connector
 */
export function getOAuthStartUrl(name: string, redirectUri: string): string | null {
  const oauthConfig = getOAuthConfig(name);
  if (!oauthConfig.clientId) return null;

  const scopes = GOOGLE_SCOPES[name];
  if (!scopes) return null;

  // Generate CSRF state token
  const state = randomBytes(32).toString("hex");
  oauthStateStore.set(state, { connector: name, createdAt: Date.now() });

  // Clean up stale state entries (older than 10 minutes)
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of oauthStateStore) {
    if (val.createdAt < tenMinutesAgo) oauthStateStore.delete(key);
  }

  const params = new URLSearchParams({
    client_id: oauthConfig.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Validate and consume an OAuth state token (CSRF protection)
 */
export function validateOAuthState(state: string | null, expectedConnector: string): boolean {
  if (!state) return false;
  const entry = oauthStateStore.get(state);
  if (!entry || entry.connector !== expectedConnector) return false;
  oauthStateStore.delete(state);
  // Reject if older than 10 minutes
  return Date.now() - entry.createdAt < 10 * 60 * 1000;
}

/**
 * Exchange an OAuth authorization code for tokens
 */
export async function exchangeOAuthCode(
  name: string,
  code: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const oauthConfig = getOAuthConfig(name);
  if (!oauthConfig.clientId || !oauthConfig.clientSecret) {
    throw new Error("OAuth credentials not configured for " + name);
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(
      `Token exchange failed: ${(error as Record<string, string>).error_description || (error as Record<string, string>).error || response.statusText}`
    );
  }

  const data = (await response.json()) as Record<string, unknown>;

  const tokens: OAuthTokens = {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
    tokenType: data.token_type as string,
    scope: data.scope as string,
  };

  // Save tokens
  saveOAuthTokens(name, tokens);
  return tokens;
}

/**
 * Save OAuth tokens to the connector's profile directory
 */
function saveOAuthTokens(name: string, tokens: OAuthTokens): void {
  const configDir = getConnectorConfigDir(name);
  const profile = getCurrentProfile(name);
  const profileDir = join(configDir, "profiles", profile);

  mkdirSync(profileDir, { recursive: true });
  const tokensFile = join(profileDir, "tokens.json");
  writeFileSync(tokensFile, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

/**
 * Refresh an OAuth token using the stored refresh token
 */
export async function refreshOAuthToken(name: string): Promise<OAuthTokens> {
  const oauthConfig = getOAuthConfig(name);
  const currentTokens = loadTokens(name);

  if (!oauthConfig.clientId || !oauthConfig.clientSecret) {
    throw new Error("OAuth credentials not configured for " + name);
  }

  if (!currentTokens?.refreshToken) {
    throw new Error("No refresh token available. Please re-authenticate.");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      refresh_token: currentTokens.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(
      `Token refresh failed: ${(error as Record<string, string>).error_description || (error as Record<string, string>).error}`
    );
  }

  const data = (await response.json()) as Record<string, unknown>;

  const tokens: OAuthTokens = {
    accessToken: data.access_token as string,
    refreshToken: currentTokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
    tokenType: data.token_type as string,
    scope: (data.scope as string) || currentTokens.scope,
  };

  saveOAuthTokens(name, tokens);
  return tokens;
}

/**
 * Get token expiry time for an OAuth connector
 */
export function getTokenExpiry(name: string): number | null {
  const tokens = loadTokens(name);
  return tokens?.expiresAt || null;
}
