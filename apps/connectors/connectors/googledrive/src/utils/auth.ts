import { createServer } from 'http';
import type { OAuth2Tokens } from '../types/index.ts';
import { saveTokens, getClientId, getClientSecret, loadTokens } from './config.ts';

// Google OAuth2 endpoints
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Google Drive API scopes
const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

const REDIRECT_PORT = 8090;
const REDIRECT_URI = 'http://localhost:' + REDIRECT_PORT + '/callback';

export interface AuthResult {
  success: boolean;
  tokens?: OAuth2Tokens;
  error?: string;
}

/**
 * Generate the OAuth2 authorization URL
 */
export function getAuthUrl(): string {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error('Client ID not configured. Run "connect-googledrive config set-credentials" first.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: DRIVE_SCOPES,
    access_type: 'offline',
    prompt: 'consent', // Force consent to get refresh token
  });

  return GOOGLE_AUTH_URL + '?' + params.toString();
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<OAuth2Tokens> {
  const clientId = getClientId();
  const clientSecret = getClientSecret();

  if (!clientId || !clientSecret) {
    throw new Error('OAuth credentials not configured');
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json() as { error_description?: string; error?: string };
    throw new Error('Token exchange failed: ' + (errorData.error_description || errorData.error));
  }

  const data = await response.json() as { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string };

  const tokens: OAuth2Tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
  };

  saveTokens(tokens);
  return tokens;
}

/**
 * Refresh the access token using the refresh token
 */
export async function refreshAccessToken(): Promise<OAuth2Tokens> {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const currentTokens = loadTokens();

  if (!clientId || !clientSecret) {
    throw new Error('OAuth credentials not configured');
  }

  if (!currentTokens?.refreshToken) {
    throw new Error('No refresh token available. Please login again.');
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: currentTokens.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json() as { error_description?: string; error?: string };
    throw new Error('Token refresh failed: ' + (errorData.error_description || errorData.error));
  }

  const data = await response.json() as { access_token: string; expires_in: number; token_type: string; scope?: string };

  const tokens: OAuth2Tokens = {
    accessToken: data.access_token,
    refreshToken: currentTokens.refreshToken, // Keep the original refresh token
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope || currentTokens.scope,
  };

  saveTokens(tokens);
  return tokens;
}

/**
 * Start a local HTTP server to receive the OAuth callback
 */
export function startCallbackServer(): Promise<AuthResult> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', 'http://localhost:' + REDIRECT_PORT);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;"><div style="text-align: center;"><h1 style="color: #dc3545;">Authentication Failed</h1><p>Error: ' + error + '</p><p>You can close this window.</p></div></body></html>');
          server.close();
          resolve({ success: false, error });
          return;
        }

        if (code) {
          try {
            const tokens = await exchangeCodeForTokens(code);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;"><div style="text-align: center;"><h1 style="color: #28a745;">Authentication Successful!</h1><p>You can close this window and return to the terminal.</p></div></body></html>');
            server.close();
            resolve({ success: true, tokens });
          } catch (err) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;"><div style="text-align: center;"><h1 style="color: #dc3545;">Authentication Failed</h1><p>Error: ' + String(err) + '</p><p>You can close this window.</p></div></body></html>');
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
 */
export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();

  if (!tokens) {
    throw new Error('Not authenticated. Run "connect-googledrive auth login" first.');
  }

  // Check if token is expired or will expire in next 5 minutes
  if (Date.now() >= tokens.expiresAt - 5 * 60 * 1000) {
    const newTokens = await refreshAccessToken();
    return newTokens.accessToken;
  }

  return tokens.accessToken;
}
