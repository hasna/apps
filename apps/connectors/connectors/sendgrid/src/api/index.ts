import { SendGridClient } from './client';
import type {
  SendGridConfig,
  SendMailParams,
  Contact,
  ContactListResponse,
  ContactImportJob,
  ContactList,
  ListListResponse,
  Template,
  TemplateListResponse,
  TemplateCreateParams,
  TemplateVersion,
  TemplateVersionCreateParams,
  Sender,
  SenderListResponse,
  SenderCreateParams,
  Stats,
  Bounce,
  Block,
  SpamReport,
  InvalidEmail,
  Unsubscribe,
  UnsubscribeGroup,
  UnsubscribeGroupCreateParams,
  ApiKey,
  ApiKeyCreateParams,
  ApiKeyCreateResponse,
} from '../types';

export { SendGridClient };

/**
 * SendGrid API wrapper
 */
export class SendGrid {
  private client: SendGridClient;

  constructor(config: SendGridConfig) {
    this.client = new SendGridClient(config);
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): SendGridClient {
    return this.client;
  }

  // ============================================
  // Mail Send
  // ============================================

  /**
   * Send an email
   */
  async sendMail(params: SendMailParams): Promise<void> {
    await this.client.post('/mail/send', params);
  }

  /**
   * Send a simple email (convenience method)
   */
  async sendSimpleEmail(options: {
    to: string | string[];
    from: string;
    fromName?: string;
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string;
  }): Promise<void> {
    const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

    await this.sendMail({
      personalizations: [{
        to: toAddresses.map(email => ({ email })),
      }],
      from: { email: options.from, name: options.fromName },
      subject: options.subject,
      content: [
        ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
        ...(options.html ? [{ type: 'text/html', value: options.html }] : []),
      ],
      reply_to: options.replyTo ? { email: options.replyTo } : undefined,
    });
  }

  // ============================================
  // Contacts (Marketing)
  // ============================================

  /**
   * Get all contacts
   */
  async listContacts(): Promise<ContactListResponse> {
    return this.client.get<ContactListResponse>('/marketing/contacts');
  }

  /**
   * Get a contact by ID
   */
  async getContact(contactId: string): Promise<Contact> {
    return this.client.get<Contact>(`/marketing/contacts/${contactId}`);
  }

  /**
   * Search contacts by email
   */
  async searchContacts(query: string): Promise<ContactListResponse> {
    return this.client.post<ContactListResponse>('/marketing/contacts/search', {
      query: `email LIKE '%${query}%'`,
    });
  }

  /**
   * Add or update contacts
   */
  async upsertContacts(contacts: Contact[], listIds?: string[]): Promise<{ job_id: string }> {
    return this.client.put<{ job_id: string }>('/marketing/contacts', {
      list_ids: listIds,
      contacts,
    });
  }

  /**
   * Delete contacts
   */
  async deleteContacts(ids?: string[], deleteAllContacts?: boolean): Promise<{ job_id: string }> {
    return this.client.delete<{ job_id: string }>('/marketing/contacts', {
      ids: ids?.join(','),
      delete_all_contacts: deleteAllContacts,
    });
  }

  /**
   * Get contact import job status
   */
  async getContactImportJob(jobId: string): Promise<ContactImportJob> {
    return this.client.get<ContactImportJob>(`/marketing/contacts/imports/${jobId}`);
  }

  /**
   * Get contact count
   */
  async getContactCount(): Promise<{ contact_count: number; billable_count: number }> {
    return this.client.get('/marketing/contacts/count');
  }

  // ============================================
  // Lists (Marketing)
  // ============================================

  /**
   * Get all lists
   */
  async listContactLists(): Promise<ListListResponse> {
    return this.client.get<ListListResponse>('/marketing/lists');
  }

  /**
   * Get a list by ID
   */
  async getContactList(listId: string): Promise<ContactList> {
    return this.client.get<ContactList>(`/marketing/lists/${listId}`);
  }

  /**
   * Create a list
   */
  async createContactList(name: string): Promise<ContactList> {
    return this.client.post<ContactList>('/marketing/lists', { name });
  }

  /**
   * Update a list
   */
  async updateContactList(listId: string, name: string): Promise<ContactList> {
    return this.client.patch<ContactList>(`/marketing/lists/${listId}`, { name });
  }

  /**
   * Delete a list
   */
  async deleteContactList(listId: string, deleteContacts?: boolean): Promise<void> {
    await this.client.delete(`/marketing/lists/${listId}`, {
      delete_contacts: deleteContacts,
    });
  }

  /**
   * Add contacts to a list
   */
  async addContactsToList(listId: string, contactIds: string[]): Promise<{ job_id: string }> {
    return this.client.put<{ job_id: string }>('/marketing/contacts', {
      list_ids: [listId],
      contacts: contactIds.map(id => ({ id })),
    });
  }

  /**
   * Remove contacts from a list
   */
  async removeContactsFromList(listId: string, contactIds: string[]): Promise<{ job_id: string }> {
    return this.client.delete<{ job_id: string }>(`/marketing/lists/${listId}/contacts`, {
      contact_ids: contactIds.join(','),
    });
  }

