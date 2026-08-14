// ServiceNow Connector — Enterprise IT service management and workflow automation
import { ServiceNowClient } from './client';
import type { ServiceNowConfig, SNRecord, SNRecordList, SNSingleRecord } from '../types';
export { ServiceNowClient } from './client';

export class ServiceNow {
  private readonly client: ServiceNowClient;
  constructor(config: ServiceNowConfig) { this.client = new ServiceNowClient(config); }
  static fromEnv(): ServiceNow {
    const instance = process.env.SERVICENOW_INSTANCE;
    const username = process.env.SERVICENOW_USERNAME;
    const password = process.env.SERVICENOW_PASSWORD;
    if (!instance || !username || !password) throw new Error('SERVICENOW_INSTANCE, SERVICENOW_USERNAME, and SERVICENOW_PASSWORD are required');
    return new ServiceNow({ instance, username, password });
  }

  // Generic Table API (works with any ServiceNow table)
  async listRecords(table: string, options?: { sysparm_limit?: number; sysparm_offset?: number; sysparm_query?: string; sysparm_fields?: string; sysparm_display_value?: string }): Promise<SNRecordList> {
    return this.client.request<SNRecordList>(`/table/${table}`, { params: options as Record<string, string | number | undefined> });
  }
  async getRecord(table: string, sysId: string, options?: { sysparm_fields?: string; sysparm_display_value?: string }): Promise<SNSingleRecord> {
    return this.client.request<SNSingleRecord>(`/table/${table}/${sysId}`, { params: options as Record<string, string | number | undefined> });
  }
  async createRecord(table: string, data: Record<string, unknown>): Promise<SNSingleRecord> {
    return this.client.request<SNSingleRecord>(`/table/${table}`, { method: 'POST', body: data });
  }
  async updateRecord(table: string, sysId: string, data: Record<string, unknown>): Promise<SNSingleRecord> {
    return this.client.request<SNSingleRecord>(`/table/${table}/${sysId}`, { method: 'PATCH', body: data });
  }
  async deleteRecord(table: string, sysId: string): Promise<void> {
    await this.client.request(`/table/${table}/${sysId}`, { method: 'DELETE' });
  }

  // Convenience methods for common tables
  async listIncidents(options?: { sysparm_limit?: number; sysparm_query?: string }): Promise<SNRecordList> {
    return this.listRecords('incident', { ...options, sysparm_display_value: 'true' });
  }
  async createIncident(data: { short_description: string; description?: string; urgency?: string; impact?: string; caller_id?: string; category?: string }): Promise<SNSingleRecord> {
    return this.createRecord('incident', data);
  }

  async listUsers(options?: { sysparm_limit?: number; sysparm_query?: string }): Promise<SNRecordList> {
    return this.listRecords('sys_user', options);
  }

  async listChangeRequests(options?: { sysparm_limit?: number; sysparm_query?: string }): Promise<SNRecordList> {
    return this.listRecords('change_request', options);
  }

  async listCatalogItems(options?: { sysparm_limit?: number }): Promise<SNRecordList> {
    return this.listRecords('sc_cat_item', options);
  }

  getClient(): ServiceNowClient { return this.client; }
}
