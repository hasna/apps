import type { ConnectorClient } from './client';
import type { CreateScanParams, ListScansParams, Scan } from '../types';

export class ScansApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params: ListScansParams = {}): Promise<Scan[] | Record<string, unknown>> {
    return this.client.get<Scan[] | Record<string, unknown>>('/scans', params);
  }

  async create(data: CreateScanParams): Promise<Scan> {
    return this.client.post<Scan>('/scans', data);
  }

  async get(scanId: string): Promise<Scan> {
    const encodedId = encodeURIComponent(scanId);
    return this.client.get<Scan>(`/scans/${encodedId}`);
  }
}
