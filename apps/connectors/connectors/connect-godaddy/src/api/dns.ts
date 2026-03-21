import type { GoDaddyClient } from './client';
import type { GoDaddyDnsRecord } from '../types';

export class DnsApi {
  constructor(private readonly client: GoDaddyClient) {}

  /**
   * Get all DNS records for a domain, optionally filtered by type
   */
  async getRecords(domain: string, type?: string): Promise<GoDaddyDnsRecord[]> {
    const path = type
      ? `/v1/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(type)}`
      : `/v1/domains/${encodeURIComponent(domain)}/records`;
    return this.client.get<GoDaddyDnsRecord[]>(path);
  }

  /**
   * Get DNS records for a domain filtered by type and name
   */
  async getRecordsByName(domain: string, type: string, name: string): Promise<GoDaddyDnsRecord[]> {
    return this.client.get<GoDaddyDnsRecord[]>(
      `/v1/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(type)}/${encodeURIComponent(name)}`
    );
  }

  /**
   * Replace all DNS records for a domain of a given type
   */
  async setRecords(domain: string, type: string, records: GoDaddyDnsRecord[]): Promise<void> {
    await this.client.put<void>(
      `/v1/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(type)}`,
      records as unknown as Record<string, unknown>[]
    );
  }

  /**
   * Replace all DNS records for a domain
   */
  async replaceAllRecords(domain: string, records: GoDaddyDnsRecord[]): Promise<void> {
    await this.client.put<void>(
      `/v1/domains/${encodeURIComponent(domain)}/records`,
      records as unknown as Record<string, unknown>[]
    );
  }

  /**
   * Add DNS records to a domain (append, does not replace)
   */
  async addRecords(domain: string, records: GoDaddyDnsRecord[]): Promise<void> {
    await this.client.patch<void>(
      `/v1/domains/${encodeURIComponent(domain)}/records`,
      records as unknown as Record<string, unknown>[]
    );
  }

  /**
   * Replace DNS records for a domain by type and name
   */
  async setRecordsByName(domain: string, type: string, name: string, records: GoDaddyDnsRecord[]): Promise<void> {
    await this.client.put<void>(
      `/v1/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(type)}/${encodeURIComponent(name)}`,
      records as unknown as Record<string, unknown>[]
    );
  }
}
