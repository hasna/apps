import { createServer } from 'http';
import { randomUUID } from 'crypto';
import type { OAuth2Tokens } from '../types';
import { getClientId, getClientSecret, loadTokens, saveTokens } from './config';

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

const REDIRECT_PORT = 8092;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

let pendingAuthState: string | undefined;

export interface AuthResult {
  success: boolean;
  tokens?: OAuth2Tokens;
  error?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getAuthUrl(): string {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error('Client ID not configured. Run "connect-spotify-ads auth setup" first.');
  }

  const state = randomUUID();
  pendingAuthState = state;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    state,
  });

  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

function getBasicAuthHeader(): string {
  const clientId = getClientId();
  const clientSecret = getClientSecret();

  if (!clientId || !clientSecret) {
    throw new Error('OAuth credentials not configured');
  }

  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export async function exchangeCodeForTokens(code: string): Promise<OAuth2Tokens> {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: getBasicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Token exchange failed: ${error.error_description || error.error}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
  };
}

export async function refreshAccessToken(): Promise<OAuth2Tokens> {
  const currentTokens = loadTokens();
  const refreshToken = process.env.SPOTIFY_ADS_REFRESH_TOKEN || currentTokens?.refreshToken;

  if (!refreshToken) {
    throw new Error('No refresh token available. Please login again.');
  }

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: getBasicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
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
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope || currentTokens?.scope,
  };

  saveTokens(tokens);
  return tokens;
}

export function startCallbackServer(): Promise<AuthResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: AuthResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      pendingAuthState = undefined;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      server.close();
      resolve(result);
    };

    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://127.0.0.1:${REDIRECT_PORT}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const state = url.searchParams.get('state');

      if (!pendingAuthState || state !== pendingAuthState) {
        const message = 'Invalid OAuth state';
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Authentication Failed</h1><p>${message}</p></body></html>`);
        finish({ success: false, error: message });
        return;
      }

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Authentication Failed</h1><p>${escapeHtml(error)}</p></body></html>`);
        finish({ success: false, error });
        return;
      }

      if (!code) {
        const message = 'Missing authorization code';
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Authentication Failed</h1><p>${message}</p></body></html>`);
        finish({ success: false, error: message });
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens(code);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Authentication Successful</h1><p>You can close this window.</p></body></html>');
        finish({ success: true, tokens });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Authentication Failed</h1><p>${escapeHtml(message)}</p></body></html>`);
        finish({ success: false, error: message });
      }
    });

    server.listen(REDIRECT_PORT);

    timeoutId = setTimeout(() => {
      finish({ success: false, error: 'Authentication timed out' });
    }, 5 * 60 * 1000);
  });
}

export async function getValidAccessToken(): Promise<string> {
  if (process.env.SPOTIFY_ADS_ACCESS_TOKEN) {
    return process.env.SPOTIFY_ADS_ACCESS_TOKEN;
  }

  const tokens = loadTokens();
  if (!tokens) {
    throw new Error('Not authenticated. Run "connect-spotify-ads auth login" first.');
  }

  if (Date.now() >= tokens.expiresAt - 5 * 60 * 1000) {
    const newTokens = await refreshAccessToken();
    return newTokens.accessToken;
  }

  return tokens.accessToken;
}

export function getRedirectUri(): string {
  return REDIRECT_URI;
}

export function getRedirectPort(): number {
  return REDIRECT_PORT;
}
