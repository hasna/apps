import type { PandaDocClient } from './client';
import type { Contact, ContactCreateParams, ContactListResponse } from '../types';

export interface ContactListOptions {
  email?: string;
  count?: number;
  page?: number;
}

/**
 * Contacts API - Manage PandaDoc contacts
 */
export class ContactsApi {
  constructor(private readonly client: PandaDocClient) {}

  /**
   * List contacts with optional filtering
   */
  async list(options?: ContactListOptions): Promise<ContactListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options) {
      if (options.email) params.email = options.email;
      if (options.count) params.count = options.count;
      if (options.page) params.page = options.page;
    }

    return this.client.get<ContactListResponse>('/contacts', params);
  }

  /**
   * Get contact by ID
   */
  async get(id: string): Promise<Contact> {
    return this.client.get<Contact>(`/contacts/${id}`);
  }

  /**
   * Create a new contact
   */
  async create(params: ContactCreateParams): Promise<Contact> {
    return this.client.post<Contact>('/contacts', params);
  }

  /**
   * Update a contact
   */
  async update(id: string, params: Partial<ContactCreateParams>): Promise<Contact> {
    return this.client.patch<Contact>(`/contacts/${id}`, params);
  }

  /**
   * Delete a contact
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/contacts/${id}`);
  }
}
