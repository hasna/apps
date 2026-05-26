// BrowserStack Connector — Cross-browser and mobile app testing
import { BrowserStackClient } from './client';
import type { BrowserStackConfig, BSBrowser, BSBuild, BSSession, BSProject, BSPlan } from '../types';
export { BrowserStackClient } from './client';

export class BrowserStack {
  private readonly client: BrowserStackClient;
  constructor(config: BrowserStackConfig) { this.client = new BrowserStackClient(config); }
  static fromEnv(): BrowserStack {
    const username = process.env.BROWSERSTACK_USERNAME;
    const accessKey = process.env.BROWSERSTACK_ACCESS_KEY;
    if (!username || !accessKey) throw new Error('BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY are required');
    return new BrowserStack({ username, accessKey });
  }

  async listBrowsers(): Promise<BSBrowser[]> { return this.client.request<BSBrowser[]>('/automate/browsers.json'); }

  async listBuilds(options?: { limit?: number; offset?: number; status?: string }): Promise<BSBuild[]> {
    return this.client.request<BSBuild[]>('/automate/builds.json', { params: { limit: options?.limit, offset: options?.offset, status: options?.status } });
  }
  async getBuild(buildId: string): Promise<BSBuild> { return this.client.request<BSBuild>(`/automate/builds/${buildId}.json`); }
  async deleteBuild(buildId: string): Promise<void> { await this.client.request(`/automate/builds/${buildId}.json`, { method: 'DELETE' }); }

  async listSessions(buildId: string, options?: { limit?: number; offset?: number }): Promise<BSSession[]> {
    return this.client.request<BSSession[]>(`/automate/builds/${buildId}/sessions.json`, { params: { limit: options?.limit, offset: options?.offset } });
  }
  async getSession(sessionId: string): Promise<BSSession> { return this.client.request<BSSession>(`/automate/sessions/${sessionId}.json`); }
  async deleteSession(sessionId: string): Promise<void> { await this.client.request(`/automate/sessions/${sessionId}.json`, { method: 'DELETE' }); }
  async getSessionLogs(sessionId: string): Promise<string> { return this.client.request<string>(`/automate/sessions/${sessionId}/logs`); }

  async listProjects(): Promise<BSProject[]> { return this.client.request<BSProject[]>('/automate/projects.json'); }

  async getPlan(): Promise<BSPlan> { return this.client.request<BSPlan>('/automate/plan.json'); }

  getClient(): BrowserStackClient { return this.client; }
}
