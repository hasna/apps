/**
 * OAuth 2.0 Authorization Code Flow with PKCE
 * For user-context authentication (posting tweets, DMs, etc.)
 */

import { createServer, type Server } from 'http';
import { URL } from 'url';
import { randomBytes, createHash } from 'crypto';

// OAuth 2.0 endpoints
const AUTHORIZE_URL = 'https://twitter.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const REVOKE_URL = 'https://api.twitter.com/2/oauth2/revoke';

// Available OAuth 2.0 scopes
export const OAUTH2_SCOPES = {
  // Read
  'tweet.read': 'Read tweets',
  'users.read': 'Read user profiles',
  'follows.read': 'Read follows',
  'list.read': 'Read lists',
  'space.read': 'Read spaces',
  'mute.read': 'Read mutes',
  'like.read': 'Read likes',
  'block.read': 'Read blocks',
  'bookmark.read': 'Read bookmarks',
  // Write
  'tweet.write': 'Post and delete tweets',
  'follows.write': 'Follow and unfollow users',
  'list.write': 'Create, update, delete lists',
  'mute.write': 'Mute and unmute users',
  'like.write': 'Like and unlike tweets',
  'block.write': 'Block and unblock users',
  'bookmark.write': 'Add and remove bookmarks',
  // Direct messages
  'dm.read': 'Read direct messages',
  'dm.write': 'Send direct messages',
  // Offline access (refresh tokens)
  'offline.access': 'Stay logged in (refresh tokens)',
} as const;

export type OAuth2Scope = keyof typeof OAUTH2_SCOPES;

// Default scopes for full access
export const DEFAULT_SCOPES: OAuth2Scope[] = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'follows.read',
  'follows.write',
  'like.read',
  'like.write',
  'bookmark.read',
  'bookmark.write',
  'offline.access',
];

export interface OAuth2Config {
  clientId: string;
  clientSecret?: string; // Optional for public clients
  redirectUri: string;
  scopes?: OAuth2Scope[];
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  expiresAt: number;
  scope: string;
  tokenType: string;
}

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

/**
 * Generate PKCE code verifier and challenge
 */
export function generatePKCE(): PKCEChallenge {
  // Generate random code verifier (43-128 characters)
  const codeVerifier = randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
    .substring(0, 43);

  // Create SHA256 hash and base64url encode it
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  // Generate random state for CSRF protection
  const state = randomBytes(16).toString('hex');

  return { codeVerifier, codeChallenge, state };
}

/**
 * Build OAuth 2.0 authorization URL
 */
export function buildAuthorizationUrl(
  config: OAuth2Config,
  pkce: PKCEChallenge
): string {
  const scopes = config.scopes || DEFAULT_SCOPES;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: scopes.join(' '),
    state: pkce.state,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: 'S256',
    // Force account selection/login (undocumented but may work)
    prompt: 'login',
    force_login: 'true',
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  config: OAuth2Config,
  code: string,
  codeVerifier: string
): Promise<OAuth2Tokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  });

  // For confidential clients, add client_id to body
  // For public clients with secret, use Basic auth
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (config.clientSecret) {
    // Confidential client - use Basic auth
    const credentials = Buffer.from(
      `${config.clientId}:${config.clientSecret}`
    ).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  } else {
    // Public client - include client_id in body
    body.append('client_id', config.clientId);
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  config: OAuth2Config,
  refreshToken: string
): Promise<OAuth2Tokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (config.clientSecret) {
    const credentials = Buffer.from(
      `${config.clientId}:${config.clientSecret}`
    ).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  } else {
    body.append('client_id', config.clientId);
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken, // Keep old if not returned
    expiresIn: data.expires_in,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

/**
 * Revoke a token (access or refresh)
 */
export async function revokeToken(
  config: OAuth2Config,
  token: string,
  tokenTypeHint: 'access_token' | 'refresh_token' = 'access_token'
): Promise<void> {
  const body = new URLSearchParams({
    token,
    token_type_hint: tokenTypeHint,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (config.clientSecret) {
    const credentials = Buffer.from(
      `${config.clientId}:${config.clientSecret}`
    ).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  } else {
    body.append('client_id', config.clientId);
  }

  const response = await fetch(REVOKE_URL, {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token revocation failed: ${errorText}`);
  }
}

/**
 * Start local callback server to receive OAuth redirect
 */
export function startCallbackServer(
  port: number,
  expectedState: string
): Promise<{ code: string; server: Server }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '', `http://localhost:${port}`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1 style="color: #dc2626;">❌ Authorization Failed</h1>
                <p>${errorDescription || error}</p>
                <p style="color: #666;">You can close this window.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error(errorDescription || error));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1 style="color: #dc2626;">❌ Security Error</h1>
                <p>State mismatch - possible CSRF attack.</p>
                <p style="color: #666;">You can close this window.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error('State mismatch - possible CSRF attack'));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1 style="color: #dc2626;">❌ Error</h1>
                <p>No authorization code received.</p>
                <p style="color: #666;">You can close this window.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error('No authorization code received'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1 style="color: #16a34a;">✓ Authorization Successful</h1>
              <p>You can close this window and return to the terminal.</p>
            </body>
          </html>
        `);

        server.close();
        resolve({ code, server });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.on('error', (err) => {
      reject(err);
    });

    server.listen(port, () => {
      // Server started
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out after 5 minutes'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Get the authenticated user's info
 */
export async function getAuthenticatedUser(
  accessToken: string
): Promise<{ id: string; name: string; username: string }> {
  const response = await fetch(
    'https://api.twitter.com/2/users/me?user.fields=id,name,username',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get user info: ${errorText}`);
  }

  const data = (await response.json()) as {
    data: { id: string; name: string; username: string };
  };

  return data.data;
}
