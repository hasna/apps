import type { OAuthTokenResponse } from '../types';
import { TUMBLR_USER_AGENT } from '../constants';

export const TUMBLR_AUTH_URL = 'https://www.tumblr.com/oauth2/authorize';
export const TUMBLR_TOKEN_URL = 'https://api.tumblr.com/v2/oauth2/token';
export const DEFAULT_REDIRECT_URI = 'http://localhost:8889/callback';
export const DEFAULT_SCOPES = ['basic', 'write', 'offline_access'];

export function getAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  scopes: string[],
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    redirect_uri: redirectUri,
  });
  return `${TUMBLR_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<OAuthTokenResponse> {
  const response = await fetch(TUMBLR_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': TUMBLR_USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to exchange code: ${text}`);
  }

  return response.json() as Promise<OAuthTokenResponse>;
}

export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<OAuthTokenResponse> {
  const response = await fetch(TUMBLR_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': TUMBLR_USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to refresh token: ${text}`);
  }

  return response.json() as Promise<OAuthTokenResponse>;
}
