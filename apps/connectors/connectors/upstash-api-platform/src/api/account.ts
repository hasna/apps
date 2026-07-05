import { AUDIT_LOGS_BASE_URL, type UpstashApiPlatformClient } from './client';
import type { AuditLog } from '../types';

export class AccountApi {
  constructor(private readonly client: UpstashApiPlatformClient) {}

  listAuditLogs(): Promise<AuditLog[]> {
    return this.client.get<AuditLog[]>('/auditlogs', undefined, {
      baseUrl: AUDIT_LOGS_BASE_URL,
    });
  }
}
