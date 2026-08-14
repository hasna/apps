import type { ConnectorClient } from './client';
import type {
  Contact,
  ContactCreateParams,
  ContactUpdateParams,
  ContactListParams,
} from '../types';

export class ContactsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ContactListParams): Promise<Contact[]> {
    return this.client.get<Contact[]>('/contacts', {
      page_size: params?.page_size,
      cursor: params?.cursor,
    });
  }

  async get(id: number): Promise<Contact> {
    return this.client.get<Contact>(`/contacts/${id}`);
  }

  async getByEmail(email: string): Promise<Contact> {
    return this.client.get<Contact>(`/contacts/search/email/${encodeURIComponent(email)}`);
  }

  async getByPhone(phone: string): Promise<Contact> {
    return this.client.get<Contact>(`/contacts/search/phonenumber/${encodeURIComponent(phone)}`);
  }

  async create(data: ContactCreateParams): Promise<Contact> {
    return this.client.post<Contact>('/contacts', {
      ...data,
      type: data.type || 'PERSON',
    });
  }

  async update(data: ContactUpdateParams): Promise<Contact> {
    return this.client.put<Contact>('/contacts/edit-properties', data);
  }

  async delete(id: number): Promise<void> {
    await this.client.delete(`/contacts/${id}`);
  }

  async addTags(id: number, tags: string[]): Promise<Contact> {
    return this.client.put<Contact>('/contacts/edit/tags', {
      id,
      tags,
    });
  }

  async removeTags(id: number, tags: string[]): Promise<Contact> {
    return this.client.put<Contact>('/contacts/delete/tags', {
      id,
      tags,
    });
  }

  async updateLeadScore(id: number, score: number): Promise<Contact> {
    return this.client.put<Contact>('/contacts/edit/lead-score', {
      id,
      lead_score: score,
    });
  }

  async updateStarValue(id: number, starValue: number): Promise<Contact> {
    return this.client.put<Contact>('/contacts/edit/star', {
      id,
      star_value: starValue,
    });
  }

  async search(query: string): Promise<Contact[]> {
    return this.client.post<Contact[]>('/search', {
      q: query,
      type: 'PERSON',
    });
  }

  async listCompanies(): Promise<Contact[]> {
    return this.client.get<Contact[]>('/contacts/companies/list');
  }
}
