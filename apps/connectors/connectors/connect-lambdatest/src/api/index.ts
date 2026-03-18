// LambdaTest Connector — Cross-browser testing and test automation
import { LambdaTestClient } from './client';
import type { LambdaTestConfig, LTBuild, LTSession, LTSessionList, LTTunnel, LTPlatform } from '../types';
export { LambdaTestClient } from './client';

export class LambdaTest {
  private readonly client: LambdaTestClient;
  constructor(config: LambdaTestConfig) { this.client = new LambdaTestClient(config); }
  static fromEnv(): LambdaTest {
    const username = process.env.LAMBDATEST_USERNAME;
    const accessKey = process.env.LAMBDATEST_ACCESS_KEY;
    if (!username || !accessKey) throw new Error('LAMBDATEST_USERNAME and LAMBDATEST_ACCESS_KEY are required');
    return new LambdaTest({ username, accessKey });
  }

  async listBuilds(options?: { offset?: number; limit?: number; status?: string }): Promise<{ data: LTBuild[] }> {
    return this.client.request('/builds', { params: { offset: options?.offset, limit: options?.limit, status: options?.status } });
  }
  async getBuild(buildId: string): Promise<{ data: LTBuild }> { return this.client.request(`/builds/${buildId}`); }
  async deleteBuild(buildId: string): Promise<void> { await this.client.request(`/builds/${buildId}`, { method: 'DELETE' }); }

  async listSessions(buildId: string, options?: { offset?: number; limit?: number }): Promise<LTSessionList> {
    return this.client.request<LTSessionList>(`/builds/${buildId}/sessions`, { params: { offset: options?.offset, limit: options?.limit } });
  }
  async getSession(sessionId: string): Promise<{ data: LTSession }> { return this.client.request(`/sessions/${sessionId}`); }
  async deleteSession(sessionId: string): Promise<void> { await this.client.request(`/sessions/${sessionId}`, { method: 'DELETE' }); }
  async getSessionLogs(sessionId: string): Promise<{ data: string }> { return this.client.request(`/sessions/${sessionId}/log/command`); }
  async getSessionScreenshots(sessionId: string): Promise<{ data: string[] }> { return this.client.request(`/sessions/${sessionId}/screenshots`); }
  async stopSession(sessionId: string): Promise<void> { await this.client.request(`/sessions/${sessionId}/stop`, { method: 'PUT' }); }

  async listTunnels(): Promise<{ data: LTTunnel[] }> { return this.client.request('/tunnels'); }

  async listPlatforms(): Promise<LTPlatform[]> { return this.client.request<LTPlatform[]>('/platforms'); }

  getClient(): LambdaTestClient { return this.client; }
}
