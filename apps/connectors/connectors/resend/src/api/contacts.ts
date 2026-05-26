import type { ResendClient } from './client';
import type {
  Contact,
  CreateContactParams,
  UpdateContactParams,
  ListResponse,
} from '../types';

/**
 * Contacts API - Create, list, get, update, and delete contacts within audiences
 * https://resend.com/docs/api-reference/contacts
 */
export class ContactsApi {
  constructor(private readonly client: ResendClient) {}

  /**
   * Create a new contact in an audience
   * POST /audiences/:audienceId/contacts
   */
  async create(params: CreateContactParams): Promise<Contact> {
    const { audience_id, ...contactData } = params;
    return this.client.post<Contact>(`/audiences/${audience_id}/contacts`, contactData);
  }

  /**
   * List all contacts in an audience
   * GET /audiences/:audienceId/contacts
   */
  async list(audienceId: string): Promise<ListResponse<Contact>> {
    return this.client.get<ListResponse<Contact>>(`/audiences/${audienceId}/contacts`);
  }

  /**
   * Get a single contact by ID
   * GET /audiences/:audienceId/contacts/:id
   */
  async get(audienceId: string, contactId: string): Promise<Contact> {
    return this.client.get<Contact>(`/audiences/${audienceId}/contacts/${contactId}`);
  }

  /**
   * Update a contact
   * PATCH /audiences/:audienceId/contacts/:id
   */
  async update(audienceId: string, contactId: string, params: UpdateContactParams): Promise<Contact> {
    return this.client.patch<Contact>(`/audiences/${audienceId}/contacts/${contactId}`, params);
  }

  /**
   * Delete a contact from an audience
   * DELETE /audiences/:audienceId/contacts/:id
   */
  async delete(audienceId: string, contactId: string): Promise<{ deleted: boolean; id: string }> {
    return this.client.delete<{ deleted: boolean; id: string }>(`/audiences/${audienceId}/contacts/${contactId}`);
  }

  /**
   * Delete a contact by email from an audience
   * DELETE /audiences/:audienceId/contacts?email=:email
   */
  async deleteByEmail(audienceId: string, email: string): Promise<{ deleted: boolean; id: string }> {
    return this.client.delete<{ deleted: boolean; id: string }>(`/audiences/${audienceId}/contacts`, { email });
  }
}
