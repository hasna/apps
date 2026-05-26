import type {
  IntercomConfig,
  Contact,
  ContactListResponse,
  ContactCreateParams,
  ContactUpdateParams,
  ContactSearchParams,
  Conversation,
  ConversationListResponse,
  ConversationReplyParams,
  ConversationSearchParams,
  Company,
  CompanyListResponse,
  CompanyCreateParams,
  Tag,
  TagListResponse,
  TagCreateParams,
  Admin,
  AdminListResponse,
  Team,
  TeamListResponse,
  DataEvent,
  DataEventListResponse,
  DataEventCreateParams,
  Article,
  ArticleListResponse,
  ArticleCreateParams,
  Note,
  NoteCreateParams,
  Message,
  MessageCreateParams,
} from '../types';
import { IntercomClient } from './client';

export class Intercom {
  private readonly client: IntercomClient;

  constructor(config: IntercomConfig) {
    this.client = new IntercomClient(config);
  }

  static fromEnv(): Intercom {
    const accessToken = process.env.INTERCOM_ACCESS_TOKEN;

    if (!accessToken) {
      throw new Error('INTERCOM_ACCESS_TOKEN environment variable is required');
    }
    return new Intercom({ accessToken });
  }

  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  getClient(): IntercomClient {
    return this.client;
  }

  // ============================================
  // Contact Methods
  // ============================================

  async listContacts(params?: { per_page?: number; starting_after?: string }): Promise<ContactListResponse> {
    return this.client.get<ContactListResponse>('/contacts', params);
  }

  async getContact(id: string): Promise<Contact> {
    return this.client.get<Contact>(`/contacts/${id}`);
  }

  async createContact(params: ContactCreateParams): Promise<Contact> {
    return this.client.post<Contact>('/contacts', params);
  }

  async updateContact(id: string, params: ContactUpdateParams): Promise<Contact> {
    return this.client.put<Contact>(`/contacts/${id}`, params);
  }

  async deleteContact(id: string): Promise<{ id: string; type: string; deleted: boolean }> {
    return this.client.delete<{ id: string; type: string; deleted: boolean }>(`/contacts/${id}`);
  }

  async archiveContact(id: string): Promise<Contact> {
    return this.client.post<Contact>(`/contacts/${id}/archive`);
  }

  async unarchiveContact(id: string): Promise<Contact> {
    return this.client.post<Contact>(`/contacts/${id}/unarchive`);
  }

  async searchContacts(params: ContactSearchParams): Promise<ContactListResponse> {
    return this.client.post<ContactListResponse>('/contacts/search', params);
  }

  async mergeContacts(leadId: string, userId: string): Promise<Contact> {
    return this.client.post<Contact>('/contacts/merge', {
      from: leadId,
      into: userId,
    });
  }

  async attachContactToCompany(contactId: string, companyId: string): Promise<Company> {
    return this.client.post<Company>(`/contacts/${contactId}/companies`, {
      id: companyId,
    });
  }

  async detachContactFromCompany(contactId: string, companyId: string): Promise<Company> {
    return this.client.delete<Company>(`/contacts/${contactId}/companies/${companyId}`);
  }

  async listContactCompanies(contactId: string): Promise<CompanyListResponse> {
    return this.client.get<CompanyListResponse>(`/contacts/${contactId}/companies`);
  }

  async addTagToContact(contactId: string, tagId: string): Promise<Tag> {
    return this.client.post<Tag>(`/contacts/${contactId}/tags`, {
      id: tagId,
    });
  }

  async removeTagFromContact(contactId: string, tagId: string): Promise<Tag> {
    return this.client.delete<Tag>(`/contacts/${contactId}/tags/${tagId}`);
  }

  async listContactTags(contactId: string): Promise<TagListResponse> {
    return this.client.get<TagListResponse>(`/contacts/${contactId}/tags`);
  }

