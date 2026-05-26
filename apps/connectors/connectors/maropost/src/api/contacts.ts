import type { MaropostClient } from './client';
import type {
  Contact,
  ContactListResponse,
  CreateContactParams,
  UpdateContactParams,
  PaginationParams,
  OpenReport,
  ClickReport,
  ReportListResponse,
} from '../types';

/**
 * Contacts API module for Maropost
 * Manages contact records, tags, and list memberships
 */
export class ContactsApi {
  constructor(private readonly client: MaropostClient) {}

  /**
   * Get a contact by email address
   */
  async getByEmail(email: string): Promise<Contact> {
    return this.client.get<Contact>(`/contacts/${encodeURIComponent(email)}.json`);
  }

  /**
   * Create a new contact
   */
  async create(params: CreateContactParams): Promise<Contact> {
    return this.client.post<Contact>('/contacts.json', { contact: params });
  }

  /**
   * Update an existing contact by ID
   */
  async update(id: number, params: UpdateContactParams): Promise<Contact> {
    return this.client.put<Contact>(`/contacts/${id}.json`, { contact: params });
  }

  /**
   * Delete a contact by ID
   */
  async delete(id: number): Promise<void> {
    await this.client.delete(`/contacts/${id}.json`);
  }

  /**
   * Delete a contact by UID
   */
  async deleteByUid(uid: string): Promise<void> {
    await this.client.delete('/contacts/uid.json', { uid });
  }

  /**
   * Get contacts in a specific list
   */
  async listInList(listId: number, options?: PaginationParams): Promise<ContactListResponse> {
    return this.client.get<ContactListResponse>(`/lists/${listId}/contacts.json`, {
      page: options?.page,
      per: options?.per,
    });
  }

  /**
   * Create a contact in a specific list
   */
  async createInList(listId: number, params: CreateContactParams): Promise<Contact> {
    return this.client.post<Contact>(`/lists/${listId}/contacts.json`, { contact: params });
  }

  /**
   * Update a contact in a specific list
   */
  async updateInList(listId: number, contactId: number, params: UpdateContactParams): Promise<Contact> {
    return this.client.put<Contact>(`/lists/${listId}/contacts/${contactId}.json`, { contact: params });
  }

  /**
   * Delete a contact from a specific list
   */
  async deleteFromList(listId: number, contactId: number): Promise<void> {
    await this.client.delete(`/lists/${listId}/contacts/${contactId}.json`);
  }

  /**
   * Delete a contact from a list by UID
   */
  async deleteFromListByUid(listId: number, uid: string): Promise<void> {
    await this.client.delete(`/lists/${listId}/contacts/uid.json`, { uid });
  }

  /**
   * Get open report for a specific contact
   */
  async getOpenReport(contactId: number, options?: PaginationParams): Promise<ReportListResponse<OpenReport>> {
    return this.client.get<ReportListResponse<OpenReport>>(`/contacts/${contactId}/open_report.json`, {
      page: options?.page,
      per: options?.per,
    });
  }

  /**
   * Get click report for a specific contact
   */
  async getClickReport(contactId: number, options?: PaginationParams): Promise<ReportListResponse<ClickReport>> {
    return this.client.get<ReportListResponse<ClickReport>>(`/contacts/${contactId}/click_report.json`, {
      page: options?.page,
      per: options?.per,
    });
  }

  /**
   * Add tags to a contact
   */
  async addTags(email: string, tags: string[]): Promise<Contact> {
    const contact = await this.getByEmail(email);
    return this.update(contact.id, { tags });
  }

  /**
   * Remove tags from a contact
   */
  async removeTags(email: string, tags: string[]): Promise<Contact> {
    const contact = await this.getByEmail(email);
    return this.update(contact.id, { remove_tags: tags });
  }
}
