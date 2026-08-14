// Tenable Connector — Cloud vulnerability management and exposure platform (Tenable.io).
import { TenableClient } from './client';
import type {
  TenableConfig,
  TenableScan,
  TenableScanList,
  TenableAssetList,
  TenableVulnerabilityList,
  TenableScannerList,
  TenableFolderList,
  TenableSession,
} from '../types';

export { TenableClient } from './client';

export class Tenable {
  private readonly client: TenableClient;

  constructor(config: TenableConfig) {
    this.client = new TenableClient(config);
  }

  /** Build a Tenable client from TENABLE_ACCESS_KEY / TENABLE_SECRET_KEY env vars. */
  static fromEnv(): Tenable {
    const accessKey = process.env.TENABLE_ACCESS_KEY;
    const secretKey = process.env.TENABLE_SECRET_KEY;
    if (!accessKey || !secretKey) {
      throw new Error('TENABLE_ACCESS_KEY and TENABLE_SECRET_KEY are required');
    }
    return new Tenable({ accessKey, secretKey, baseUrl: process.env.TENABLE_BASE_URL });
  }

  // ---- Scans (https://developer.tenable.com/reference/scans-list) ----

  /** List all scans, optionally filtered by folder. */
  async listScans(options?: { folderId?: number; lastModificationDate?: number }): Promise<TenableScanList> {
    return this.client.request<TenableScanList>('/scans', {
      params: { folder_id: options?.folderId, last_modification_date: options?.lastModificationDate },
    });
  }

  /** Get the details of a single scan by id. */
  async getScan(scanId: number): Promise<Record<string, unknown>> {
    return this.client.request(`/scans/${scanId}`);
  }

  /** Launch a scan by id. Returns the uuid of the launched scan run. */
  async launchScan(scanId: number, altTargets?: string[]): Promise<{ scan_uuid: string }> {
    return this.client.request(`/scans/${scanId}/launch`, {
      method: 'POST',
      body: altTargets ? { alt_targets: altTargets } : undefined,
    });
  }

  // ---- Workbench assets (https://developer.tenable.com/reference/workbenches-assets) ----

  /** List assets from the workbench, optionally limited to the last N days. */
  async listAssets(options?: { dateRange?: number }): Promise<TenableAssetList> {
    return this.client.request<TenableAssetList>('/workbenches/assets', {
      params: { date_range: options?.dateRange },
    });
  }

  /** Get detailed information about a single asset. */
  async getAssetInfo(assetId: string): Promise<Record<string, unknown>> {
    return this.client.request(`/workbenches/assets/${assetId}/info`);
  }

  // ---- Workbench vulnerabilities (https://developer.tenable.com/reference/workbenches-vulnerabilities) ----

  /** List aggregated vulnerabilities from the workbench. */
  async listVulnerabilities(options?: { dateRange?: number; severity?: string }): Promise<TenableVulnerabilityList> {
    return this.client.request<TenableVulnerabilityList>('/workbenches/vulnerabilities', {
      params: { date_range: options?.dateRange, severity: options?.severity },
    });
  }

  /** Get detailed information about a single plugin/vulnerability. */
  async getVulnerabilityInfo(pluginId: number): Promise<Record<string, unknown>> {
    return this.client.request(`/workbenches/vulnerabilities/${pluginId}/info`);
  }

  // ---- Scanners / folders / session ----

  /** List available scanners. */
  async listScanners(): Promise<TenableScannerList> {
    return this.client.request<TenableScannerList>('/scanners');
  }

  /** List scan result folders. */
  async listFolders(): Promise<TenableFolderList> {
    return this.client.request<TenableFolderList>('/folders');
  }

  /** Get details about the current API session (useful to verify credentials). */
  async getSession(): Promise<TenableSession> {
    return this.client.request<TenableSession>('/session');
  }

  /** Access the underlying HTTP client for advanced use. */
  getClient(): TenableClient {
    return this.client;
  }
}

export type { TenableScan };