  async createNoteForContact(params: NoteCreateParams): Promise<Note> {
    return this.client.post<Note>(`/contacts/${params.contact_id}/notes`, {
      body: params.body,
      admin_id: params.admin_id,
    });
  }

  async listContactNotes(contactId: string): Promise<{ type: string; data: Note[] }> {
    return this.client.get<{ type: string; data: Note[] }>(`/contacts/${contactId}/notes`);
  }

  // ============================================
  // Conversation Methods
  // ============================================

  async listConversations(params?: { per_page?: number; starting_after?: string }): Promise<ConversationListResponse> {
    return this.client.get<ConversationListResponse>('/conversations', params);
  }

  async getConversation(id: string, displayAs?: 'plaintext'): Promise<Conversation> {
    return this.client.get<Conversation>(`/conversations/${id}`, displayAs ? { display_as: displayAs } : undefined);
  }

  async searchConversations(params: ConversationSearchParams): Promise<ConversationListResponse> {
    return this.client.post<ConversationListResponse>('/conversations/search', params);
  }

  async replyToConversation(conversationId: string, params: ConversationReplyParams): Promise<Conversation> {
    return this.client.post<Conversation>(`/conversations/${conversationId}/reply`, params);
  }

  async closeConversation(conversationId: string, adminId: string, body?: string): Promise<Conversation> {
    return this.client.post<Conversation>(`/conversations/${conversationId}/parts`, {
      message_type: 'close',
      type: 'admin',
      admin_id: adminId,
      body,
    });
  }

  async openConversation(conversationId: string, adminId: string): Promise<Conversation> {
    return this.client.post<Conversation>(`/conversations/${conversationId}/parts`, {
      message_type: 'open',
      admin_id: adminId,
    });
  }

  async assignConversation(conversationId: string, adminId: string, assigneeId?: string, teamId?: string, body?: string): Promise<Conversation> {
    return this.client.post<Conversation>(`/conversations/${conversationId}/parts`, {
      message_type: 'assignment',
      type: 'admin',
      admin_id: adminId,
      assignee_id: assigneeId,
      team_id: teamId,
      body,
    });
  }

  async snoozeConversation(conversationId: string, adminId: string, snoozedUntil: number): Promise<Conversation> {
    return this.client.post<Conversation>(`/conversations/${conversationId}/parts`, {
      message_type: 'snoozed',
      admin_id: adminId,
      snoozed_until: snoozedUntil,
    });
  }

  async addTagToConversation(conversationId: string, tagId: string, adminId: string): Promise<Tag> {
    return this.client.post<Tag>(`/conversations/${conversationId}/tags`, {
      id: tagId,
      admin_id: adminId,
    });
  }

  async removeTagFromConversation(conversationId: string, tagId: string, adminId: string): Promise<Tag> {
    return this.client.delete<Tag>(`/conversations/${conversationId}/tags/${tagId}`, { admin_id: adminId });
  }

  // ============================================
  // Company Methods
  // ============================================

  async listCompanies(params?: { per_page?: number; page?: number }): Promise<CompanyListResponse> {
    return this.client.get<CompanyListResponse>('/companies', params);
  }

  async getCompany(id: string): Promise<Company> {
    return this.client.get<Company>(`/companies/${id}`);
  }

  async createOrUpdateCompany(params: CompanyCreateParams): Promise<Company> {
    return this.client.post<Company>('/companies', params);
  }

  async deleteCompany(id: string): Promise<{ id: string; type: string; deleted: boolean }> {
    return this.client.delete<{ id: string; type: string; deleted: boolean }>(`/companies/${id}`);
  }

  async listCompanyContacts(companyId: string, params?: { per_page?: number; page?: number }): Promise<ContactListResponse> {
    return this.client.get<ContactListResponse>(`/companies/${companyId}/contacts`, params);
  }

  async addTagToCompany(companyId: string, tagName: string): Promise<Tag> {
    return this.client.post<Tag>(`/companies/${companyId}/tags`, {
      name: tagName,
    });
  }

