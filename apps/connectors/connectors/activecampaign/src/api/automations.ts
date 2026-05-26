import type { ConnectorClient } from './client';
import type { ListParams } from '../types';

export class AutomationsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.offset) queryParams.offset = params.offset;
    if (params?.filters) {
      for (const [key, value] of Object.entries(params.filters)) {
        queryParams[key] = value;
      }
    }
    return this.client.get<unknown>('/automations', queryParams);
  }

  async get(automationId: string): Promise<unknown> {
    return this.client.get<unknown>(`/automations/${automationId}`);
  }

  async addContact(automationId: string, contactId: string): Promise<unknown> {
    return this.client.post<unknown>('/contactAutomations', {
      contactAutomation: { contact: contactId, automation: automationId },
    });
  }

  async removeContact(contactAutomationId: string): Promise<void> {
    await this.client.delete(`/contactAutomations/${contactAutomationId}`);
  }
}
