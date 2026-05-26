// TestMonitor Connector — Test management for organizing and reporting on tests
import { TestMonitorClient } from './client';
import type { TestMonitorConfig, TMProject, TMTestCase, TMTestRun, TMTestResult, TMFolder } from '../types';
export { TestMonitorClient } from './client';

export class TestMonitor {
  private readonly client: TestMonitorClient;
  constructor(config: TestMonitorConfig) { this.client = new TestMonitorClient(config); }
  static fromEnv(): TestMonitor {
    const domain = process.env.TESTMONITOR_DOMAIN;
    const token = process.env.TESTMONITOR_TOKEN;
    if (!domain || !token) throw new Error('TESTMONITOR_DOMAIN and TESTMONITOR_TOKEN are required');
    return new TestMonitor({ domain, token });
  }

  async listProjects(): Promise<{ data: TMProject[] }> { return this.client.request('/projects'); }
  async getProject(projectId: number): Promise<{ data: TMProject }> { return this.client.request(`/projects/${projectId}`); }

  async listTestCases(projectId: number, options?: { page?: number; per_page?: number; folder_id?: number }): Promise<{ data: TMTestCase[]; meta: Record<string, unknown> }> {
    return this.client.request(`/projects/${projectId}/test-cases`, { params: { page: options?.page, per_page: options?.per_page, folder_id: options?.folder_id } });
  }
  async getTestCase(projectId: number, testCaseId: number): Promise<{ data: TMTestCase }> {
    return this.client.request(`/projects/${projectId}/test-cases/${testCaseId}`);
  }
  async createTestCase(projectId: number, data: { name: string; description?: string; steps?: string; expected_result?: string; priority?: string; folder_id?: number }): Promise<{ data: TMTestCase }> {
    return this.client.request(`/projects/${projectId}/test-cases`, { method: 'POST', body: data as Record<string, unknown> });
  }

  async listTestRuns(projectId: number): Promise<{ data: TMTestRun[] }> { return this.client.request(`/projects/${projectId}/test-runs`); }
  async getTestRun(projectId: number, testRunId: number): Promise<{ data: TMTestRun }> {
    return this.client.request(`/projects/${projectId}/test-runs/${testRunId}`);
  }
  async createTestRun(projectId: number, data: { name: string; description?: string; test_case_ids: number[] }): Promise<{ data: TMTestRun }> {
    return this.client.request(`/projects/${projectId}/test-runs`, { method: 'POST', body: data as Record<string, unknown> });
  }

  async listTestResults(projectId: number, testRunId: number): Promise<{ data: TMTestResult[] }> {
    return this.client.request(`/projects/${projectId}/test-runs/${testRunId}/results`);
  }
  async updateTestResult(projectId: number, testRunId: number, resultId: number, data: { status: string; comment?: string }): Promise<{ data: TMTestResult }> {
    return this.client.request(`/projects/${projectId}/test-runs/${testRunId}/results/${resultId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }

  async listFolders(projectId: number): Promise<{ data: TMFolder[] }> { return this.client.request(`/projects/${projectId}/folders`); }

  getClient(): TestMonitorClient { return this.client; }
}
