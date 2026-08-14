// Carbon Black Connector — Endpoint security and threat detection
import { CarbonBlackClient } from './client';
import type { CarbonBlackConfig, CBDevice, CBDeviceList, CBAlert, CBAlertList, CBProcess } from '../types';
export { CarbonBlackClient } from './client';

export class CarbonBlack {
  private readonly client: CarbonBlackClient;
  constructor(config: CarbonBlackConfig) { this.client = new CarbonBlackClient(config); }
  static fromEnv(): CarbonBlack {
    const url = process.env.CARBONBLACK_URL;
    const orgKey = process.env.CARBONBLACK_ORG_KEY;
    const apiId = process.env.CARBONBLACK_API_ID;
    const apiSecretKey = process.env.CARBONBLACK_API_SECRET;
    if (!url || !orgKey || !apiId || !apiSecretKey) throw new Error('CARBONBLACK_URL, CARBONBLACK_ORG_KEY, CARBONBLACK_API_ID, and CARBONBLACK_API_SECRET are required');
    return new CarbonBlack({ url, orgKey, apiId, apiSecretKey });
  }

  async searchDevices(query: string, options?: { rows?: number; start?: number }): Promise<CBDeviceList> {
    return this.client.request<CBDeviceList>('/devices/_search', { method: 'POST', body: { query, rows: options?.rows, start: options?.start } as Record<string, unknown> });
  }
  async getDevice(deviceId: number): Promise<CBDevice> { return this.client.request<CBDevice>(`/devices/${deviceId}`); }
  async quarantineDevice(deviceId: number): Promise<void> {
    await this.client.request(`/device_actions`, { method: 'POST', body: { action_type: 'QUARANTINE', device_id: [deviceId], options: { toggle: 'ON' } } });
  }
  async unquarantineDevice(deviceId: number): Promise<void> {
    await this.client.request(`/device_actions`, { method: 'POST', body: { action_type: 'QUARANTINE', device_id: [deviceId], options: { toggle: 'OFF' } } });
  }

  async searchAlerts(query: string, options?: { rows?: number; sort_field?: string }): Promise<CBAlertList> {
    return this.client.request<CBAlertList>('/alerts/_search', { method: 'POST', body: { query, rows: options?.rows, sort_field: options?.sort_field } as Record<string, unknown> });
  }
  async getAlert(alertId: string): Promise<CBAlert> { return this.client.request<CBAlert>(`/alerts/${alertId}`); }
  async dismissAlert(alertId: string, comment?: string): Promise<void> {
    await this.client.request(`/alerts/${alertId}/workflow`, { method: 'POST', body: { state: 'DISMISSED', comment } });
  }

  async searchProcesses(query: string, options?: { rows?: number; start?: number }): Promise<{ results: CBProcess[]; num_found: number }> {
    return this.client.request('/processes/_search', { method: 'POST', body: { query, rows: options?.rows, start: options?.start } as Record<string, unknown> });
  }

  getClient(): CarbonBlackClient { return this.client; }
}
