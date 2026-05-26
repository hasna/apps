// StatusCake Connector — Website uptime monitoring and performance testing
import { StatusCakeClient } from './client';
import type { StatusCakeConfig, SCTest, SCTestList, SCAlert, SCContactGroup, SCMaintenanceWindow, SCPagespeedTest } from '../types';
export { StatusCakeClient } from './client';

export class StatusCake {
  private readonly client: StatusCakeClient;
  constructor(config: StatusCakeConfig) { this.client = new StatusCakeClient(config); }
  static fromEnv(): StatusCake {
    const apiKey = process.env.STATUSCAKE_API_KEY;
    if (!apiKey) throw new Error('STATUSCAKE_API_KEY is required');
    return new StatusCake({ apiKey });
  }

  async listUptimeTests(options?: { page?: number; per_page?: number; status?: string; tags?: string }): Promise<SCTestList> {
    return this.client.request<SCTestList>('/uptime', { params: { page: options?.page, per_page: options?.per_page, status: options?.status, tags: options?.tags } });
  }
  async getUptimeTest(testId: string): Promise<{ data: SCTest }> { return this.client.request(`/uptime/${testId}`); }
  async createUptimeTest(data: { name: string; test_type: string; website_url: string; check_rate?: number; contact_groups?: string[]; tags?: string[] }): Promise<{ data: SCTest }> {
    return this.client.request('/uptime', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateUptimeTest(testId: string, data: { name?: string; check_rate?: number; paused?: boolean }): Promise<void> {
    await this.client.request(`/uptime/${testId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deleteUptimeTest(testId: string): Promise<void> { await this.client.request(`/uptime/${testId}`, { method: 'DELETE' }); }

  async listAlerts(testId: string): Promise<{ data: SCAlert[] }> { return this.client.request(`/uptime/${testId}/alerts`); }

  async listContactGroups(): Promise<{ data: SCContactGroup[] }> { return this.client.request('/contact-groups'); }

  async listMaintenanceWindows(): Promise<{ data: SCMaintenanceWindow[] }> { return this.client.request('/maintenance-windows'); }

  async listPagespeedTests(): Promise<{ data: SCPagespeedTest[] }> { return this.client.request('/pagespeed'); }
  async getPagespeedTest(testId: string): Promise<{ data: SCPagespeedTest }> { return this.client.request(`/pagespeed/${testId}`); }

  getClient(): StatusCakeClient { return this.client; }
}
