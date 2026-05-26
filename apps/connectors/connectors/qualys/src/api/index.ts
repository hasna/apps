// Qualys Connector — Cloud security and vulnerability management
import { QualysClient } from './client';
import type { QualysConfig, QSHostAsset, QSHostAssetList, QSVulnerability, QSScan, QSReport } from '../types';
export { QualysClient } from './client';

export class Qualys {
  private readonly client: QualysClient;
  constructor(config: QualysConfig) { this.client = new QualysClient(config); }
  static fromEnv(): Qualys {
    const username = process.env.QUALYS_USERNAME;
    const password = process.env.QUALYS_PASSWORD;
    if (!username || !password) throw new Error('QUALYS_USERNAME and QUALYS_PASSWORD are required');
    return new Qualys({ username, password, platform: process.env.QUALYS_PLATFORM });
  }

  async listHostAssets(options?: { limit?: number; offset?: number }): Promise<QSHostAssetList> {
    return this.client.request<QSHostAssetList>('/qps/rest/2.0/search/am/hostasset', { method: 'POST', body: { ServiceRequest: { filters: {}, preferences: { limitResults: options?.limit, startFromOffset: options?.offset } } } });
  }
  async getHostAsset(assetId: number): Promise<{ data: { HostAsset: QSHostAsset } }> {
    return this.client.request(`/qps/rest/2.0/get/am/hostasset/${assetId}`);
  }

  async listVulnerabilities(options?: { ids?: string }): Promise<{ data: { Vuln: QSVulnerability[] } }> {
    return this.client.request('/api/2.0/fo/knowledge_base/vuln/', { params: { action: 'list', ids: options?.ids } });
  }

  async listScans(options?: { state?: string }): Promise<{ data: { Scan: QSScan[] } }> {
    return this.client.request('/api/2.0/fo/scan/', { params: { action: 'list', state: options?.state } });
  }
  async launchScan(title: string, targetIps: string, optionProfileId?: string): Promise<{ data: { id: string } }> {
    const body = new URLSearchParams();
    body.append('action', 'launch');
    body.append('scan_title', title);
    body.append('ip', targetIps);
    if (optionProfileId) body.append('option_id', optionProfileId);
    return this.client.request('/api/2.0/fo/scan/', { method: 'POST', body });
  }

  async listReports(): Promise<{ data: { Report: QSReport[] } }> {
    return this.client.request('/api/2.0/fo/report/', { params: { action: 'list' } });
  }

  getClient(): QualysClient { return this.client; }
}
