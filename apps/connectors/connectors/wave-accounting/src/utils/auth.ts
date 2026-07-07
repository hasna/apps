import { createServer } from 'http';
import type { OAuth2Tokens } from '../types';
import { saveOAuthTokens, loadOAuthTokens, getOAuthConfig } from './config';

const DEFAULT_AUTH_URL = 'https://api.waveapps.com/oauth2/authorize/';
const DEFAULT_TOKEN_URL = 'https://api.waveapps.com/oauth2/token/';

// Wave OAuth scopes for accounting/invoicing operations
// https://developer.waveapps.com/hc/en-us/articles/360032818132-OAuth-Scopes
const DEFAULT_SCOPES = [
  'business:read',
  'invoice:read',
  'invoice:write',
  'customer:read',
  'customer:write',
  'account:read',
].join(' ');

const REDIRECT_PORT = 8091;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

export interface AuthResult {
  success: boolean;
  tokens?: OAuth2Tokens;
  error?: string;
}

export interface AuthUrlOptions {
  authUrl?: string;
  scopes?: string;
  state?: string;
  businessId?: string;
  extraParams?: Record<string, string>;
}

export function getAuthUrl(options: AuthUrlOptions = {}): string {
  const config = getOAuthConfig();
  if (!config?.clientId) {
    throw new Error('OAuth client ID not configured. Run "config set-credentials" first.');
  }

  const authUrl = options.authUrl || DEFAULT_AUTH_URL;
  const scopes = options.scopes || DEFAULT_SCOPES;

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: scopes,
    ...(options.state && { state: options.state }),
    ...(options.businessId && { businessId: options.businessId }),
    ...options.extraParams,
  });

  return `${authUrl}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  tokenUrl: string = DEFAULT_TOKEN_URL
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
    const errBody = error as { error?: string; error_description?: string };
    throw new Error(`Token exchange failed: ${errBody.error_description || errBody.error}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type?: string;
    scope?: string;
    business_id?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
    businessId: data.business_id,
  };
}

export async function refreshAccessToken(
  tokenUrl: string = DEFAULT_TOKEN_URL
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
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    const errBody = error as { error?: string; error_description?: string };
    throw new Error(`Token refresh failed: ${errBody.error_description || errBody.error}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type?: string;
    scope?: string;
    business_id?: string;
  };

  const tokens: OAuth2Tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || currentTokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope || currentTokens.scope,
    businessId: data.business_id || currentTokens.businessId,
  };

  saveOAuthTokens(tokens);
  return tokens;
}

export function startCallbackServer(): Promise<AuthResult> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authentication Failed</h1><p>${error}</p></body></html>`);
          server.close();
          resolve({ success: false, error });
          return;
        }

        if (code) {
          try {
            const tokens = await exchangeCodeForTokens(code);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Authentication Successful</h1><p>Return to the terminal.</p></body></html>');
            server.close();
            resolve({ success: true, tokens });
          } catch (err) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<html><body><h1>Authentication Failed</h1><p>${String(err)}</p></body></html>`);
            server.close();
            resolve({ success: false, error: String(err) });
          }
        }
      }
    });

    server.listen(REDIRECT_PORT);

    setTimeout(() => {
      server.close();
      resolve({ success: false, error: 'Authentication timed out' });
    }, 5 * 60 * 1000);
  });
}

export async function getValidAccessToken(
  tokenUrl: string = DEFAULT_TOKEN_URL,
  bufferMs: number = 5 * 60 * 1000
): Promise<string> {
  const tokens = loadOAuthTokens();

  if (!tokens) {
    throw new Error('Not authenticated. Run "auth login" first.');
  }

  if (Date.now() >= tokens.expiresAt - bufferMs) {
    const newTokens = await refreshAccessToken(tokenUrl);
    return newTokens.accessToken;
  }

  return tokens.accessToken;
}

export function isAuthenticated(): boolean {
  const tokens = loadOAuthTokens();
  return !!tokens?.accessToken;
}

export function getRedirectUri(): string {
  return REDIRECT_URI;
}

export function getRedirectPort(): number {
  return REDIRECT_PORT;
}

export function getDefaultScopes(): string {
  return DEFAULT_SCOPES;
}
