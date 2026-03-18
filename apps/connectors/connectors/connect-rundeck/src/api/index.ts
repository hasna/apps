// Rundeck Connector — Operations automation and runbook management
import { RundeckClient } from './client';
import type { RundeckConfig, RDProject, RDJob, RDExecution, RDExecutionList, RDNode } from '../types';
export { RundeckClient } from './client';

export class Rundeck {
  private readonly client: RundeckClient;
  constructor(config: RundeckConfig) { this.client = new RundeckClient(config); }
  static fromEnv(): Rundeck {
    const url = process.env.RUNDECK_URL;
    const token = process.env.RUNDECK_TOKEN;
    if (!url || !token) throw new Error('RUNDECK_URL and RUNDECK_TOKEN are required');
    return new Rundeck({ url, token });
  }

  async listProjects(): Promise<RDProject[]> { return this.client.request<RDProject[]>('/projects'); }
  async getProject(projectName: string): Promise<RDProject> { return this.client.request<RDProject>(`/project/${projectName}`); }

  async listJobs(projectName: string, options?: { groupPath?: string; jobFilter?: string }): Promise<RDJob[]> {
    return this.client.request<RDJob[]>(`/project/${projectName}/jobs`, { params: { groupPath: options?.groupPath, jobFilter: options?.jobFilter } });
  }
  async getJob(jobId: string): Promise<RDJob> { return this.client.request<RDJob>(`/job/${jobId}`); }
  async runJob(jobId: string, options?: Record<string, string>): Promise<RDExecution> {
    return this.client.request<RDExecution>(`/job/${jobId}/run`, { method: 'POST', body: { options } as Record<string, unknown> });
  }

  async listExecutions(projectName: string, options?: { max?: number; offset?: number; statusFilter?: string }): Promise<RDExecutionList> {
    return this.client.request<RDExecutionList>(`/project/${projectName}/executions`, { params: { max: options?.max, offset: options?.offset, statusFilter: options?.statusFilter } });
  }
  async getExecution(executionId: number): Promise<RDExecution> { return this.client.request<RDExecution>(`/execution/${executionId}`); }
  async abortExecution(executionId: number): Promise<{ abort: { status: string } }> {
    return this.client.request(`/execution/${executionId}/abort`, { method: 'POST' });
  }

  async listNodes(projectName: string): Promise<RDNode[]> { return this.client.request<RDNode[]>(`/project/${projectName}/resources`); }

  getClient(): RundeckClient { return this.client; }
}