  async removeTagFromCompany(companyId: string, tagId: string): Promise<Tag> {
    return this.client.delete<Tag>(`/companies/${companyId}/tags/${tagId}`);
  }

  // ============================================
  // Tag Methods
  // ============================================

  async listTags(): Promise<TagListResponse> {
    return this.client.get<TagListResponse>('/tags');
  }

  async getTag(id: string): Promise<Tag> {
    return this.client.get<Tag>(`/tags/${id}`);
  }

  async createTag(params: TagCreateParams): Promise<Tag> {
    return this.client.post<Tag>('/tags', params);
  }

  async updateTag(id: string, name: string): Promise<Tag> {
    return this.client.put<Tag>(`/tags/${id}`, { name });
  }

  async deleteTag(id: string): Promise<void> {
    return this.client.delete<void>(`/tags/${id}`);
  }

  // ============================================
  // Admin Methods
  // ============================================

  async listAdmins(): Promise<AdminListResponse> {
    return this.client.get<AdminListResponse>('/admins');
  }

  async getAdmin(id: string): Promise<Admin> {
    return this.client.get<Admin>(`/admins/${id}`);
  }

  async getCurrentAdmin(): Promise<Admin> {
    return this.client.get<Admin>('/me');
  }

  async setAdminAwayMode(adminId: string, awayModeEnabled: boolean, awayModeReassign: boolean): Promise<Admin> {
    return this.client.put<Admin>(`/admins/${adminId}/away`, {
      away_mode_enabled: awayModeEnabled,
      away_mode_reassign: awayModeReassign,
    });
  }

  // ============================================
  // Team Methods
  // ============================================

  async listTeams(): Promise<TeamListResponse> {
    return this.client.get<TeamListResponse>('/teams');
  }

  async getTeam(id: string): Promise<Team> {
    return this.client.get<Team>(`/teams/${id}`);
  }

  // ============================================
  // Data Event Methods
  // ============================================

  async listDataEvents(params: { user_id?: string; intercom_user_id?: string; email?: string; type: string }): Promise<DataEventListResponse> {
    return this.client.get<DataEventListResponse>('/events', params);
  }

  async createDataEvent(params: DataEventCreateParams): Promise<void> {
    return this.client.post<void>('/events', params);
  }

  async trackDataEvents(events: DataEventCreateParams[]): Promise<void> {
    return this.client.post<void>('/bulk/events', {
      items: events.map(e => ({
        method: 'post',
        data_type: 'event',
        data: e,
      })),
    });
  }

  // ============================================
  // Article Methods
  // ============================================

  async listArticles(params?: { per_page?: number; page?: number }): Promise<ArticleListResponse> {
    return this.client.get<ArticleListResponse>('/articles', params);
  }

  async getArticle(id: string): Promise<Article> {
    return this.client.get<Article>(`/articles/${id}`);
  }

  async createArticle(params: ArticleCreateParams): Promise<Article> {
    return this.client.post<Article>('/articles', params);
  }

  async updateArticle(id: string, params: Partial<ArticleCreateParams>): Promise<Article> {
    return this.client.put<Article>(`/articles/${id}`, params);
  }

  async deleteArticle(id: string): Promise<{ id: string; type: string; deleted: boolean }> {
    return this.client.delete<{ id: string; type: string; deleted: boolean }>(`/articles/${id}`);
  }

  // ============================================
  // Message Methods (Outbound)
  // ============================================

  async createMessage(params: MessageCreateParams): Promise<Message> {
    return this.client.post<Message>('/messages', params);
  }

  // ============================================
  // Counts
  // ============================================

  async getCounts(type: 'conversation' | 'user' | 'company'): Promise<{
    type: string;
    [key: string]: unknown;
  }> {
    return this.client.get<{ type: string; [key: string]: unknown }>('/counts', { type });
  }
}

export { IntercomClient } from './client';
