import type { BrandsightClient } from './client';
import type {
  DomainAvailabilityParams,
  DomainAvailabilityResponse,
  BulkAvailabilityResponse,
  DomainPurchaseRequest,
  DomainPurchaseResponse,
  DomainInfo,
  Agreement,
  AgreementParams,
  DomainAction,
  TldSuggestion,
  CheckType,
  OptimizeFor,
} from '../types';

export class DomainsApi {
  constructor(private readonly client: BrandsightClient) {}

  /**
   * Check if a single domain is available for registration
   * Uses ACCURACY mode by default for reliable results
   */
  async checkAvailability(params: DomainAvailabilityParams): Promise<DomainAvailabilityResponse> {
    const { domain, period, checkType = 'REGISTRATION', optimizeFor = 'ACCURACY' } = params;
    return this.client.get<DomainAvailabilityResponse>('/v2/domains/available', {
      domain,
      period,
      type: checkType,
      optimizeFor,
    });
  }

  /**
   * Check availability for multiple domains (bulk)
   * Max 500 domains per request
   */
  async checkBulkAvailability(
    domains: string[],
    checkType: CheckType = 'REGISTRATION'
  ): Promise<BulkAvailabilityResponse> {
    if (domains.length > 500) {
      throw new Error('Maximum 500 domains per bulk availability check');
    }
    return this.client.post<BulkAvailabilityResponse>('/v2/domains/available', { domains }, {
      checkType,
    });
  }

  /**
   * Get domain suggestions based on a seed keyword
   */
  async getSuggestions(
    query: string,
    options?: {
      country?: string;
      city?: string;
      limit?: number;
      waitMs?: number;
    }
  ): Promise<TldSuggestion[]> {
    return this.client.get<TldSuggestion[]>('/v2/domains/suggest', {
      query,
      country: options?.country,
      city: options?.city,
      limit: options?.limit,
      waitMs: options?.waitMs,
    });
  }

  /**
   * Get list of supported TLDs
   */
  async getTlds(): Promise<string[]> {
    const response = await this.client.get<Array<{ name: string; type: string }>>('/v2/domains/tlds');
    return response.map(tld => tld.name);
  }

