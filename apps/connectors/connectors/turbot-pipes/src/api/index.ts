import type {
  TurbotPipesConfig,
  TurbotPipesListResponse,
  TurbotPipesQueryRequest,
  TurbotPipesQueryResponse,
  TurbotPipesUser,
  TurbotPipesWorkspace,
} from '../types';
import { TurbotPipesClient } from './client';

export { TurbotPipesClient, encodePathSegment } from './client';

/**
 * Turbot Pipes API wrapper
 */
export class TurbotPipes {
  private readonly client: TurbotPipesClient;

  constructor(config: TurbotPipesConfig) {
    this.client = new TurbotPipesClient(config);
  }

  static fromEnv(): TurbotPipes {
    const apiToken = process.env.TURBOT_PIPES_API_TOKEN;
    if (!apiToken) {
      throw new Error('TURBOT_PIPES_API_TOKEN environment variable is required');
    }
    return new TurbotPipes({ apiToken });
  }

  getClient(): TurbotPipesClient {
    return this.client;
  }

  async getCurrentUser(): Promise<TurbotPipesUser> {
    return this.client.get<TurbotPipesUser>('/user');
  }

  async listWorkspaces(orgHandle: string): Promise<TurbotPipesListResponse<TurbotPipesWorkspace>> {
    return this.client.get<TurbotPipesListResponse<TurbotPipesWorkspace>>(
      `/org/${encodeURIComponent(orgHandle)}/workspace`
    );
  }

  async getWorkspace(orgHandle: string, workspaceHandle: string): Promise<TurbotPipesWorkspace> {
    return this.client.get<TurbotPipesWorkspace>(
      this.client.workspacePath(orgHandle, workspaceHandle)
    );
  }

  async listSnapshots(
    orgHandle: string,
    workspaceHandle: string,
    params?: { limit?: number; next_token?: string }
  ): Promise<TurbotPipesListResponse> {
    return this.client.get<TurbotPipesListResponse>(
      `${this.client.workspacePath(orgHandle, workspaceHandle)}/snapshot`,
      params
    );
  }

  async runQuery(
    orgHandle: string,
    workspaceHandle: string,
    request: TurbotPipesQueryRequest
  ): Promise<TurbotPipesQueryResponse> {
    return this.client.post<TurbotPipesQueryResponse>(
      `${this.client.workspacePath(orgHandle, workspaceHandle)}/query`,
      request
    );
  }

  async listProcesses(
    orgHandle: string,
    workspaceHandle: string,
    params?: { limit?: number; next_token?: string }
  ): Promise<TurbotPipesListResponse> {
    return this.client.get<TurbotPipesListResponse>(
      `${this.client.workspacePath(orgHandle, workspaceHandle)}/process`,
      params
    );
  }

  async validate(): Promise<{ valid: boolean }> {
    try {
      await this.getCurrentUser();
      return { valid: true };
    } catch {
      return { valid: false };
    }
  }
}
