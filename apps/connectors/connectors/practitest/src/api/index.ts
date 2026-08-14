// PractiTest Connector — End-to-end QA and test management
import { PractiTestClient } from './client';
import type { PractiTestConfig, PTProject, PTTestCase, PTTestSet, PTInstance, PTRun, PTIssue } from '../types';
export { PractiTestClient } from './client';

export class PractiTest {
  private readonly client: PractiTestClient;
  constructor(config: PractiTestConfig) { this.client = new PractiTestClient(config); }
  static fromEnv(): PractiTest {
    const email = process.env.PRACTITEST_EMAIL;
    const apiToken = process.env.PRACTITEST_API_TOKEN;
    if (!email || !apiToken) throw new Error('PRACTITEST_EMAIL and PRACTITEST_API_TOKEN are required');
    return new PractiTest({ email, apiToken });
  }

  async listProjects(): Promise<{ data: PTProject[] }> { return this.client.request('/projects.json'); }

  async listTestCases(projectId: string, options?: { page?: number }): Promise<{ data: PTTestCase[] }> {
    return this.client.request(`/projects/${projectId}/tests.json`, { params: { page: options?.page } });
  }
  async getTestCase(projectId: string, testId: string): Promise<{ data: PTTestCase }> {
    return this.client.request(`/projects/${projectId}/tests/${testId}.json`);
  }
  async createTestCase(projectId: string, data: { name: string; description?: string; priority?: string }): Promise<{ data: PTTestCase }> {
    return this.client.request(`/projects/${projectId}/tests.json`, { method: 'POST', body: { data: { type: 'tests', attributes: data } } });
  }

  async listTestSets(projectId: string): Promise<{ data: PTTestSet[] }> { return this.client.request(`/projects/${projectId}/sets.json`); }

  async listInstances(projectId: string, setId: string): Promise<{ data: PTInstance[] }> {
    return this.client.request(`/projects/${projectId}/instances.json`, { params: { set_ids: setId } });
  }

  async listRuns(projectId: string, options?: { instance_id?: string }): Promise<{ data: PTRun[] }> {
    return this.client.request(`/projects/${projectId}/runs.json`, { params: { instance_id: options?.instance_id } });
  }
  async createRun(projectId: string, instanceId: string, status: string): Promise<{ data: PTRun }> {
    return this.client.request(`/projects/${projectId}/runs.json`, { method: 'POST', body: { data: { type: 'instances', attributes: { instance_id: instanceId, 'exit-code': status === 'PASSED' ? 0 : 1 } } } });
  }

  async listIssues(projectId: string): Promise<{ data: PTIssue[] }> { return this.client.request(`/projects/${projectId}/issues.json`); }
  async createIssue(projectId: string, data: { title: string; description?: string; severity?: string }): Promise<{ data: PTIssue }> {
    return this.client.request(`/projects/${projectId}/issues.json`, { method: 'POST', body: { data: { type: 'issues', attributes: data } } });
  }

  getClient(): PractiTestClient { return this.client; }
}
