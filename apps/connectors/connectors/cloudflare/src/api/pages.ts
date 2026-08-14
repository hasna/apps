import type { CloudflareClient } from './client';
import type { PagesProject, PagesDeployment, CreatePagesProjectParams, CloudflareResponse } from '../types';

export class PagesApi {
  constructor(private client: CloudflareClient) {}

  /**
   * List all Pages projects for an account
   */
  async list(accountId: string): Promise<CloudflareResponse<PagesProject[]>> {
    return this.client.get<PagesProject[]>(`/accounts/${accountId}/pages/projects`);
  }

  /**
   * Get a Pages project
   */
  async get(accountId: string, projectName: string): Promise<PagesProject> {
    const response = await this.client.get<PagesProject>(
      `/accounts/${accountId}/pages/projects/${projectName}`
    );
    return response.result;
  }

  /**
   * Create a new Pages project
   */
  async create(accountId: string, params: CreatePagesProjectParams): Promise<PagesProject> {
    const response = await this.client.post<PagesProject>(
      `/accounts/${accountId}/pages/projects`,
      params as unknown as Record<string, unknown>
    );
    return response.result;
  }

  /**
   * Update a Pages project
   */
  async update(
    accountId: string,
    projectName: string,
    params: Partial<CreatePagesProjectParams>
  ): Promise<PagesProject> {
    const response = await this.client.patch<PagesProject>(
      `/accounts/${accountId}/pages/projects/${projectName}`,
      params as Record<string, unknown>
    );
    return response.result;
  }

  /**
   * Delete a Pages project
   */
  async delete(accountId: string, projectName: string): Promise<void> {
    await this.client.delete(`/accounts/${accountId}/pages/projects/${projectName}`);
  }

  // ============================================
  // Deployments
  // ============================================

  /**
   * List deployments for a Pages project
   */
  async listDeployments(
    accountId: string,
    projectName: string,
    params?: {
      env?: 'production' | 'preview';
      page?: number;
      per_page?: number;
    }
  ): Promise<CloudflareResponse<PagesDeployment[]>> {
    return this.client.get<PagesDeployment[]>(
      `/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      params
    );
  }

  /**
   * Get a specific deployment
   */
  async getDeployment(
    accountId: string,
    projectName: string,
    deploymentId: string
  ): Promise<PagesDeployment> {
    const response = await this.client.get<PagesDeployment>(
      `/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}`
    );
    return response.result;
  }

  /**
   * Create a deployment (trigger a new build)
   */
  async createDeployment(
    accountId: string,
    projectName: string,
    options?: {
      branch?: string;
    }
  ): Promise<PagesDeployment> {
    const formData = new FormData();
    if (options?.branch) {
      formData.append('branch', options.branch);
    }

    const response = await this.client.request<CloudflareResponse<PagesDeployment>>(
      `/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      {
        method: 'POST',
        body: formData,
      }
    );
    return response.result;
  }

  /**
   * Retry a deployment
   */
  async retryDeployment(
    accountId: string,
    projectName: string,
    deploymentId: string
  ): Promise<PagesDeployment> {
    const response = await this.client.post<PagesDeployment>(
      `/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}/retry`
    );
    return response.result;
  }

  /**
   * Rollback to a specific deployment
   */
  async rollback(
    accountId: string,
    projectName: string,
    deploymentId: string
  ): Promise<PagesDeployment> {
    const response = await this.client.post<PagesDeployment>(
      `/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}/rollback`
    );
    return response.result;
  }

  /**
   * Delete a deployment
   */
  async deleteDeployment(
    accountId: string,
    projectName: string,
    deploymentId: string
  ): Promise<void> {
    await this.client.delete(
      `/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}`
    );
  }

  /**
   * Get deployment logs
   */
  async getDeploymentLogs(
    accountId: string,
    projectName: string,
    deploymentId: string
  ): Promise<{
    total: number;
    data: Array<{
      ts: string;
      line: string;
    }>;
  }> {
    const response = await this.client.get<{
      total: number;
      data: Array<{
        ts: string;
        line: string;
      }>;
    }>(
      `/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}/history/logs`
    );
    return response.result;
  }

  // ============================================
  // Domains
  // ============================================

  /**
   * List custom domains for a Pages project
   */
  async listDomains(
    accountId: string,
    projectName: string
  ): Promise<CloudflareResponse<Array<{
    id: string;
    name: string;
    status: string;
    created_on: string;
  }>>> {
    return this.client.get<Array<{
      id: string;
      name: string;
      status: string;
      created_on: string;
    }>>(`/accounts/${accountId}/pages/projects/${projectName}/domains`);
  }

  /**
   * Add a custom domain to a Pages project
   */
  async addDomain(
    accountId: string,
    projectName: string,
    domain: string
  ): Promise<{
    id: string;
    name: string;
    status: string;
  }> {
    const response = await this.client.post<{
      id: string;
      name: string;
      status: string;
    }>(`/accounts/${accountId}/pages/projects/${projectName}/domains`, { name: domain });
    return response.result;
  }

  /**
   * Delete a custom domain from a Pages project
   */
  async deleteDomain(
    accountId: string,
    projectName: string,
    domainName: string
  ): Promise<void> {
    await this.client.delete(
      `/accounts/${accountId}/pages/projects/${projectName}/domains/${domainName}`
    );
  }
}
