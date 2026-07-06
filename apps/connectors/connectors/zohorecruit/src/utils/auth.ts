import { createServer } from 'http';
import type { OAuth2Tokens, OAuth2Config } from '../types';
import { saveOAuthTokens, loadOAuthTokens, getOAuthConfig, getDataCenter } from './config';

// ============================================
// OAuth2 Authentication Utility
// ============================================

const ZOHO_ACCOUNTS_BASES: Record<string, string> = {
  com: 'https://accounts.zoho.com',
  eu: 'https://accounts.zoho.eu',
  in: 'https://accounts.zoho.in',
  'com.au': 'https://accounts.zoho.com.au',
  jp: 'https://accounts.zoho.jp',
  ca: 'https://accounts.zohocloud.ca',
  sa: 'https://accounts.zoho.sa',
};

// Zoho Recruit scopes — see https://www.zoho.com/recruit/developer-guide/apiv2/scopes.html
const DEFAULT_SCOPES = [
  'ZohoRecruit.modules.ALL',
  'ZohoRecruit.settings.ALL',
  'ZohoRecruit.users.ALL',
].join(',');

const REDIRECT_PORT = 8089;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

export interface AuthResult {
  success: boolean;
  tokens?: OAuth2Tokens;
  error?: string;
}

export interface AuthUrlOptions {
  authUrl?: string;
  dataCenter?: string;
  scopes?: string;
  state?: string;
  extraParams?: Record<string, string>;
}

export function resolveAccountsBaseUrl(dataCenter?: string): string {
  const dc = (dataCenter || getDataCenter() || 'com').toLowerCase();
  const host = ZOHO_ACCOUNTS_BASES[dc];
  if (!host) {
    throw new Error(`Zoho accounts data_center must be one of: ${Object.keys(ZOHO_ACCOUNTS_BASES).join(', ')}`);
  }
  return host;
}

function resolveAuthUrl(dataCenter?: string): string {
  return `${resolveAccountsBaseUrl(dataCenter)}/oauth/v2/auth`;
}

function resolveTokenUrl(dataCenter?: string): string {
  return `${resolveAccountsBaseUrl(dataCenter)}/oauth/v2/token`;
}

/**
 * Generate the OAuth2 authorization URL
 */
export function getAuthUrl(options: AuthUrlOptions = {}): string {
  const config = getOAuthConfig();
  if (!config?.clientId) {
    throw new Error('OAuth client ID not configured. Run "config set-credentials" first.');
  }

  const authUrl = options.authUrl || resolveAuthUrl(options.dataCenter);
  const scopes = options.scopes || DEFAULT_SCOPES;

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent', // Force consent to get refresh token
    ...(options.state && { state: options.state }),
    ...options.extraParams,
  });

  return `${authUrl}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  tokenUrl: string = resolveTokenUrl()
): Promise<OAuth2Tokens> {
  const config = getOAuthConfig();

  if (!config?.clientId || !config?.clientSecret) {
    throw new Error('OAuth credentials not configured');
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Token exchange failed: ${error.error_description || error.error}`);
  }

  const data = await response.json();

  const tokens: OAuth2Tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
  };

  return tokens;
}

/**
 * Refresh the access token using the refresh token
 */
export async function refreshAccessToken(
  tokenUrl: string = resolveTokenUrl()
): Promise<OAuth2Tokens> {
  const config = getOAuthConfig();
  const currentTokens = loadOAuthTokens();

  if (!config?.clientId || !config?.clientSecret) {
    throw new Error('OAuth credentials not configured');
  }

  if (!currentTokens?.refreshToken) {
    throw new Error('No refresh token available. Please login again.');
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: currentTokens.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Token refresh failed: ${error.error_description || error.error}`);
  }

  const data = await response.json();

  const tokens: OAuth2Tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || currentTokens.refreshToken, // Keep original if not returned
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope || currentTokens.scope,
  };

  saveOAuthTokens(tokens);
  return tokens;
}

/**
 * Start a local HTTP server to receive the OAuth callback
 */
export function startCallbackServer(): Promise<AuthResult> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                  <h1 style="color: #dc3545;">Authentication Failed</h1>
                  <p>Error: ${error}</p>
                  <p>You can close this window.</p>
                </div>
              </body>
            </html>
          `);
          server.close();
          resolve({ success: false, error });
          return;
        }

        if (code) {
          try {
            const tokens = await exchangeCodeForTokens(code);
            saveOAuthTokens(tokens);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                  <div style="text-align: center;">
                    <h1 style="color: #28a745;">Authentication Successful!</h1>
                    <p>You can close this window and return to the terminal.</p>
                  </div>
                </body>
              </html>
            `);
            server.close();
            resolve({ success: true, tokens });
          } catch (err) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                  <div style="text-align: center;">
                    <h1 style="color: #dc3545;">Authentication Failed</h1>
                    <p>Error: ${String(err)}</p>
                    <p>You can close this window.</p>
                  </div>
                </body>
              </html>
            `);
            server.close();
            resolve({ success: false, error: String(err) });
          }
        }
      }
    });

    server.listen(REDIRECT_PORT, () => {
      // Server is ready
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      resolve({ success: false, error: 'Authentication timed out' });
    }, 5 * 60 * 1000);
  });
}

/**
 * Get a valid access token, refreshing if necessary
 * @param tokenUrl - Token endpoint URL for refresh
 * @param bufferMs - Refresh buffer in ms (default: 5 minutes)
 */
export async function getValidAccessToken(
  tokenUrl: string = resolveTokenUrl(),
  bufferMs: number = 5 * 60 * 1000
): Promise<string> {
  const tokens = loadOAuthTokens();

  if (!tokens) {
    throw new Error('Not authenticated. Run "auth login" first.');
  }

  // Check if token is expired or will expire within buffer time
  if (!tokens.expiresAt || Date.now() >= tokens.expiresAt - bufferMs) {
    const newTokens = await refreshAccessToken(tokenUrl);
    return newTokens.accessToken;
  }

  return tokens.accessToken;
}

/**
 * Check if the user is authenticated
 */
export function isAuthenticated(): boolean {
  const tokens = loadOAuthTokens();
  return !!tokens?.accessToken;
}

/**
 * Get the redirect URI for OAuth configuration
 */
export function getRedirectUri(): string {
  return REDIRECT_URI;
}

/**
 * Get the redirect port for OAuth callback
 */
export function getRedirectPort(): number {
  return REDIRECT_PORT;
}
