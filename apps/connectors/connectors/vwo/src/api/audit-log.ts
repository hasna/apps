import type { ConnectorClient } from './client';
import type { AuditLogListParams } from '../types';

export class AuditLogApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: AuditLogListParams): Promise<unknown> {
    return this.client.get('/audit-log', params);
  }
}
