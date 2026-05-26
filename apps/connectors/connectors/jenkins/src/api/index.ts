// Jenkins Connector — Open-source CI/CD automation server
import { JenkinsClient } from './client';
import type { JenkinsConfig, JKJob, JKBuild, JKQueue, JKNode, JKView } from '../types';
export { JenkinsClient } from './client';

export class Jenkins {
  private readonly client: JenkinsClient;
  constructor(config: JenkinsConfig) { this.client = new JenkinsClient(config); }
  static fromEnv(): Jenkins {
    const url = process.env.JENKINS_URL;
    const username = process.env.JENKINS_USERNAME;
    const apiToken = process.env.JENKINS_API_TOKEN;
    if (!url || !username || !apiToken) throw new Error('JENKINS_URL, JENKINS_USERNAME, and JENKINS_API_TOKEN are required');
    return new Jenkins({ url, username, apiToken });
  }

  async listJobs(): Promise<{ jobs: JKJob[] }> { return this.client.request('/api/json', { params: { tree: 'jobs[name,url,color,fullName,description,buildable,lastBuild[number,url],lastSuccessfulBuild[number,url],lastFailedBuild[number,url]]' } }); }
  async getJob(jobName: string): Promise<JKJob> { return this.client.request<JKJob>(`/job/${encodeURIComponent(jobName)}/api/json`); }

  async getBuild(jobName: string, buildNumber: number): Promise<JKBuild> {
    return this.client.request<JKBuild>(`/job/${encodeURIComponent(jobName)}/${buildNumber}/api/json`);
  }
  async getLastBuild(jobName: string): Promise<JKBuild> {
    return this.client.request<JKBuild>(`/job/${encodeURIComponent(jobName)}/lastBuild/api/json`);
  }
  async triggerBuild(jobName: string, parameters?: Record<string, string>): Promise<void> {
    const path = parameters ? `/job/${encodeURIComponent(jobName)}/buildWithParameters` : `/job/${encodeURIComponent(jobName)}/build`;
    const params = parameters as Record<string, string | number | undefined> | undefined;
    await this.client.request(path, { method: 'POST', params });
  }
  async stopBuild(jobName: string, buildNumber: number): Promise<void> {
    await this.client.request(`/job/${encodeURIComponent(jobName)}/${buildNumber}/stop`, { method: 'POST' });
  }
  async getBuildLog(jobName: string, buildNumber: number): Promise<string> {
    const response = await fetch(`${(this.client as unknown as { baseUrl: string }).baseUrl}/job/${encodeURIComponent(jobName)}/${buildNumber}/consoleText`);
    return response.text();
  }

  async getQueue(): Promise<JKQueue> { return this.client.request<JKQueue>('/queue/api/json'); }

  async listNodes(): Promise<{ computer: JKNode[] }> { return this.client.request('/computer/api/json'); }

  async listViews(): Promise<{ views: JKView[] }> { return this.client.request('/api/json', { params: { tree: 'views[name,url,jobs[name,url,color]]' } }); }

  getClient(): JenkinsClient { return this.client; }
}
