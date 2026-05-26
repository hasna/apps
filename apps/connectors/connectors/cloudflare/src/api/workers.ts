import type { CloudflareClient } from './client';
import type { Worker, WorkerRoute, WorkerDeployment, CreateWorkerParams, CloudflareResponse } from '../types';

export class WorkersApi {
  constructor(private client: CloudflareClient) {}

  /**
   * List all Workers scripts for an account
   */
  async list(accountId: string): Promise<CloudflareResponse<Worker[]>> {
    return this.client.get<Worker[]>(`/accounts/${accountId}/workers/scripts`);
  }

  /**
   * Get Worker script details
   */
  async get(accountId: string, scriptName: string): Promise<Worker> {
    const response = await this.client.get<Worker>(`/accounts/${accountId}/workers/scripts/${scriptName}`);
    return response.result;
  }

  /**
   * Download Worker script content
   */
  async getContent(accountId: string, scriptName: string): Promise<string> {
    return this.client.request<string>(`/accounts/${accountId}/workers/scripts/${scriptName}`, {
      method: 'GET',
      headers: { 'Accept': 'application/javascript' },
    });
  }

  /**
   * Create or update a Worker script
   */
  async create(accountId: string, scriptName: string, params: CreateWorkerParams): Promise<Worker> {
    const metadata: Record<string, unknown> = {
      main_module: 'index.js',
    };

    if (params.bindings) {
      metadata.bindings = params.bindings;
    }
    if (params.compatibility_date) {
      metadata.compatibility_date = params.compatibility_date;
    }
    if (params.compatibility_flags) {
      metadata.compatibility_flags = params.compatibility_flags;
    }
    if (params.usage_model) {
      metadata.usage_model = params.usage_model;
    }

    const response = await this.client.uploadWorkerScript(accountId, scriptName, params.script, metadata);
    return response.result as Worker;
  }

  /**
   * Update a Worker script (alias for create)
   */
  async update(accountId: string, scriptName: string, params: CreateWorkerParams): Promise<Worker> {
    return this.create(accountId, scriptName, params);
  }

  /**
   * Delete a Worker script
   */
  async delete(accountId: string, scriptName: string): Promise<void> {
    await this.client.delete(`/accounts/${accountId}/workers/scripts/${scriptName}`);
  }

  /**
   * Get Worker script settings
   */
  async getSettings(accountId: string, scriptName: string): Promise<Record<string, unknown>> {
    const response = await this.client.get<Record<string, unknown>>(
      `/accounts/${accountId}/workers/scripts/${scriptName}/settings`
    );
    return response.result;
  }

  /**
   * Update Worker script settings
   */
  async updateSettings(
    accountId: string,
    scriptName: string,
    settings: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const response = await this.client.patch<Record<string, unknown>>(
      `/accounts/${accountId}/workers/scripts/${scriptName}/settings`,
      settings
    );
    return response.result;
  }

  // ============================================
  // Worker Routes (Zone-level)
  // ============================================

  /**
   * List Worker routes for a zone
   */
  async listRoutes(zoneId: string): Promise<CloudflareResponse<WorkerRoute[]>> {
    return this.client.get<WorkerRoute[]>(`/zones/${zoneId}/workers/routes`);
  }

  /**
   * Get a Worker route
   */
  async getRoute(zoneId: string, routeId: string): Promise<WorkerRoute> {
    const response = await this.client.get<WorkerRoute>(`/zones/${zoneId}/workers/routes/${routeId}`);
    return response.result;
  }

  /**
   * Create a Worker route
   */
  async createRoute(zoneId: string, pattern: string, script?: string): Promise<WorkerRoute> {
    const response = await this.client.post<WorkerRoute>(`/zones/${zoneId}/workers/routes`, {
      pattern,
      script,
    });
    return response.result;
  }

  /**
   * Update a Worker route
   */
  async updateRoute(zoneId: string, routeId: string, pattern: string, script?: string): Promise<WorkerRoute> {
    const response = await this.client.put<WorkerRoute>(`/zones/${zoneId}/workers/routes/${routeId}`, {
      pattern,
      script,
    });
    return response.result;
  }

  /**
   * Delete a Worker route
   */
  async deleteRoute(zoneId: string, routeId: string): Promise<{ id: string }> {
    const response = await this.client.delete<{ id: string }>(`/zones/${zoneId}/workers/routes/${routeId}`);
    return response.result;
  }

  // ============================================
  // Worker Deployments
  // ============================================

  /**
   * List deployments for a Worker
   */
  async listDeployments(accountId: string, scriptName: string): Promise<CloudflareResponse<WorkerDeployment[]>> {
    return this.client.get<WorkerDeployment[]>(
      `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`
    );
  }

  /**
   * Create a new deployment (deploy the Worker)
   */
  async deploy(
    accountId: string,
    scriptName: string,
    options?: {
      strategy?: 'percentage' | 'all';
      annotations?: Record<string, string>;
    }
  ): Promise<WorkerDeployment> {
    const body: Record<string, unknown> = {};
    if (options?.strategy) {
      body.strategy = options.strategy;
    }
    if (options?.annotations) {
      body.annotations = options.annotations;
    }

    const response = await this.client.post<WorkerDeployment>(
      `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`,
      Object.keys(body).length > 0 ? body : undefined
    );
    return response.result;
  }

  // ============================================
  // Worker Subdomain
  // ============================================

  /**
   * Get Workers subdomain for an account
   */
  async getSubdomain(accountId: string): Promise<{ subdomain: string }> {
    const response = await this.client.get<{ subdomain: string }>(
      `/accounts/${accountId}/workers/subdomain`
    );
    return response.result;
  }

  /**
   * Create Workers subdomain for an account
   */
  async createSubdomain(accountId: string, subdomain: string): Promise<{ subdomain: string }> {
    const response = await this.client.put<{ subdomain: string }>(
      `/accounts/${accountId}/workers/subdomain`,
      { subdomain }
    );
    return response.result;
  }

  // ============================================
  // Worker Tail (Logs)
  // ============================================

  /**
   * Start a tail session for a Worker
   */
  async startTail(accountId: string, scriptName: string): Promise<{
    id: string;
    url: string;
    expires_at: string;
  }> {
    const response = await this.client.post<{
      id: string;
      url: string;
      expires_at: string;
    }>(`/accounts/${accountId}/workers/scripts/${scriptName}/tails`);
    return response.result;
  }

  /**
   * Delete a tail session
   */
  async deleteTail(accountId: string, scriptName: string, tailId: string): Promise<void> {
    await this.client.delete(`/accounts/${accountId}/workers/scripts/${scriptName}/tails/${tailId}`);
  }
}