  /**
   * Get legal agreements required for domain registration
   * Requires customerId
   */
  async getAgreements(params: AgreementParams): Promise<Agreement[]> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required for agreements. Set it in your config.');
    }
    return this.client.get<Agreement[]>(
      `/v2/customers/${customerId}/domains/agreements`,
      {
        tlds: params.tlds.join(','),
        privacy: params.privacy ?? false,
        forTransfer: params.forTransfer,
      }
    );
  }

  /**
   * Purchase/register a domain
   * Requires customerId to be set in config
   */
  async purchase(request: DomainPurchaseRequest): Promise<DomainPurchaseResponse> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required for domain purchase. Set it in your config.');
    }
    return this.client.post<DomainPurchaseResponse>(
      `/v2/customers/${customerId}/domains/register`,
      request as unknown as Record<string, unknown>
    );
  }

  /**
   * Validate a domain purchase request before submitting
   */
  async validatePurchase(request: DomainPurchaseRequest): Promise<{ valid: boolean; status: number; data: unknown }> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required for domain validation. Set it in your config.');
    }
    try {
      await this.client.post<void>(
        `/v2/customers/${customerId}/domains/register/validate`,
        request as unknown as Record<string, unknown>
      );
      return { valid: true, status: 200, data: null };
    } catch (err: any) {
      return { valid: false, status: err.statusCode || 400, data: err.message };
    }
  }

  /**
   * Get the registration schema for a specific TLD
   */
  async getRegistrationSchema(tld: string): Promise<Record<string, unknown>> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required. Set it in your config.');
    }
    return this.client.get<Record<string, unknown>>(
      `/v2/customers/${customerId}/domains/register/schema/${tld}`
    );
  }

  /**
   * Get information about a domain you own
   */
  async getInfo(domain: string): Promise<DomainInfo> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required. Set it in your config.');
    }
    return this.client.get<DomainInfo>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}`,
      { includes: 'contacts,nameServers' }
    );
  }

  /**
   * List all domains in your account
   */
  async list(options?: {
    statuses?: string[];
    limit?: number;
    marker?: string;
    includes?: string[];
  }): Promise<DomainInfo[]> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required. Set it in your config.');
    }
    return this.client.get<DomainInfo[]>(
      `/v2/customers/${customerId}/domains`,
      {
        statuses: options?.statuses?.join(','),
        limit: options?.limit,
        marker: options?.marker,
        includes: options?.includes?.join(','),
      }
    );
  }

  /**
   * Update domain settings
   */
  async update(
    domain: string,
    settings: {
      locked?: boolean;
      nameServers?: string[];
      renewAuto?: boolean;
      subaccountId?: string;
    }
  ): Promise<void> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required. Set it in your config.');
    }
    await this.client.patch<void>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}`,
      settings
    );
  }

  /**
   * Delete/cancel a domain
   */
  async delete(domain: string): Promise<void> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required. Set it in your config.');
    }
    await this.client.delete<void>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}`
    );
  }

  /**
   * Renew a domain
   */
  async renew(
    domain: string,
    options?: {
      period?: number;
    }
  ): Promise<DomainPurchaseResponse> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required. Set it in your config.');
    }
    return this.client.post<DomainPurchaseResponse>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}/renew`,
      { period: options?.period || 1 }
    );
  }

  /**
   * Get the status of a domain action (e.g., REGISTER, TRANSFER)
   */
  async getActionStatus(domain: string, actionType: string): Promise<DomainAction> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required. Set it in your config.');
    }
    return this.client.get<DomainAction>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}/actions/${actionType}`
    );
  }

  /**
   * Check if a domain can be transferred
   */
  async checkTransferAvailability(
    domain: string,
    authCode: string
  ): Promise<{ available: boolean; reason?: string }> {
    return this.client.get<{ available: boolean; reason?: string }>(
      '/v2/domains/transferAvailable',
      { domain, authCode }
    );
  }

  /**
   * Initiate a domain transfer
   */
  async transfer(
    domain: string,
    authCode: string,
    options?: {
      period?: number;
      privacy?: boolean;
      renewAuto?: boolean;
      consent: {
        agreedAt: string;
        agreedBy: string;
        agreementKeys: string[];
      };
    }
  ): Promise<DomainPurchaseResponse> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required for domain transfer. Set it in your config.');
    }
    return this.client.post<DomainPurchaseResponse>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}/transfer`,
      {
        authCode,
        ...options,
      }
    );
  }

  /**
   * Enable privacy protection for a domain
   */
  async enablePrivacy(domain: string): Promise<void> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required. Set it in your config.');
    }
    await this.client.post<void>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}/privacy/purchase`
    );
  }

  /**
   * Disable privacy protection for a domain
   */
  async disablePrivacy(domain: string): Promise<void> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required. Set it in your config.');
    }
    await this.client.delete<void>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}/privacy`
    );
  }

  /**
   * Get DNS records for a domain
   */
  async getDnsRecords(
    domain: string,
    type?: string,
    name?: string
  ): Promise<Array<{ type: string; name: string; data: string; ttl: number }>> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required. Set it in your config.');
    }
    const basePath = `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}/records`;
    const path = type && name
      ? `${basePath}/${type}/${name}`
      : type
        ? `${basePath}/${type}`
        : basePath;
    return this.client.get(path);
  }

  /**
   * Add DNS records to a domain
   */
  async addDnsRecords(
    domain: string,
    records: Array<{ type: string; name: string; data: string; ttl?: number }>
  ): Promise<void> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required. Set it in your config.');
    }
    await this.client.patch<void>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}/records`,
      records as unknown as Record<string, unknown>
    );
  }

  /**
   * Replace all DNS records for a domain
   */
  async replaceDnsRecords(
    domain: string,
    records: Array<{ type: string; name: string; data: string; ttl?: number }>
  ): Promise<void> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required. Set it in your config.');
    }
    await this.client.put<void>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}/records`,
      { records }
    );
  }

  /**
   * Update nameservers for a domain
   */
  async updateNameServers(domain: string, nameServers: string[]): Promise<void> {
    const customerId = this.client.getCustomerId();
    if (!customerId) {
      throw new Error('Customer ID is required. Set it in your config.');
    }
    await this.client.put<void>(
      `/v2/customers/${customerId}/domains/${encodeURIComponent(domain)}/nameServers`,
      nameServers
    );
  }
}
