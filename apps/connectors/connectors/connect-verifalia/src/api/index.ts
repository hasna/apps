// Verifalia Connector — Email address validation and verification
import { VerifaliaClient } from './client';
import type { VerifaliaConfig, VFEmailValidation, VFCreditsBalance } from '../types';
export { VerifaliaClient } from './client';

export class Verifalia {
  private readonly client: VerifaliaClient;
  constructor(config: VerifaliaConfig) { this.client = new VerifaliaClient(config); }
  static fromEnv(): Verifalia {
    const username = process.env.VERIFALIA_USERNAME;
    const password = process.env.VERIFALIA_PASSWORD;
    if (!username || !password) throw new Error('VERIFALIA_USERNAME and VERIFALIA_PASSWORD are required');
    return new Verifalia({ username, password });
  }

  async verifyEmail(email: string, options?: { quality?: 'Standard' | 'High' | 'Extreme' }): Promise<VFEmailValidation> {
    return this.client.request<VFEmailValidation>('/email-validations', {
      method: 'POST', body: { entries: [{ inputData: email }], quality: options?.quality || 'Standard' }
    });
  }

  async verifyEmails(emails: string[], options?: { quality?: 'Standard' | 'High' | 'Extreme' }): Promise<VFEmailValidation> {
    return this.client.request<VFEmailValidation>('/email-validations', {
      method: 'POST', body: { entries: emails.map(e => ({ inputData: e })), quality: options?.quality || 'Standard' }
    });
  }

  async getValidation(validationId: string): Promise<VFEmailValidation> {
    return this.client.request<VFEmailValidation>(`/email-validations/${validationId}`);
  }

  async deleteValidation(validationId: string): Promise<void> {
    await this.client.request(`/email-validations/${validationId}`, { method: 'DELETE' });
  }

  async getCreditsBalance(): Promise<VFCreditsBalance> {
    return this.client.request<VFCreditsBalance>('/credits/balance');
  }

  getClient(): VerifaliaClient { return this.client; }
}
