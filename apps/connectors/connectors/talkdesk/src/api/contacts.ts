import type { TalkdeskClient } from './client';
import type { TalkdeskContact, TalkdeskContactList, TalkdeskContactCreateParams } from '../types';

/**
 * Talkdesk Contacts API.
 * https://docs.talkdesk.com/docs/contacts-api
 */
export class ContactsApi {
  constructor(private readonly client: TalkdeskClient) {}

  /** List contacts (paginated with page/per_page). */
  async list(options?: { page?: number; perPage?: number }): Promise<TalkdeskContactList> {
    return this.client.get<TalkdeskContactList>('/contacts', {
      page: options?.page,
      per_page: options?.perPage,
    });
  }

  /** Get a single contact by ID. */
  async get(contactId: string): Promise<TalkdeskContact> {
    return this.client.get<TalkdeskContact>(`/contacts/${encodeURIComponent(contactId)}`);
  }

  /** Create a new contact. */
  async create(params: TalkdeskContactCreateParams): Promise<TalkdeskContact> {
    return this.client.post<TalkdeskContact>('/contacts', params);
  }

  /** Update an existing contact. */
  async update(contactId: string, params: Partial<TalkdeskContactCreateParams>): Promise<TalkdeskContact> {
    return this.client.put<TalkdeskContact>(`/contacts/${encodeURIComponent(contactId)}`, params);
  }

  /** Delete a contact. */
  async delete(contactId: string): Promise<void> {
    await this.client.delete(`/contacts/${encodeURIComponent(contactId)}`);
  }
}
