import { createServer } from 'http';
import type { OAuth2Tokens } from '../types';
import { getOAuthConfig, loadOAuthTokens, saveOAuthTokens } from './config';

const DEFAULT_AUTH_URL = 'https://accounts.zoho.com/oauth/v2/auth';
const DEFAULT_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token';
const DEFAULT_SCOPES = 'ZohoSurvey.survey.READ,ZohoSurvey.survey.CREATE';

const REDIRECT_PORT = 8094;
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
  extraParams?: Record<string, string>;
}

export function getAuthUrl(options: AuthUrlOptions = {}): string {
  const config = getOAuthConfig();
  if (!config?.clientId) {
    throw new Error('OAuth client ID not configured. Run "zoho-survey config set-credentials" first.');
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: options.scopes || DEFAULT_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    ...(options.state && { state: options.state }),
    ...options.extraParams,
  });

  return `${options.authUrl || DEFAULT_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  tokenUrl: string = DEFAULT_TOKEN_URL,
): Promise<OAuth2Tokens> {
  const config = getOAuthConfig();
  if (!config?.clientId || !config?.clientSecret) {
    throw new Error('OAuth credentials not configured');
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
  };
}

export async function refreshAccessToken(tokenUrl: string = DEFAULT_TOKEN_URL): Promise<OAuth2Tokens> {
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
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
    refreshToken: data.refresh_token || currentTokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope || currentTokens.scope,
  };
  saveOAuthTokens(tokens);
  return tokens;
}

export function startCallbackServer(): Promise<AuthResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;

    const finish = (result: AuthResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      resolve(result);
    };

    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Not Found</h1></body></html>');
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Authentication Failed</h1><p>${error}</p></body></html>`);
        finish({ success: false, error });
        return;
      }

      if (code) {
        try {
          const tokens = await exchangeCodeForTokens(code);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authentication Successful</h1><p>Return to the terminal.</p></body></html>');
          finish({ success: true, tokens });
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authentication Failed</h1><p>${String(err)}</p></body></html>`);
          finish({ success: false, error: String(err) });
        }
        return;
      }

      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Authentication Failed</h1><p>Missing authorization code.</p></body></html>');
      finish({ success: false, error: 'Missing authorization code' });
    });

    server.listen(REDIRECT_PORT);
    timeout = setTimeout(() => {
      finish({ success: false, error: 'Authentication timed out' });
    }, 5 * 60 * 1000);
  });
}

export async function getValidAccessToken(
  tokenUrl: string = DEFAULT_TOKEN_URL,
  bufferMs: number = 5 * 60 * 1000,
): Promise<string> {
  const tokens = loadOAuthTokens();
  if (!tokens) throw new Error('Not authenticated. Run "zoho-survey auth login" first.');
  if (Date.now() >= tokens.expiresAt - bufferMs) {
    const refreshed = await refreshAccessToken(tokenUrl);
    return refreshed.accessToken;
  }
  return tokens.accessToken;
}

export function isAuthenticated(): boolean {
  return !!loadOAuthTokens()?.accessToken;
}

export function getRedirectUri(): string {
  return REDIRECT_URI;
}

export function getRedirectPort(): number {
  return REDIRECT_PORT;
}

export { DEFAULT_AUTH_URL, DEFAULT_TOKEN_URL, DEFAULT_SCOPES };
