// Buildkite Connector — CI/CD pipelines and build automation
import { BuildkiteClient } from './client';
import type { BuildkiteConfig, BKOrganization, BKPipeline, BKBuild, BKJob, BKAgent } from '../types';
export { BuildkiteClient } from './client';

export class Buildkite {
  private readonly client: BuildkiteClient;
  constructor(config: BuildkiteConfig) { this.client = new BuildkiteClient(config); }
  static fromEnv(): Buildkite {
    const token = process.env.BUILDKITE_TOKEN;
    if (!token) throw new Error('BUILDKITE_TOKEN is required');
    return new Buildkite({ token });
  }

  async listOrganizations(): Promise<BKOrganization[]> { return this.client.request<BKOrganization[]>('/organizations'); }
  async getOrganization(orgSlug: string): Promise<BKOrganization> { return this.client.request<BKOrganization>(`/organizations/${orgSlug}`); }

  async listPipelines(orgSlug: string): Promise<BKPipeline[]> { return this.client.request<BKPipeline[]>(`/organizations/${orgSlug}/pipelines`); }
  async getPipeline(orgSlug: string, pipelineSlug: string): Promise<BKPipeline> {
    return this.client.request<BKPipeline>(`/organizations/${orgSlug}/pipelines/${pipelineSlug}`);
  }
  async createPipeline(orgSlug: string, data: { name: string; repository: string; steps?: Record<string, unknown>[] }): Promise<BKPipeline> {
    return this.client.request<BKPipeline>(`/organizations/${orgSlug}/pipelines`, { method: 'POST', body: data as Record<string, unknown> });
  }

  async listBuilds(orgSlug: string, pipelineSlug: string, options?: { page?: number; per_page?: number; state?: string; branch?: string }): Promise<BKBuild[]> {
    return this.client.request<BKBuild[]>(`/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds`, { params: { page: options?.page, per_page: options?.per_page, 'state[]': options?.state, branch: options?.branch } });
  }
  async getBuild(orgSlug: string, pipelineSlug: string, buildNumber: number): Promise<BKBuild> {
    return this.client.request<BKBuild>(`/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}`);
  }
  async createBuild(orgSlug: string, pipelineSlug: string, data: { commit: string; branch: string; message?: string; env?: Record<string, string> }): Promise<BKBuild> {
    return this.client.request<BKBuild>(`/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async cancelBuild(orgSlug: string, pipelineSlug: string, buildNumber: number): Promise<BKBuild> {
    return this.client.request<BKBuild>(`/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/cancel`, { method: 'PUT' });
  }
  async retryBuild(orgSlug: string, pipelineSlug: string, buildNumber: number): Promise<BKBuild> {
    return this.client.request<BKBuild>(`/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/rebuild`, { method: 'PUT' });
  }

  async listAgents(orgSlug: string): Promise<BKAgent[]> { return this.client.request<BKAgent[]>(`/organizations/${orgSlug}/agents`); }

  getClient(): BuildkiteClient { return this.client; }
}