  // ============================================
  // Templates
  // ============================================

  /**
   * Get all templates
   */
  async listTemplates(generations?: 'legacy' | 'dynamic' | 'legacy,dynamic'): Promise<TemplateListResponse> {
    return this.client.get<TemplateListResponse>('/templates', {
      generations: generations || 'dynamic',
    });
  }

  /**
   * Get a template by ID
   */
  async getTemplate(templateId: string): Promise<Template> {
    return this.client.get<Template>(`/templates/${templateId}`);
  }

  /**
   * Create a template
   */
  async createTemplate(params: TemplateCreateParams): Promise<Template> {
    return this.client.post<Template>('/templates', params);
  }

  /**
   * Update a template
   */
  async updateTemplate(templateId: string, name: string): Promise<Template> {
    return this.client.patch<Template>(`/templates/${templateId}`, { name });
  }

  /**
   * Delete a template
   */
  async deleteTemplate(templateId: string): Promise<void> {
    await this.client.delete(`/templates/${templateId}`);
  }

  /**
   * Create a template version
   */
  async createTemplateVersion(params: TemplateVersionCreateParams): Promise<TemplateVersion> {
    return this.client.post<TemplateVersion>(`/templates/${params.template_id}/versions`, params);
  }

  /**
   * Update a template version
   */
  async updateTemplateVersion(templateId: string, versionId: string, params: Partial<TemplateVersionCreateParams>): Promise<TemplateVersion> {
    return this.client.patch<TemplateVersion>(`/templates/${templateId}/versions/${versionId}`, params);
  }

  /**
   * Delete a template version
   */
  async deleteTemplateVersion(templateId: string, versionId: string): Promise<void> {
    await this.client.delete(`/templates/${templateId}/versions/${versionId}`);
  }

  /**
   * Activate a template version
   */
  async activateTemplateVersion(templateId: string, versionId: string): Promise<TemplateVersion> {
    return this.client.post<TemplateVersion>(`/templates/${templateId}/versions/${versionId}/activate`, {});
  }

  // ============================================
  // Senders
  // ============================================

  /**
   * Get all senders
   */
  async listSenders(): Promise<SenderListResponse> {
    return this.client.get<SenderListResponse>('/senders');
  }

  /**
   * Get a sender by ID
   */
  async getSender(senderId: number): Promise<Sender> {
    return this.client.get<Sender>(`/senders/${senderId}`);
  }

  /**
   * Create a sender
   */
  async createSender(params: SenderCreateParams): Promise<Sender> {
    return this.client.post<Sender>('/senders', params);
  }

  /**
   * Update a sender
   */
  async updateSender(senderId: number, params: Partial<SenderCreateParams>): Promise<Sender> {
    return this.client.patch<Sender>(`/senders/${senderId}`, params);
  }

  /**
   * Delete a sender
   */
  async deleteSender(senderId: number): Promise<void> {
    await this.client.delete(`/senders/${senderId}`);
  }

  /**
   * Resend sender verification
   */
  async resendSenderVerification(senderId: number): Promise<void> {
    await this.client.post(`/senders/${senderId}/resend_verification`, {});
  }

  // ============================================
  // Stats
  // ============================================

  /**
   * Get global email stats
   */
  async getStats(params?: {
    start_date: string;
    end_date?: string;
    aggregated_by?: 'day' | 'week' | 'month';
  }): Promise<Stats[]> {
    return this.client.get<Stats[]>('/stats', params);
  }

  /**
   * Get stats by category
   */
  async getStatsByCategory(params: {
    start_date: string;
    end_date?: string;
    categories: string;
    aggregated_by?: 'day' | 'week' | 'month';
  }): Promise<Stats[]> {
    return this.client.get<Stats[]>('/categories/stats', params);
  }

  // ============================================
  // Suppressions - Bounces
  // ============================================

  /**
   * Get all bounces
   */
  async listBounces(params?: {
    start_time?: number;
    end_time?: number;
    limit?: number;
    offset?: number;
  }): Promise<Bounce[]> {
    return this.client.get<Bounce[]>('/suppression/bounces', params);
  }

  /**
   * Get a bounce by email
   */
  async getBounce(email: string): Promise<Bounce[]> {
    return this.client.get<Bounce[]>(`/suppression/bounces/${email}`);
  }

  /**
   * Delete bounces
   */
  async deleteBounces(emails?: string[], deleteAll?: boolean): Promise<void> {
    await this.client.delete('/suppression/bounces', undefined, {
      emails,
      delete_all: deleteAll,
    });
  }

  // ============================================
  // Suppressions - Blocks
  // ============================================

  /**
   * Get all blocks
   */
  async listBlocks(params?: {
    start_time?: number;
    end_time?: number;
    limit?: number;
    offset?: number;
  }): Promise<Block[]> {
    return this.client.get<Block[]>('/suppression/blocks', params);
  }

  /**
   * Delete blocks
   */
  async deleteBlocks(emails?: string[], deleteAll?: boolean): Promise<void> {
    await this.client.delete('/suppression/blocks', undefined, {
      emails,
      delete_all: deleteAll,
    });
  }

