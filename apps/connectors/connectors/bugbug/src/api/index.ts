// BugBug Connector — Browser-based automated testing
import { BugBugClient } from './client';
import type { BugBugConfig, BBTest, BBSuite, BBRun, BBProject } from '../types';
export { BugBugClient } from './client';

export class BugBug {
  private readonly client: BugBugClient;
  constructor(config: BugBugConfig) { this.client = new BugBugClient(config); }
  static fromEnv(): BugBug {
    const apiKey = process.env.BUGBUG_API_KEY;
    if (!apiKey) throw new Error('BUGBUG_API_KEY is required');
    return new BugBug({ apiKey });
  }

  async listProjects(): Promise<BBProject[]> { return this.client.request<BBProject[]>('/projects'); }
  async getProject(projectId: string): Promise<BBProject> { return this.client.request<BBProject>(`/projects/${projectId}`); }

  async listTests(projectId: string): Promise<BBTest[]> { return this.client.request<BBTest[]>(`/projects/${projectId}/tests`); }
  async getTest(projectId: string, testId: string): Promise<BBTest> { return this.client.request<BBTest>(`/projects/${projectId}/tests/${testId}`); }
  async runTest(projectId: string, testId: string, options?: { browser?: string }): Promise<BBRun> {
    return this.client.request<BBRun>(`/projects/${projectId}/tests/${testId}/run`, { method: 'POST', body: options as Record<string, unknown> });
  }

  async listSuites(projectId: string): Promise<BBSuite[]> { return this.client.request<BBSuite[]>(`/projects/${projectId}/suites`); }
  async getSuite(projectId: string, suiteId: string): Promise<BBSuite> { return this.client.request<BBSuite>(`/projects/${projectId}/suites/${suiteId}`); }
  async runSuite(projectId: string, suiteId: string, options?: { browser?: string }): Promise<BBRun> {
    return this.client.request<BBRun>(`/projects/${projectId}/suites/${suiteId}/run`, { method: 'POST', body: options as Record<string, unknown> });
  }

  async getRun(runId: string): Promise<BBRun> { return this.client.request<BBRun>(`/runs/${runId}`); }
  async listRuns(projectId: string, options?: { test_id?: string; suite_id?: string; status?: string }): Promise<BBRun[]> {
    return this.client.request<BBRun[]>(`/projects/${projectId}/runs`, { params: { test_id: options?.test_id, suite_id: options?.suite_id, status: options?.status } });
  }

  getClient(): BugBugClient { return this.client; }
}
