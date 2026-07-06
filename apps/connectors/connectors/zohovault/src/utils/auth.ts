import { createServer } from 'http';
import type { OAuth2Tokens, OAuth2Config } from '../types';
import {
  saveOAuthTokens,
  loadOAuthTokens,
  getOAuthConfig,
  getDataCenter,
  getAccountsServer,
  setDataCenter,
} from './config';

// ============================================
// OAuth2 Authentication Utility
// ============================================

export const ACCOUNTS_BASES: Record<string, string> = {
  com: 'https://accounts.zoho.com',
  eu: 'https://accounts.zoho.eu',
  in: 'https://accounts.zoho.in',
  'com.au': 'https://accounts.zoho.com.au',
  jp: 'https://accounts.zoho.jp',
  ca: 'https://accounts.zohocloud.ca',
  sa: 'https://accounts.zoho.sa',
};

const DEFAULT_SCOPES = [
  'ZohoVault.secrets.ALL',
  'ZohoVault.chambers.ALL',
  'ZohoVault.users.ALL',
  'ZohoVault.audit.ALL',
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

export interface CallbackServerOptions {
  expectedState?: string;
  tokenUrl?: string;
}

export function resolveAccountsBaseUrl(dataCenter: string = getDataCenter()): string {
  const dc = dataCenter.toLowerCase();
  const baseUrl = ACCOUNTS_BASES[dc];
  if (!baseUrl) {
    throw new Error(`Invalid data center "${dc}". Must be one of: ${Object.keys(ACCOUNTS_BASES).join(', ')}`);
  }
  return baseUrl;
}

export function getAuthorizationEndpoint(dataCenter?: string): string {
  return `${resolveAccountsBaseUrl(dataCenter)}/oauth/v2/auth`;
}

export function getTokenEndpoint(dataCenter?: string): string {
  return `${resolveAccountsBaseUrl(dataCenter)}/oauth/v2/token`;
}

function normalizeAccountsServer(accountsServer: string): string {
  const normalized = accountsServer.replace(/\/$/, '');
  const host = new URL(normalized).hostname;
  const knownBase = Object.values(ACCOUNTS_BASES).find((base) => new URL(base).hostname === host);
  if (!knownBase) {
    throw new Error(`Unsupported Zoho accounts server: ${host}`);
  }
  return knownBase;
}

function getStoredTokenEndpoint(): string {
  const accountsServer = getAccountsServer();
  return accountsServer ? `${normalizeAccountsServer(accountsServer)}/oauth/v2/token` : getTokenEndpoint();
}

function getCallbackAccountsServer(url: URL): string | undefined {
  return (
    url.searchParams.get('accounts-server') ||
    url.searchParams.get('accounts_server') ||
    url.searchParams.get('accountsServer') ||
    undefined
  );
}

function getCallbackDataCenter(url: URL): string | undefined {
  const location = url.searchParams.get('location');
  if (location) {
    const normalized = location.toLowerCase();
    if (normalized === 'us') return 'com';
    return normalized;
  }

  const accountsServer = getCallbackAccountsServer(url);
  if (!accountsServer) return undefined;

  const normalizedAccountsServer = normalizeAccountsServer(accountsServer);
  const host = new URL(normalizedAccountsServer).hostname;
  const match = Object.entries(ACCOUNTS_BASES).find(([, base]) => new URL(base).hostname === host);
  return match?.[0];
}

export function getCallbackTokenEndpoint(url: URL, fallbackTokenUrl?: string): string {
  const accountsServer = getCallbackAccountsServer(url);
  if (accountsServer) {
    return `${normalizeAccountsServer(accountsServer)}/oauth/v2/token`;
  }

  const dataCenter = getCallbackDataCenter(url);
  return dataCenter ? getTokenEndpoint(dataCenter) : fallbackTokenUrl || getStoredTokenEndpoint();
}

/**
 * Generate the OAuth2 authorization URL
 */
export function getAuthUrl(options: AuthUrlOptions = {}): string {
  const config = getOAuthConfig();
  if (!config?.clientId) {
    throw new Error('OAuth client ID not configured. Run "config set-credentials" first.');
  }

  const authUrl = options.authUrl || getAuthorizationEndpoint(options.dataCenter);
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
  tokenUrl: string = getStoredTokenEndpoint()
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
    apiDomain: data.api_domain,
  };

  return tokens;
}

/**
 * Refresh the access token using the refresh token
 */
export async function refreshAccessToken(
  tokenUrl: string = getStoredTokenEndpoint()
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
    accountsServer: currentTokens.accountsServer,
    apiDomain: data.api_domain || currentTokens.apiDomain,
  };

  saveOAuthTokens(tokens);
  return tokens;
}

/**
 * Start a local HTTP server to receive the OAuth callback
 */
export function startCallbackServer(options: CallbackServerOptions = {}): Promise<AuthResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;

    const finish = (result: AuthResult): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      server.close();
      resolve(result);
    };

    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const state = url.searchParams.get('state');

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
        finish({ success: false, error });
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
            <html>
              <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                  <h1 style="color: #dc3545;">Authentication Failed</h1>
                  <p>Missing authorization code.</p>
                  <p>You can close this window.</p>
                </div>
              </body>
            </html>
          `);
        finish({ success: false, error: 'Missing authorization code' });
        return;
      }

      if (options.expectedState && state !== options.expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
            <html>
              <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                  <h1 style="color: #dc3545;">Authentication Failed</h1>
                  <p>Invalid authentication state.</p>
                  <p>You can close this window.</p>
                </div>
              </body>
            </html>
          `);
        finish({ success: false, error: 'Invalid authentication state' });
        return;
      }

      try {
        const dataCenter = getCallbackDataCenter(url);
        if (dataCenter) setDataCenter(dataCenter);
        const accountsServer = getCallbackAccountsServer(url);
        const tokens = await exchangeCodeForTokens(code, getCallbackTokenEndpoint(url, options.tokenUrl));
        if (accountsServer) tokens.accountsServer = normalizeAccountsServer(accountsServer);
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
        finish({ success: true, tokens });
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
        finish({ success: false, error: String(err) });
      }
    });

    server.listen(REDIRECT_PORT, 'localhost', () => {
      // Server is ready
    });

    // Timeout after 5 minutes
    timeout = setTimeout(() => {
      finish({ success: false, error: 'Authentication timed out' });
    }, 5 * 60 * 1000);
  });
}

/**
 * Get a valid access token, refreshing if necessary
 * @param tokenUrl - Token endpoint URL for refresh
 * @param bufferMs - Refresh buffer in ms (default: 5 minutes)
 */
export async function getValidAccessToken(
  tokenUrl: string = getStoredTokenEndpoint(),
  bufferMs: number = 5 * 60 * 1000
): Promise<string> {
  const tokens = loadOAuthTokens();

  if (!tokens) {
    throw new Error('Not authenticated. Run "auth login" first.');
  }

  // Check if token is expired or will expire within buffer time
  if (Date.now() >= tokens.expiresAt - bufferMs) {
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
