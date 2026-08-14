// Specter Connector — Game intelligence platform for studios and developers
import { SpecterClient } from './client';
import type { SpecterConfig, SPApp, SPEvent, SPEventData, SPUser, SPUserList, SPSegment, SPEconomy } from '../types';
export { SpecterClient } from './client';

export class Specter {
  private readonly client: SpecterClient;
  constructor(config: SpecterConfig) { this.client = new SpecterClient(config); }
  static fromEnv(): Specter {
    const apiKey = process.env.SPECTER_API_KEY;
    const projectId = process.env.SPECTER_PROJECT_ID;
    if (!apiKey || !projectId) throw new Error('SPECTER_API_KEY and SPECTER_PROJECT_ID are required');
    return new Specter({ apiKey, projectId });
  }

  async listApps(): Promise<SPApp[]> { return this.client.request<SPApp[]>('/apps'); }
  async getApp(appId: string): Promise<SPApp> { return this.client.request<SPApp>(`/apps/${appId}`); }

  async listEvents(): Promise<SPEvent[]> { return this.client.request<SPEvent[]>('/events'); }
  async getEventData(eventName: string, options?: { start_date?: string; end_date?: string }): Promise<SPEventData[]> {
    return this.client.request<SPEventData[]>(`/events/${eventName}/data`, { params: { start_date: options?.start_date, end_date: options?.end_date } });
  }

  async listUsers(options?: { page?: number; per_page?: number; segment_id?: string }): Promise<SPUserList> {
    return this.client.request<SPUserList>('/users', { params: { page: options?.page, per_page: options?.per_page, segment_id: options?.segment_id } });
  }
  async getUser(userId: string): Promise<SPUser> { return this.client.request<SPUser>(`/users/${userId}`); }

  async listSegments(): Promise<SPSegment[]> { return this.client.request<SPSegment[]>('/segments'); }
  async getSegment(segmentId: string): Promise<SPSegment> { return this.client.request<SPSegment>(`/segments/${segmentId}`); }

  async listEconomyItems(): Promise<SPEconomy[]> { return this.client.request<SPEconomy[]>('/economy/items'); }

  getClient(): SpecterClient { return this.client; }
}
