// DataSoap Connector — Data cleansing, email verification, and validation
import { DataSoapClient } from './client';
import type { DataSoapConfig, DSEmailResult, DSPhoneResult, DSAddressResult, DSBatchResult, DSCredits } from '../types';
export { DataSoapClient } from './client';

export class DataSoap {
  private readonly client: DataSoapClient;
  constructor(config: DataSoapConfig) { this.client = new DataSoapClient(config); }
  static fromEnv(): DataSoap {
    const apiKey = process.env.DATASOAP_API_KEY;
    if (!apiKey) throw new Error('DATASOAP_API_KEY is required');
    return new DataSoap({ apiKey });
  }

  async verifyEmail(email: string): Promise<DSEmailResult> {
    return this.client.request<DSEmailResult>('/email/verify', { method: 'POST', body: { email } });
  }
  async verifyEmailBatch(emails: string[]): Promise<DSBatchResult> {
    return this.client.request<DSBatchResult>('/email/verify/batch', { method: 'POST', body: { emails } as Record<string, unknown> });
  }

  async validatePhone(phone: string, countryCode?: string): Promise<DSPhoneResult> {
    return this.client.request<DSPhoneResult>('/phone/validate', { method: 'POST', body: { phone, country_code: countryCode } });
  }

  async validateAddress(address: string): Promise<DSAddressResult> {
    return this.client.request<DSAddressResult>('/address/validate', { method: 'POST', body: { address } });
  }

  async getBatchStatus(batchId: string): Promise<DSBatchResult> {
    return this.client.request<DSBatchResult>(`/batch/${batchId}`);
  }

  async getCredits(): Promise<DSCredits> { return this.client.request<DSCredits>('/credits'); }

  getClient(): DataSoapClient { return this.client; }
}
