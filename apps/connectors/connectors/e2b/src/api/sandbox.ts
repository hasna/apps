import type { E2BClient } from './client';
import type {
  SandboxInfo,
  SandboxCreateOptions,
  SandboxListResponse,
  SandboxKeepAliveOptions,
} from '../types';

/**
 * Sandbox API - Manage E2B sandboxes
 * E2B sandboxes are isolated cloud environments for running code
 */
export class SandboxApi {
  constructor(private readonly client: E2BClient) {}

  /**
   * Create a new sandbox
   * @param options - Sandbox creation options
   * @returns Created sandbox info
   */
  async create(options: SandboxCreateOptions = {}): Promise<SandboxInfo> {
    const body: Record<string, unknown> = {};

    if (options.template) {
      body.templateID = options.template;
    }
    if (options.timeout !== undefined) {
      body.timeout = options.timeout;
    }
    if (options.metadata) {
      body.metadata = options.metadata;
    }
    if (options.envs) {
      body.envVars = options.envs;
    }

    return this.client.post<SandboxInfo>('/sandboxes', body);
  }

  /**
   * List all running sandboxes
   * @returns List of sandbox info
   */
  async list(): Promise<SandboxInfo[]> {
    const response = await this.client.get<SandboxInfo[] | SandboxListResponse>('/sandboxes');

    // Handle both array response and wrapped response
    if (Array.isArray(response)) {
      return response;
    }
    return response.sandboxes || [];
  }

  /**
   * Get information about a specific sandbox
   * @param sandboxId - The sandbox ID
   * @returns Sandbox info
   */
  async get(sandboxId: string): Promise<SandboxInfo> {
    return this.client.get<SandboxInfo>(`/sandboxes/${sandboxId}`);
  }

  /**
   * Kill (terminate) a sandbox
   * @param sandboxId - The sandbox ID to terminate
   */
  async kill(sandboxId: string): Promise<void> {
    await this.client.delete(`/sandboxes/${sandboxId}`);
  }

  /**
   * Extend sandbox lifetime (keep alive)
   * @param sandboxId - The sandbox ID
   * @param options - Keep alive options with new timeout
   * @returns Updated sandbox info
   */
  async keepAlive(sandboxId: string, options: SandboxKeepAliveOptions): Promise<SandboxInfo> {
    return this.client.post<SandboxInfo>(`/sandboxes/${sandboxId}/timeout`, {
      timeout: options.timeout,
    });
  }

  /**
   * Refresh sandbox timeout (alias for keepAlive with default extension)
   * @param sandboxId - The sandbox ID
   * @param timeout - New timeout in milliseconds
   */
  async setTimeout(sandboxId: string, timeout: number): Promise<SandboxInfo> {
    return this.keepAlive(sandboxId, { timeout });
  }
}
