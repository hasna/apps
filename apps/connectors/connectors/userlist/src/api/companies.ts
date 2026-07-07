import type { CompanyDeletePayload, CompanyIdentifyPayload } from '../types';
import type { ConnectorClient } from './client';

export class CompaniesApi {
  constructor(private readonly client: ConnectorClient) {}

  identify(payload: CompanyIdentifyPayload): Promise<void> {
    return this.client.post('/companies', payload as unknown as Record<string, unknown>);
  }

  delete(payload: CompanyDeletePayload): Promise<void> {
    return this.client.delete('/companies', payload as unknown as Record<string, unknown>);
  }
}
