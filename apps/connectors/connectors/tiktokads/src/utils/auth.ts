import { createServer } from 'http';
import type { OAuth2Tokens } from '../types';
import { getClientId, getClientSecret, loadTokens, saveTokens } from './config';

const TIKTOK_AUTH_URL = 'https://business-api.tiktok.com/portal/auth';
const TIKTOK_TOKEN_URL = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/';
const REDIRECT_PORT = 8093;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

export interface AuthResult {
  success: boolean;
  tokens?: OAuth2Tokens;
  error?: string;
}

export function getAuthUrl(): string {
  const appId = getClientId();
  if (!appId) {
    throw new Error('Client ID not configured. Run "connect-tiktokads auth setup" first.');
  }

  const params = new URLSearchParams({
    app_id: appId,
    redirect_uri: REDIRECT_URI,
    state: crypto.randomUUID(),
  });

  return `${TIKTOK_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(authCode: string): Promise<OAuth2Tokens> {
  const appId = getClientId();
  const secret = getClientSecret();

  if (!appId || !secret) {
    throw new Error('OAuth credentials not configured');
  }

  const response = await fetch(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: appId,
      secret,
      auth_code: authCode,
      grant_type: 'authorization_code',
    }),
  });

  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    throw new Error(`Token exchange failed: ${data.message || response.statusText}`);
  }

  const tokenData = data.data;
  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + (tokenData.expires_in || 86400) * 1000,
    tokenType: tokenData.token_type,
    scope: tokenData.scope,
  };
}

export async function refreshAccessToken(): Promise<OAuth2Tokens> {
  const appId = getClientId();
  const secret = getClientSecret();
  const currentTokens = loadTokens();

  if (!appId || !secret) {
    throw new Error('OAuth credentials not configured');
  }
  if (!currentTokens?.refreshToken) {
    throw new Error('No refresh token available. Please login again.');
  }

  const response = await fetch(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: appId,
      secret,
      refresh_token: currentTokens.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    throw new Error(`Token refresh failed: ${data.message || response.statusText}`);
  }

  const tokenData = data.data;
  const tokens: OAuth2Tokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || currentTokens.refreshToken,
    expiresAt: Date.now() + (tokenData.expires_in || 86400) * 1000,
    tokenType: tokenData.token_type,
    scope: tokenData.scope || currentTokens.scope,
  };

  saveTokens(tokens);
  return tokens;
}

export function startCallbackServer(): Promise<AuthResult> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname !== '/callback') return;

      const authCode = url.searchParams.get('auth_code') || url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Authentication Failed</h1><p>${error}</p></body></html>`);
        server.close();
        resolve({ success: false, error });
        return;
      }

      if (authCode) {
        try {
          const tokens = await exchangeCodeForTokens(authCode);
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
      }
    });

    server.listen(REDIRECT_PORT);

    setTimeout(() => {
      server.close();
      resolve({ success: false, error: 'Authentication timed out' });
    }, 5 * 60 * 1000);
  });
}

export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error('Not authenticated. Run "connect-tiktokads auth login" first.');
  }

  if (tokens.expiresAt && Date.now() >= tokens.expiresAt - 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken();
    return refreshed.accessToken;
  }

  return tokens.accessToken;
}
