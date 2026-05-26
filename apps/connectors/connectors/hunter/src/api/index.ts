// Hunter Connector — Email finder and verification
import { HunterClient } from './client';
import type { HunterConfig, HunterDomainSearch, HunterEmailFinder, HunterVerification, HunterAccount } from '../types';
export { HunterClient } from './client';

export class Hunter {
  private readonly client: HunterClient;
  constructor(config: HunterConfig) { this.client = new HunterClient(config); }
  static fromEnv(): Hunter {
    const apiKey = process.env.HUNTER_API_KEY;
    if (!apiKey) throw new Error('HUNTER_API_KEY is required');
    return new Hunter({ apiKey });
  }

  async domainSearch(domain: string, options?: { limit?: number; offset?: number; type?: string; department?: string }): Promise<HunterDomainSearch> {
    return this.client.request<HunterDomainSearch>('/domain-search', { domain, limit: options?.limit, offset: options?.offset, type: options?.type, department: options?.department });
  }

  async emailFinder(domain: string, firstName: string, lastName: string): Promise<HunterEmailFinder> {
    return this.client.request<HunterEmailFinder>('/email-finder', { domain, first_name: firstName, last_name: lastName });
  }

  async verifyEmail(email: string): Promise<HunterVerification> {
    return this.client.request<HunterVerification>('/email-verifier', { email });
  }

  async emailCount(domain: string): Promise<{ total: number; personal_emails: number; generic_emails: number }> {
    return this.client.request('/email-count', { domain });
  }

  async getAccount(): Promise<HunterAccount> { return this.client.request<HunterAccount>('/account'); }

  getClient(): HunterClient { return this.client; }
}
