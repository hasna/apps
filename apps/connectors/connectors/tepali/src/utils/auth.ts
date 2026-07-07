import type { ConnectorConfig } from '../types';
import { getApiKey, getBaseUrl } from './config';

export interface ResolvedCredentials {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Resolve Tepali credentials from (in priority order) the process environment
 * and the active configuration profile. Returns null when no API key is found.
 */
export function resolveCredentials(): ResolvedCredentials | null {
  const apiKey = getApiKey();
  if (!apiKey) {
    return null;
  }
  return { apiKey, baseUrl: getBaseUrl() };
}

/**
 * Build a ConnectorConfig from resolved credentials for constructing a client.
 */
export function buildConfig(overrides?: Partial<ConnectorConfig>): ConnectorConfig | null {
  const creds = resolveCredentials();
  if (!creds) {
    return null;
  }
  return {
    apiKey: creds.apiKey,
    baseUrl: creds.baseUrl,
    ...overrides,
  };
}

/**
 * Build the Authorization header value for Tepali's Bearer token auth.
 */
export function buildAuthHeader(apiKey: string): string {
  return `Bearer ${apiKey}`;
}
