import type { MaropostClient } from './client';
import type {
  List,
  ListResponse,
  CreateListParams,
  UpdateListParams,
  PaginationParams,
  Contact,
  ContactListResponse,
} from '../types';

/**
 * Lists API module for Maropost
 * Manages contact lists and list membership
 */
export class ListsApi {
  constructor(private readonly client: MaropostClient) {}

  /**
   * List all lists with pagination
   */
  async list(options?: PaginationParams): Promise<ListResponse> {
    return this.client.get<ListResponse>('/lists.json', {
      page: options?.page,
      per: options?.per,
    });
  }

  /**
   * Get a single list by ID
   */
  async get(id: number): Promise<List> {
    return this.client.get<List>(`/lists/${id}.json`);
  }

  /**
   * Create a new list
   */
  async create(params: CreateListParams): Promise<List> {
    return this.client.post<List>('/lists.json', { list: params });
  }

  /**
   * Update an existing list
   */
  async update(id: number, params: UpdateListParams): Promise<List> {
    return this.client.put<List>(`/lists/${id}.json`, { list: params });
  }

  /**
   * Delete a list
   */
  async delete(id: number): Promise<void> {
    await this.client.delete(`/lists/${id}.json`);
  }

  /**
   * Get contacts in a list
   */
  async getContacts(listId: number, options?: PaginationParams): Promise<ContactListResponse> {
    return this.client.get<ContactListResponse>(`/lists/${listId}/contacts.json`, {
      page: options?.page,
      per: options?.per,
    });
  }

  /**
   * Add a contact to a list
   */
  async addContact(listId: number, contact: { email: string; first_name?: string; last_name?: string }): Promise<Contact> {
    return this.client.post<Contact>(`/lists/${listId}/contacts.json`, { contact });
  }

  /**
   * Remove a contact from a list
   */
  async removeContact(listId: number, contactId: number): Promise<void> {
    await this.client.delete(`/lists/${listId}/contacts/${contactId}.json`);
  }
}
