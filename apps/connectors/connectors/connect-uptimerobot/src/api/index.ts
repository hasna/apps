// UptimeRobot Connector — Website uptime monitoring
import { UptimeRobotClient } from './client';
import type { UptimeRobotConfig, URMonitor, URAlertContact, URAccount } from '../types';
export { UptimeRobotClient } from './client';

export class UptimeRobot {
  private readonly client: UptimeRobotClient;
  constructor(config: UptimeRobotConfig) { this.client = new UptimeRobotClient(config); }
  static fromEnv(): UptimeRobot {
    const apiKey = process.env.UPTIMEROBOT_API_KEY;
    if (!apiKey) throw new Error('UPTIMEROBOT_API_KEY environment variable is required');
    return new UptimeRobot({ apiKey });
  }

  async getAccount(): Promise<URAccount> {
    const r = await this.client.request<{ account: URAccount }>('/getAccountDetails');
    return r.account;
  }

  async listMonitors(options?: { types?: string; statuses?: string; logs?: boolean; custom_uptime_ranges?: string }): Promise<URMonitor[]> {
    const r = await this.client.request<{ monitors: URMonitor[] }>('/getMonitors', {
      types: options?.types, statuses: options?.statuses,
      logs: options?.logs ? '1' : undefined,
      custom_uptime_ranges: options?.custom_uptime_ranges,
    });
    return r.monitors ?? [];
  }

  async createMonitor(data: { friendly_name: string; url: string; type: number; interval?: number; alert_contacts?: string }): Promise<{ id: number }> {
    return this.client.request('/newMonitor', data as Record<string, string | number | undefined>);
  }

  async editMonitor(id: number, data: { friendly_name?: string; url?: string; interval?: number; status?: number }): Promise<{ id: number }> {
    return this.client.request('/editMonitor', { id, ...data } as Record<string, string | number | undefined>);
  }

  async deleteMonitor(id: number): Promise<{ id: number }> {
    return this.client.request('/deleteMonitor', { id });
  }

  async pauseMonitor(id: number): Promise<{ id: number }> {
    return this.client.request('/editMonitor', { id, status: 0 });
  }

  async resumeMonitor(id: number): Promise<{ id: number }> {
    return this.client.request('/editMonitor', { id, status: 1 });
  }

  async listAlertContacts(): Promise<URAlertContact[]> {
    const r = await this.client.request<{ alert_contacts: URAlertContact[] }>('/getAlertContacts');
    return r.alert_contacts ?? [];
  }

  getClient(): UptimeRobotClient { return this.client; }
}
