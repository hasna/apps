import { createServer } from 'http';
import type { OAuth2Tokens } from '../types';
import {
  getClientId,
  getClientSecret,
  loadOAuthTokens,
  saveOAuthTokens,
} from './config';

const AUTH_URL = 'https://api.ticketbud.com/oauth/authorize';
const TOKEN_URL = 'https://api.ticketbud.com/oauth/token';

const REDIRECT_PORT = 8089;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

export interface AuthResult {
  success: boolean;
  tokens?: OAuth2Tokens;
  error?: string;
}

export function getAuthUrl(): string {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error('OAuth client ID not configured. Run "connect-ticketbud config set-credentials" first.');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_url: REDIRECT_URI,
  });

  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<OAuth2Tokens> {
  const clientId = getClientId();
  const clientSecret = getClientSecret();

  if (!clientId || !clientSecret) {
    throw new Error('OAuth credentials not configured');
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Token exchange failed: ${error.error_description || error.error || response.statusText}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    tokenType: data.token_type,
    scope: data.scope,
  };
}

export async function refreshAccessToken(): Promise<OAuth2Tokens> {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const currentTokens = loadOAuthTokens();

  if (!clientId || !clientSecret) {
    throw new Error('OAuth credentials not configured');
  }
  if (!currentTokens?.refreshToken) {
    throw new Error('No refresh token available. Please login again.');
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: currentTokens.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Token refresh failed: ${error.error_description || error.error || response.statusText}`);
  }

  const data = await response.json();
  const tokens: OAuth2Tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || currentTokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    tokenType: data.token_type,
    scope: data.scope || currentTokens.scope,
  };

  saveOAuthTokens(tokens);
  return tokens;
}

export function startCallbackServer(): Promise<AuthResult> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname !== '/callback') {
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Authentication Failed</h1><p>${error}</p></body></html>`);
        server.close();
        resolve({ success: false, error });
        return;
      }

      if (!code) {
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens(code);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Authentication Successful</h1><p>You can close this window.</p></body></html>');
        server.close();
        resolve({ success: true, tokens });
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Authentication Failed</h1><p>${String(err)}</p></body></html>`);
        server.close();
        resolve({ success: false, error: String(err) });
      }
    });

    server.listen(REDIRECT_PORT);

    setTimeout(() => {
      server.close();
      resolve({ success: false, error: 'Authentication timed out' });
    }, 5 * 60 * 1000);
  });
}

export async function getValidAccessToken(bufferMs = 5 * 60 * 1000): Promise<string> {
  const tokens = loadOAuthTokens();
  if (!tokens) {
    throw new Error('Not authenticated. Run "connect-ticketbud oauth login" first.');
  }

  if (tokens.expiresAt && Date.now() >= tokens.expiresAt - bufferMs) {
    const refreshed = await refreshAccessToken();
    return refreshed.accessToken;
  }

  return tokens.accessToken;
}

export function getRedirectUri(): string {
  return REDIRECT_URI;
}

export function getRedirectPort(): number {
  return REDIRECT_PORT;
}
