import { createServer } from 'http';
import type { OAuth2Tokens } from '../types';
import { saveTokens, getClientId, getClientSecret, loadTokens } from './config';

// Notion OAuth2 endpoints
const NOTION_AUTH_URL = 'https://api.notion.com/v1/oauth/authorize';
const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token';

const REDIRECT_PORT = 8089;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

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
    throw new Error('Client ID not configured. Run "connect-notion config set-credentials" first.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    owner: 'user', // Can be 'user' or 'workspace'
  });

  return `${NOTION_AUTH_URL}?${params.toString()}`;
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

  // Notion uses Basic auth for token exchange
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(NOTION_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json() as { error_description?: string; error?: string };
    throw new Error(`Token exchange failed: ${errorData.error_description || errorData.error || JSON.stringify(errorData)}`);
  }

  const data = await response.json() as {
    access_token: string;
    token_type: string;
    bot_id?: string;
    workspace_id?: string;
    workspace_name?: string;
    workspace_icon?: string;
    owner?: { type?: string; user?: { id?: string } };
  };

  // Notion returns: access_token, token_type, bot_id, workspace_id, workspace_name, workspace_icon, owner
  const tokens: OAuth2Tokens = {
    accessToken: data.access_token,
    tokenType: data.token_type,
    botId: data.bot_id,
    workspaceId: data.workspace_id,
    workspaceName: data.workspace_name,
    workspaceIcon: data.workspace_icon,
    ownerType: data.owner?.type,
    ownerUserId: data.owner?.user?.id,
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
                    <p>Connected to workspace: <strong>${tokens.workspaceName || 'Unknown'}</strong></p>
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
 * Get a valid access token
 * Note: Notion tokens don't expire, so no refresh needed
 */
export function getValidAccessToken(): string {
  const tokens = loadTokens();

  if (!tokens?.accessToken) {
    throw new Error('Not authenticated. Run "connect-notion auth login" first.');
  }

  return tokens.accessToken;
}
