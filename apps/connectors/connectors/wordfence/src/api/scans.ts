import type { ConnectorClient } from './client';
import type {
  CreateScanParams,
  ListScansParams,
  ListScansResult,
  ScanDetail,
} from '../types';

export class ScansApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params: ListScansParams = {}): Promise<ListScansResult> {
    return this.client.get<ListScansResult>('/scans', {
      limit: params.limit,
      offset: params.offset,
      status: params.status,
    });
  }

  async create(params: CreateScanParams = {}): Promise<ScanDetail> {
    return this.client.post<ScanDetail>('/scans', params);
  }

  async get(scanId: string): Promise<ScanDetail> {
    const encoded = encodeURIComponent(scanId);
    return this.client.get<ScanDetail>(`/scans/${encoded}`);
  }
}
