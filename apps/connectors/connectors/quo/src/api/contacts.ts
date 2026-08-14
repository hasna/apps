import type { QuoClient } from './client';
import type { Contact, ContactListResponse, CreateContactParams, UpdateContactParams } from '../types';

export interface ListContactsOptions {
  maxResults?: number;
  pageToken?: string;
  phoneNumber?: string;
  email?: string;
}

/**
 * Contacts API module
 * Create, update, list, and manage contacts
 */
export class ContactsApi {
  constructor(private readonly client: QuoClient) {}

  /**
   * List contacts with optional filters
   */
  async list(options?: ListContactsOptions): Promise<ContactListResponse> {
    return this.client.get<ContactListResponse>('/contacts', {
      maxResults: options?.maxResults,
      pageToken: options?.pageToken,
      phoneNumber: options?.phoneNumber,
      email: options?.email,
    });
  }

  /**
   * Get a contact by ID
   */
  async get(contactId: string): Promise<{ data: Contact }> {
    return this.client.get<{ data: Contact }>(`/contacts/${contactId}`);
  }

  /**
   * Create a new contact
   */
  async create(params: CreateContactParams): Promise<{ data: Contact }> {
    return this.client.post<{ data: Contact }>('/contacts', params);
  }

  /**
   * Update an existing contact
   */
  async update(contactId: string, params: UpdateContactParams): Promise<{ data: Contact }> {
    return this.client.patch<{ data: Contact }>(`/contacts/${contactId}`, params);
  }

  /**
   * Delete a contact
   */
  async delete(contactId: string): Promise<void> {
    await this.client.delete(`/contacts/${contactId}`);
  }
}
