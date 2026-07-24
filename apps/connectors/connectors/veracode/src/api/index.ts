import { VeracodeClient } from './client';
import type {
  VeracodeConfig,
  VeracodeEventList,
  VeracodeScan,
  VeracodeScanList,
  VeracodeSearchRequest,
  VeracodeSearchResult,
} from '../types';

export { VeracodeClient } from './client';

export class Veracode {
  private readonly client: VeracodeClient;

  constructor(config: VeracodeConfig) {
    this.client = new VeracodeClient(config);
  }

  static fromEnv(): Veracode {
    const apiKey = process.env.VERACODE_API_KEY;
    const baseUrl = process.env.VERACODE_BASE_URL;
    if (!apiKey) throw new Error('VERACODE_API_KEY environment variable is required');
    return new Veracode({ apiKey, baseUrl });
  }

  async listScans(params?: Record<string, string | number | boolean | undefined>): Promise<VeracodeScanList> {
    return this.client.get<VeracodeScanList>('/scans', params);
  }

  async createScan(body: Record<string, unknown>): Promise<VeracodeScan> {
    return this.client.post<VeracodeScan>('/scans', body);
  }

  async getScan(scanId: string): Promise<VeracodeScan> {
    const encoded = encodeURIComponent(scanId);
    return this.client.get<VeracodeScan>(`/scans/${encoded}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<VeracodeEventList> {
    return this.client.get<VeracodeEventList>('/events', params);
  }

  async search(body: VeracodeSearchRequest): Promise<VeracodeSearchResult> {
    return this.client.post<VeracodeSearchResult>('/search', body);
  }

  getClient(): VeracodeClient {
    return this.client;
  }
}
