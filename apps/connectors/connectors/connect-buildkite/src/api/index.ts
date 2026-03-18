// Buildkite Connector
// CI/CD pipelines, builds, artifacts, and agents

import { BuildkiteClient } from './client';
import type {
  BuildkiteConfig,
  Organization,
  Pipeline,
  Build,
  Job,
  Artifact,
  Agent,
  CreateBuildOptions,
  ListBuildsOptions,
} from '../types';

export { BuildkiteClient } from './client';

export class Buildkite {
  private readonly client: BuildkiteClient;

  constructor(config: BuildkiteConfig) {
    this.client = new BuildkiteClient(config);
  }

  static fromEnv(): Buildkite {
    const token = process.env.BUILDKITE_TOKEN || process.env.BUILDKITE_API_TOKEN;
    if (!token) throw new Error('BUILDKITE_TOKEN environment variable is required');
    return new Buildkite({ token });
  }

  // ============================================
  // Organizations
  // ============================================

  async listOrganizations(): Promise<Organization[]> {
    return this.client.get<Organization[]>('/organizations');
  }

  async getOrganization(orgSlug: string): Promise<Organization> {
    return this.client.get<Organization>(`/organizations/${orgSlug}`);
  }

  // ============================================
  // Pipelines
  // ============================================

  async listPipelines(orgSlug: string, options?: { page?: number; perPage?: number }): Promise<Pipeline[]> {
    return this.client.get<Pipeline[]>(`/organizations/${orgSlug}/pipelines`, options as Record<string, number>);
  }

  async getPipeline(orgSlug: string, pipelineSlug: string): Promise<Pipeline> {
    return this.client.get<Pipeline>(`/organizations/${orgSlug}/pipelines/${pipelineSlug}`);
  }

  async createPipeline(orgSlug: string, params: {
    name: string;
    repository: string;
    steps?: Array<{ type: string; name?: string; command?: string }>;
    description?: string;
    visibility?: 'public' | 'private';
  }): Promise<Pipeline> {
    return this.client.post<Pipeline>(`/organizations/${orgSlug}/pipelines`, params);
  }

  async updatePipeline(orgSlug: string, pipelineSlug: string, params: Partial<{ name: string; description: string; repository: string }>): Promise<Pipeline> {
    return this.client.patch<Pipeline>(`/organizations/${orgSlug}/pipelines/${pipelineSlug}`, params);
  }

  async deletePipeline(orgSlug: string, pipelineSlug: string): Promise<void> {
    await this.client.delete(`/organizations/${orgSlug}/pipelines/${pipelineSlug}`);
  }

  // ============================================
  // Builds
  // ============================================

  async listBuilds(orgSlug: string, pipelineSlug: string, options?: ListBuildsOptions): Promise<Build[]> {
    return this.client.get<Build[]>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds`,
      options as Record<string, string | number | boolean | undefined>
    );
  }

  async getBuild(orgSlug: string, pipelineSlug: string, buildNumber: number): Promise<Build> {
    return this.client.get<Build>(`/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}`);
  }

  async createBuild(orgSlug: string, pipelineSlug: string, options: CreateBuildOptions): Promise<Build> {
    return this.client.post<Build>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds`,
      options as Record<string, unknown>
    );
  }

  async cancelBuild(orgSlug: string, pipelineSlug: string, buildNumber: number): Promise<Build> {
    return this.client.post<Build>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/cancel`
    );
  }

  async rebuildBuild(orgSlug: string, pipelineSlug: string, buildNumber: number): Promise<Build> {
    return this.client.post<Build>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/rebuild`
    );
  }

  // ============================================
  // Jobs
  // ============================================

  async retryJob(orgSlug: string, pipelineSlug: string, buildNumber: number, jobId: string): Promise<Job> {
    return this.client.put<Job>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/jobs/${jobId}/retry`
    );
  }

  async unblockJob(orgSlug: string, pipelineSlug: string, buildNumber: number, jobId: string, fields?: Record<string, string>): Promise<Job> {
    return this.client.post<Job>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/jobs/${jobId}/unblock`,
      fields
    );
  }

  async getJobLog(orgSlug: string, pipelineSlug: string, buildNumber: number, jobId: string): Promise<{ content: string; size: number }> {
    return this.client.get(`/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/jobs/${jobId}/log`);
  }

  // ============================================
  // Artifacts
  // ============================================

  async listArtifacts(orgSlug: string, pipelineSlug: string, buildNumber: number): Promise<Artifact[]> {
    return this.client.get<Artifact[]>(`/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/artifacts`);
  }

  // ============================================
  // Agents
  // ============================================

  async listAgents(orgSlug: string, options?: { page?: number; perPage?: number }): Promise<Agent[]> {
    return this.client.get<Agent[]>(`/organizations/${orgSlug}/agents`, options as Record<string, number>);
  }

  async getAgent(orgSlug: string, agentId: string): Promise<Agent> {
    return this.client.get<Agent>(`/organizations/${orgSlug}/agents/${agentId}`);
  }

  async stopAgent(orgSlug: string, agentId: string, force?: boolean): Promise<void> {
    await this.client.put(`/organizations/${orgSlug}/agents/${agentId}/stop`, { force: force ?? false });
  }

  getClient(): BuildkiteClient {
    return this.client;
  }
}
