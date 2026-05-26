import type { ConnectorClient } from './client';
import type {
  Deal,
  DealCreateParams,
  DealUpdateParams,
  DealListParams,
} from '../types';

export class DealsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: DealListParams): Promise<Deal[]> {
    return this.client.get<Deal[]>('/opportunity', {
      page_size: params?.page_size,
      cursor: params?.cursor,
    });
  }

  async get(id: number): Promise<Deal> {
    return this.client.get<Deal>(`/opportunity/${id}`);
  }

  async create(data: DealCreateParams): Promise<Deal> {
    return this.client.post<Deal>('/opportunity', {
      name: data.name,
      description: data.description,
      expected_value: data.expected_value,
      probability: data.probability,
      milestone: data.milestone,
      close_date: data.close_date,
      contact_ids: data.contact_ids,
      custom_data: data.custom_data,
      pipeline_id: data.pipeline_id,
    });
  }

  async update(data: DealUpdateParams): Promise<Deal> {
    return this.client.put<Deal>('/opportunity/partial-update', data);
  }

  async delete(id: number): Promise<void> {
    await this.client.delete(`/opportunity/${id}`);
  }

  async getByContact(contactId: number): Promise<Deal[]> {
    return this.client.get<Deal[]>(`/contacts/${contactId}/deals`);
  }

  async getByMilestone(milestone: string): Promise<Deal[]> {
    return this.client.get<Deal[]>('/opportunity/byMilestone', { milestone });
  }

  async getMyDeals(): Promise<Deal[]> {
    return this.client.get<Deal[]>('/opportunity/my/deals');
  }
}
