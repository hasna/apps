import type { OAuth2Tokens, TokenResponse } from '../types';
import { getCredentials, loadTokens, saveTokens } from './config';

// ============================================
// OAuth2 client_credentials flow
// Docs: https://developers.taboola.com/backstage-api/reference/client-credentials-flow
// ============================================

const DEFAULT_BASE_URL = 'https://backstage.taboola.com/backstage';
const TOKEN_PATH = '/oauth/token';

// Refresh a token this many ms before it actually expires.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

function tokenUrl(baseUrl: string = DEFAULT_BASE_URL): string {
  return `${baseUrl.replace(/\/$/, '')}${TOKEN_PATH}`;
}

/**
 * Fetch a fresh access token from the token endpoint using the configured
 * client credentials, and persist it to the active profile.
 */
export async function fetchAccessToken(baseUrl?: string): Promise<OAuth2Tokens> {
  const credentials = getCredentials();
  if (!credentials) {
    throw new Error(
      'Taboola client credentials not configured. Run "config set-credentials <clientId> <clientSecret>".'
    );
  }

  const response = await fetch(tokenUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    const message =
      (error as Record<string, string>).error_description ||
      (error as Record<string, string>).error ||
      response.statusText;
    throw new Error(`Token request failed: ${message}`);
  }

  const data = (await response.json()) as TokenResponse;

  const tokens: OAuth2Tokens = {
    accessToken: data.access_token,
    tokenType: data.token_type,
    // Taboola tokens are valid for 12h; honor expires_in when provided.
    expiresAt: Date.now() + (data.expires_in ?? 12 * 60 * 60) * 1000,
  };

  saveTokens(tokens);
  return tokens;
}

/**
 * Return a valid access token, fetching a new one if the cached token is
 * missing or about to expire.
 */
export async function getValidAccessToken(baseUrl?: string): Promise<string> {
  const tokens = loadTokens();

  if (tokens && Date.now() < tokens.expiresAt - REFRESH_BUFFER_MS) {
    return tokens.accessToken;
  }

  const fresh = await fetchAccessToken(baseUrl);
  return fresh.accessToken;
}

/** Whether credentials or a cached token are available. */
export function isAuthenticated(): boolean {
  return Boolean(getCredentials() || loadTokens());
}