  // ============================================
  // Suppressions - Spam Reports
  // ============================================

  /**
   * Get all spam reports
   */
  async listSpamReports(params?: {
    start_time?: number;
    end_time?: number;
    limit?: number;
    offset?: number;
  }): Promise<SpamReport[]> {
    return this.client.get<SpamReport[]>('/suppression/spam_reports', params);
  }

  /**
   * Delete spam reports
   */
  async deleteSpamReports(emails?: string[], deleteAll?: boolean): Promise<void> {
    await this.client.delete('/suppression/spam_reports', undefined, {
      emails,
      delete_all: deleteAll,
    });
  }

  // ============================================
  // Suppressions - Invalid Emails
  // ============================================

  /**
   * Get all invalid emails
   */
  async listInvalidEmails(params?: {
    start_time?: number;
    end_time?: number;
    limit?: number;
    offset?: number;
  }): Promise<InvalidEmail[]> {
    return this.client.get<InvalidEmail[]>('/suppression/invalid_emails', params);
  }

  /**
   * Delete invalid emails
   */
  async deleteInvalidEmails(emails?: string[], deleteAll?: boolean): Promise<void> {
    await this.client.delete('/suppression/invalid_emails', undefined, {
      emails,
      delete_all: deleteAll,
    });
  }

  // ============================================
  // Unsubscribe Groups
  // ============================================

  /**
   * Get all unsubscribe groups
   */
  async listUnsubscribeGroups(): Promise<UnsubscribeGroup[]> {
    return this.client.get<UnsubscribeGroup[]>('/asm/groups');
  }

  /**
   * Get an unsubscribe group by ID
   */
  async getUnsubscribeGroup(groupId: number): Promise<UnsubscribeGroup> {
    return this.client.get<UnsubscribeGroup>(`/asm/groups/${groupId}`);
  }

  /**
   * Create an unsubscribe group
   */
  async createUnsubscribeGroup(params: UnsubscribeGroupCreateParams): Promise<UnsubscribeGroup> {
    return this.client.post<UnsubscribeGroup>('/asm/groups', params);
  }

  /**
   * Update an unsubscribe group
   */
  async updateUnsubscribeGroup(groupId: number, params: Partial<UnsubscribeGroupCreateParams>): Promise<UnsubscribeGroup> {
    return this.client.patch<UnsubscribeGroup>(`/asm/groups/${groupId}`, params);
  }

  /**
   * Delete an unsubscribe group
   */
  async deleteUnsubscribeGroup(groupId: number): Promise<void> {
    await this.client.delete(`/asm/groups/${groupId}`);
  }

  /**
   * Get unsubscribes for a group
   */
  async getGroupUnsubscribes(groupId: number): Promise<string[]> {
    return this.client.get<string[]>(`/asm/groups/${groupId}/suppressions`);
  }

  /**
   * Add suppressions to a group
   */
  async addGroupSuppressions(groupId: number, emails: string[]): Promise<{ recipient_emails: string[] }> {
    return this.client.post(`/asm/groups/${groupId}/suppressions`, {
      recipient_emails: emails,
    });
  }

  // ============================================
  // Global Unsubscribes
  // ============================================

  /**
   * Get all global unsubscribes
   */
  async listGlobalUnsubscribes(params?: {
    start_time?: number;
    end_time?: number;
    limit?: number;
    offset?: number;
  }): Promise<Unsubscribe[]> {
    return this.client.get<Unsubscribe[]>('/suppression/unsubscribes', params);
  }

  /**
   * Add a global unsubscribe
   */
  async addGlobalUnsubscribe(emails: string[]): Promise<void> {
    await this.client.post('/asm/suppressions/global', {
      recipient_emails: emails,
    });
  }

  /**
   * Delete a global unsubscribe
   */
  async deleteGlobalUnsubscribe(email: string): Promise<void> {
    await this.client.delete(`/asm/suppressions/global/${email}`);
  }

  // ============================================
  // API Keys
  // ============================================

  /**
   * Get all API keys
   */
  async listApiKeys(): Promise<{ result: ApiKey[] }> {
    return this.client.get('/api_keys');
  }

  /**
   * Get an API key by ID
   */
  async getApiKey(keyId: string): Promise<ApiKey> {
    return this.client.get<ApiKey>(`/api_keys/${keyId}`);
  }

  /**
   * Create an API key
   */
  async createApiKey(params: ApiKeyCreateParams): Promise<ApiKeyCreateResponse> {
    return this.client.post<ApiKeyCreateResponse>('/api_keys', params);
  }

  /**
   * Update an API key
   */
  async updateApiKey(keyId: string, name: string, scopes?: string[]): Promise<ApiKey> {
    return this.client.patch<ApiKey>(`/api_keys/${keyId}`, { name, scopes });
  }

  /**
   * Delete an API key
   */
  async deleteApiKey(keyId: string): Promise<void> {
    await this.client.delete(`/api_keys/${keyId}`);
  }
}
