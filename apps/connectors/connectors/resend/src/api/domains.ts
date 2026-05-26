import type { ResendClient } from './client';
import type {
  Domain,
  CreateDomainParams,
  UpdateDomainParams,
  VerifyDomainResponse,
  ListResponse,
} from '../types';

/**
 * Domains API - Add, verify, and manage sending domains
 * https://resend.com/docs/api-reference/domains
 */
export class DomainsApi {
  constructor(private readonly client: ResendClient) {}

  /**
   * Add a new domain
   * POST /domains
   */
  async create(params: CreateDomainParams): Promise<Domain> {
    return this.client.post<Domain>('/domains', params);
  }

  /**
   * List all domains
   * GET /domains
   */
  async list(): Promise<ListResponse<Domain>> {
    return this.client.get<ListResponse<Domain>>('/domains');
  }

  /**
   * Get a single domain by ID
   * GET /domains/:id
   */
  async get(domainId: string): Promise<Domain> {
    return this.client.get<Domain>(`/domains/${domainId}`);
  }

  /**
   * Update a domain (tracking settings, TLS)
   * PATCH /domains/:id
   */
  async update(domainId: string, params: UpdateDomainParams): Promise<Domain> {
    return this.client.patch<Domain>(`/domains/${domainId}`, params);
  }

  /**
   * Delete a domain
   * DELETE /domains/:id
   */
  async delete(domainId: string): Promise<{ deleted: boolean; id: string }> {
    return this.client.delete<{ deleted: boolean; id: string }>(`/domains/${domainId}`);
  }

  /**
   * Verify a domain's DNS records
   * POST /domains/:id/verify
   */
  async verify(domainId: string): Promise<VerifyDomainResponse> {
    return this.client.post<VerifyDomainResponse>(`/domains/${domainId}/verify`);
  }
}
