import type { ConnectorClient } from './client';
import type { Automation, ListParams } from '../types';

export class AutomationsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<Automation[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<Automation[]>('/automations', queryParams);
  }

  async get(automationId: number): Promise<Automation> {
    return this.client.get<Automation>(`/automations/${automationId}`);
  }

  async delete(automationId: number): Promise<void> {
    await this.client.delete(`/automations/${automationId}`);
  }

  async getDetails(automationId: number): Promise<unknown> {
    return this.client.get<unknown>(`/automations/${automationId}/details`);
  }

  async updateDetails(automationId: number, details: Record<string, unknown>): Promise<void> {
    await this.client.put(`/automations/${automationId}/details`, details);
  }

  async activate(automationId: number, active: boolean): Promise<void> {
    await this.client.put(`/automations/${automationId}/activation`, { IsActive: active });
  }
}
