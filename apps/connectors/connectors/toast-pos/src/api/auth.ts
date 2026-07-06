import type { ToastAuthResponse, ToastAuthToken } from '../types';
import { ToastApiError } from '../types';
import { loadAuthToken, saveAuthToken } from '../utils/config';

export const DEFAULT_BASE_URL = 'https://ws-api.toasttab.com';
export const AUTH_LOGIN_PATH = '/authentication/v1/authentication/login';
export const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export interface LoginCredentials {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
}

export async function loginWithMachineClient(
  credentials: LoginCredentials,
): Promise<ToastAuthToken> {
  const baseUrl = credentials.baseUrl || DEFAULT_BASE_URL;
  const url = `${baseUrl}${AUTH_LOGIN_PATH}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      userAccessType: 'TOAST_MACHINE_CLIENT',
    }),
  });

  const text = await response.text();
  let data: ToastAuthResponse = {};

  if (text) {
    try {
      data = JSON.parse(text) as ToastAuthResponse;
    } catch {
      throw new ToastApiError(`Authentication failed: invalid JSON response`, response.status);
    }
  }

  if (!response.ok) {
    throw new ToastApiError(
      `Authentication failed: ${data.status || response.statusText}`,
      response.status,
    );
  }

  const accessToken = data.token?.accessToken;
  const expiresIn = data.token?.expiresIn ?? 86400;

  if (!accessToken) {
    throw new ToastApiError('Authentication failed: missing access token', response.status);
  }

  const token: ToastAuthToken = {
    accessToken,
    tokenType: data.token?.tokenType || 'Bearer',
    expiresIn,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: data.token?.scope,
    refreshToken: data.token?.refreshToken,
  };

  saveAuthToken(token);
  return token;
}

export async function getValidAccessToken(credentials: LoginCredentials): Promise<string> {
  const cached = loadAuthToken();
  if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return cached.accessToken;
  }

  const token = await loginWithMachineClient(credentials);
  return token.accessToken;
}
