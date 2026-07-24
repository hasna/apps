import { VertexAiClient } from './client';
import {
  getAccessToken,
  getClientId,
  getClientSecret,
  getLocation,
  getProjectId,
  getRefreshToken,
  isTokenExpired,
  setTokens,
} from '../utils/config';
import type { VertexAiConfig } from '../types';

export { VertexAiClient, VERTEX_AI_SCOPES, parseContentsJson, parseContentPartsJson } from './client';

export class VertexAI {
  readonly client: VertexAiClient;

  constructor(config?: Partial<VertexAiConfig>) {
    const accessToken = config?.accessToken ?? getAccessToken();
    if (!accessToken) {
      throw new Error('Not authenticated. Run connect-vertex-ai auth login first.');
    }

    this.client = new VertexAiClient({
      accessToken,
      refreshToken: config?.refreshToken ?? getRefreshToken(),
      clientId: config?.clientId ?? getClientId(),
      clientSecret: config?.clientSecret ?? getClientSecret(),
      projectId: config?.projectId ?? getProjectId(),
      location: config?.location ?? getLocation(),
    });
  }

  static create(): VertexAI {
    return new VertexAI();
  }

  static async fromEnv(): Promise<VertexAI> {
    const accessToken = process.env.VERTEX_AI_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('VERTEX_AI_ACCESS_TOKEN is required');
    }
    return new VertexAI({
      accessToken,
      refreshToken: process.env.VERTEX_AI_REFRESH_TOKEN,
      clientId: process.env.VERTEX_AI_CLIENT_ID,
      clientSecret: process.env.VERTEX_AI_CLIENT_SECRET,
      projectId: process.env.VERTEX_AI_PROJECT_ID,
      location: process.env.VERTEX_AI_LOCATION,
    });
  }

  static async ensureAuthenticated(): Promise<VertexAI> {
    let accessToken = getAccessToken();
    const refreshToken = getRefreshToken();
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    if ((!accessToken || isTokenExpired()) && refreshToken && clientId && clientSecret) {
      const client = new VertexAiClient({
        accessToken: accessToken || 'placeholder',
        refreshToken,
        clientId,
        clientSecret,
        location: getLocation(),
      });
      const tokens = await client.refreshAccessToken();
      accessToken = tokens.accessToken;
      setTokens({ accessToken: tokens.accessToken, expiresIn: tokens.expiresIn });
    }

    if (!accessToken) {
      throw new Error('Not authenticated. Run connect-vertex-ai auth login first.');
    }

    return new VertexAI({ accessToken });
  }

  requireProjectId(projectId?: string): string {
    const resolved = projectId ?? this.client.getProjectId() ?? getProjectId();
    if (!resolved) {
      throw new Error('Project ID is required. Set VERTEX_AI_PROJECT_ID or run connect-vertex-ai config set-project <id>.');
    }
    return resolved;
  }
}
