import type { CloudflareClient } from './client';
import type { DNSRecord, CreateDNSRecordParams, ListDNSRecordsParams, CloudflareResponse } from '../types';

export class DNSApi {
  constructor(private client: CloudflareClient) {}

  /**
   * List DNS records for a zone
   */
  async list(zoneId: string, params?: ListDNSRecordsParams): Promise<CloudflareResponse<DNSRecord[]>> {
    return this.client.get<DNSRecord[]>(`/zones/${zoneId}/dns_records`, params as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Get a DNS record
   */
  async get(zoneId: string, recordId: string): Promise<DNSRecord> {
    const response = await this.client.get<DNSRecord>(`/zones/${zoneId}/dns_records/${recordId}`);
    return response.result;
  }

  /**
   * Create a DNS record
   */
  async create(zoneId: string, params: CreateDNSRecordParams): Promise<DNSRecord> {
    const response = await this.client.post<DNSRecord>(
      `/zones/${zoneId}/dns_records`,
      params as unknown as Record<string, unknown>
    );
    return response.result;
  }

  /**
   * Update a DNS record (full replace)
   */
  async update(zoneId: string, recordId: string, params: CreateDNSRecordParams): Promise<DNSRecord> {
    const response = await this.client.put<DNSRecord>(
      `/zones/${zoneId}/dns_records/${recordId}`,
      params as unknown as Record<string, unknown>
    );
    return response.result;
  }

  /**
   * Patch a DNS record (partial update)
   */
  async patch(zoneId: string, recordId: string, params: Partial<CreateDNSRecordParams>): Promise<DNSRecord> {
    const response = await this.client.patch<DNSRecord>(
      `/zones/${zoneId}/dns_records/${recordId}`,
      params as unknown as Record<string, unknown>
    );
    return response.result;
  }

  /**
   * Delete a DNS record
   */
  async delete(zoneId: string, recordId: string): Promise<{ id: string }> {
    const response = await this.client.delete<{ id: string }>(`/zones/${zoneId}/dns_records/${recordId}`);
    return response.result;
  }

  /**
   * Import DNS records from BIND file
   */
  async import(zoneId: string, bindFile: string): Promise<{
    recs_added: number;
    total_records_parsed: number;
  }> {
    const formData = new FormData();
    const blob = new Blob([bindFile], { type: 'text/plain' });
    formData.append('file', blob, 'dns_records.txt');

    const response = await this.client.request<CloudflareResponse<{
      recs_added: number;
      total_records_parsed: number;
    }>>(`/zones/${zoneId}/dns_records/import`, {
      method: 'POST',
      body: formData,
    });
    return response.result;
  }

  /**
   * Export DNS records to BIND format
   */
  async export(zoneId: string): Promise<string> {
    const response = await this.client.request<string>(`/zones/${zoneId}/dns_records/export`, {
      method: 'GET',
    });
    return response;
  }

  /**
   * Scan DNS records (auto-discover records)
   */
  async scan(zoneId: string): Promise<{
    recs_added: number;
    recs_added_by_type: Record<string, number>;
    total_records_parsed: number;
  }> {
    const response = await this.client.post<{
      recs_added: number;
      recs_added_by_type: Record<string, number>;
      total_records_parsed: number;
    }>(`/zones/${zoneId}/dns_records/scan`);
    return response.result;
  }
}
