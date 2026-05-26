import { createServer } from 'http';
import type { OAuth2Tokens } from '../types';
import { saveTokens, getClientId, getClientSecret, loadTokens } from './config';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Google Ads API scope
const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';

const REDIRECT_PORT = 8091;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

export interface AuthResult {
  success: boolean;
  tokens?: OAuth2Tokens;
  error?: string;
}

export function getAuthUrl(): string {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error('Client ID not configured. Run "connect-googleads auth setup" first.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: GOOGLE_ADS_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

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
    const error = await response.json();
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
    const error = await response.json();
    throw new Error(`Token refresh failed: ${error.error_description || error.error}`);
  }

  const data = await response.json();

  const tokens: OAuth2Tokens = {
    accessToken: data.access_token,
    refreshToken: currentTokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope || currentTokens.scope,
  };

  saveTokens(tokens);
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
      // Server ready
    });

    setTimeout(() => {
      server.close();
      resolve({ success: false, error: 'Authentication timed out' });
    }, 5 * 60 * 1000);
  });
}

export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();

  if (!tokens) {
    throw new Error('Not authenticated. Run "connect-googleads auth login" first.');
  }

  if (Date.now() >= tokens.expiresAt - 5 * 60 * 1000) {
    const newTokens = await refreshAccessToken();
    return newTokens.accessToken;
  }

  return tokens.accessToken;
}
