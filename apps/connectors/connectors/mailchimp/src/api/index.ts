import { MailchimpClient } from './client';
import type {
  MailchimpConfig,
  AccountInfo,
  List,
  ListListResponse,
  ListCreateParams,
  Member,
  MemberListResponse,
  MemberCreateParams,
  MemberUpdateParams,
  Campaign,
  CampaignListResponse,
  CampaignCreateParams,
  Template,
  TemplateListResponse,
  TemplateCreateParams,
  Tag,
  TagListResponse,
  Segment,
  SegmentListResponse,
  Report,
  ReportListResponse,
} from '../types';
import * as crypto from 'crypto';

export { MailchimpClient };

/**
 * Mailchimp API wrapper
 */
export class Mailchimp {
  private client: MailchimpClient;

  constructor(config: MailchimpConfig) {
    this.client = new MailchimpClient(config);
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): MailchimpClient {
    return this.client;
  }

  // ============================================
  // Account/Root Methods
  // ============================================

  /**
   * Get account information
   */
  async getAccountInfo(): Promise<AccountInfo> {
    return this.client.get<AccountInfo>('/');
  }

  /**
   * Ping the API to verify credentials
   */
  async ping(): Promise<{ health_status: string }> {
    return this.client.get<{ health_status: string }>('/ping');
  }

  // ============================================
  // List/Audience Methods
  // ============================================

  /**
   * List all audiences/lists
   */
  async listLists(params?: {
    count?: number;
    offset?: number;
    sort_field?: 'date_created';
    sort_dir?: 'ASC' | 'DESC';
  }): Promise<ListListResponse> {
    return this.client.get<ListListResponse>('/lists', params);
  }

  /**
   * Get a specific list/audience by ID
   */
  async getList(listId: string): Promise<List> {
    return this.client.get<List>(`/lists/${listId}`);
  }

  /**
   * Create a new list/audience
   */
  async createList(params: ListCreateParams): Promise<List> {
    return this.client.post<List>('/lists', params);
  }

  /**
   * Update a list/audience
   */
  async updateList(listId: string, params: Partial<ListCreateParams>): Promise<List> {
    return this.client.patch<List>(`/lists/${listId}`, params);
  }

  /**
   * Delete a list/audience
   */
  async deleteList(listId: string): Promise<void> {
    await this.client.delete(`/lists/${listId}`);
  }

  // ============================================
  // Member Methods
  // ============================================

  /**
   * Get subscriber hash (MD5 of lowercase email)
   */
  private getSubscriberHash(email: string): string {
    return crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
  }

  /**
   * List members in a list/audience
   */
  async listMembers(listId: string, params?: {
    count?: number;
    offset?: number;
    status?: 'subscribed' | 'unsubscribed' | 'cleaned' | 'pending' | 'transactional' | 'archived';
    since_last_changed?: string;
  }): Promise<MemberListResponse> {
    return this.client.get<MemberListResponse>(`/lists/${listId}/members`, params);
  }

  /**
   * Get a specific member by email
   */
  async getMember(listId: string, email: string): Promise<Member> {
    const subscriberHash = this.getSubscriberHash(email);
    return this.client.get<Member>(`/lists/${listId}/members/${subscriberHash}`);
  }

  /**
   * Get a specific member by subscriber hash
   */
  async getMemberByHash(listId: string, subscriberHash: string): Promise<Member> {
    return this.client.get<Member>(`/lists/${listId}/members/${subscriberHash}`);
  }

  /**
   * Add a new member to a list
   */
  async addMember(listId: string, params: MemberCreateParams): Promise<Member> {
    return this.client.post<Member>(`/lists/${listId}/members`, params);
  }

  /**
   * Update a member
   */
  async updateMember(listId: string, email: string, params: MemberUpdateParams): Promise<Member> {
    const subscriberHash = this.getSubscriberHash(email);
    return this.client.patch<Member>(`/lists/${listId}/members/${subscriberHash}`, params);
  }

  /**
   * Add or update a member (upsert)
   */
  async setMember(listId: string, email: string, params: MemberCreateParams): Promise<Member> {
    const subscriberHash = this.getSubscriberHash(email);
    return this.client.put<Member>(`/lists/${listId}/members/${subscriberHash}`, params);
  }

  /**
   * Archive a member (soft delete)
   */
  async archiveMember(listId: string, email: string): Promise<void> {
    const subscriberHash = this.getSubscriberHash(email);
    await this.client.delete(`/lists/${listId}/members/${subscriberHash}`);
  }

  /**
   * Permanently delete a member
   */
  async deleteMemberPermanently(listId: string, email: string): Promise<void> {
    const subscriberHash = this.getSubscriberHash(email);
    await this.client.post(`/lists/${listId}/members/${subscriberHash}/actions/delete-permanent`, {});
  }

  // ============================================
  // Tag Methods
  // ============================================

  /**
   * List tags for a list
   */
  async listTags(listId: string, params?: {
    count?: number;
    offset?: number;
  }): Promise<TagListResponse> {
    return this.client.get<TagListResponse>(`/lists/${listId}/tag-search`, params);
  }

  /**
   * Get tags for a member
   */
  async getMemberTags(listId: string, email: string): Promise<{ tags: Tag[] }> {
    const subscriberHash = this.getSubscriberHash(email);
    return this.client.get<{ tags: Tag[] }>(`/lists/${listId}/members/${subscriberHash}/tags`);
  }

  /**
   * Update tags for a member
   */
  async updateMemberTags(listId: string, email: string, tags: Array<{ name: string; status: 'active' | 'inactive' }>): Promise<void> {
    const subscriberHash = this.getSubscriberHash(email);
    await this.client.post(`/lists/${listId}/members/${subscriberHash}/tags`, { tags });
  }

  // ============================================
  // Segment Methods
  // ============================================

  /**
   * List segments for a list
   */
  async listSegments(listId: string, params?: {
    count?: number;
    offset?: number;
    type?: 'saved' | 'static' | 'fuzzy';
  }): Promise<SegmentListResponse> {
    return this.client.get<SegmentListResponse>(`/lists/${listId}/segments`, params);
  }

  /**
   * Get a specific segment
   */
  async getSegment(listId: string, segmentId: number): Promise<Segment> {
    return this.client.get<Segment>(`/lists/${listId}/segments/${segmentId}`);
  }

  /**
   * Create a segment
   */
  async createSegment(listId: string, params: {
    name: string;
    static_segment?: string[];
    options?: {
      match?: 'any' | 'all';
      conditions?: unknown[];
    };
  }): Promise<Segment> {
    return this.client.post<Segment>(`/lists/${listId}/segments`, params);
  }

  /**
   * Update a segment
   */
  async updateSegment(listId: string, segmentId: number, params: {
    name?: string;
    static_segment?: string[];
    options?: {
      match?: 'any' | 'all';
      conditions?: unknown[];
    };
  }): Promise<Segment> {
    return this.client.patch<Segment>(`/lists/${listId}/segments/${segmentId}`, params);
  }

  /**
   * Delete a segment
   */
  async deleteSegment(listId: string, segmentId: number): Promise<void> {
    await this.client.delete(`/lists/${listId}/segments/${segmentId}`);
  }

  // ============================================
  // Campaign Methods
  // ============================================

  /**
   * List campaigns
   */
  async listCampaigns(params?: {
    count?: number;
    offset?: number;
    type?: 'regular' | 'plaintext' | 'absplit' | 'rss' | 'variate';
    status?: 'save' | 'paused' | 'schedule' | 'sending' | 'sent';
    since_send_time?: string;
    before_send_time?: string;
    list_id?: string;
    folder_id?: string;
    sort_field?: 'create_time' | 'send_time';
    sort_dir?: 'ASC' | 'DESC';
  }): Promise<CampaignListResponse> {
    return this.client.get<CampaignListResponse>('/campaigns', params);
  }

  /**
   * Get a specific campaign
   */
  async getCampaign(campaignId: string): Promise<Campaign> {
    return this.client.get<Campaign>(`/campaigns/${campaignId}`);
  }

  /**
   * Create a campaign
   */
  async createCampaign(params: CampaignCreateParams): Promise<Campaign> {
    return this.client.post<Campaign>('/campaigns', params);
  }

  /**
   * Update a campaign
   */
  async updateCampaign(campaignId: string, params: Partial<CampaignCreateParams>): Promise<Campaign> {
    return this.client.patch<Campaign>(`/campaigns/${campaignId}`, params);
  }

  /**
   * Delete a campaign
   */
  async deleteCampaign(campaignId: string): Promise<void> {
    await this.client.delete(`/campaigns/${campaignId}`);
  }

  /**
   * Send a campaign
   */
  async sendCampaign(campaignId: string): Promise<void> {
    await this.client.post(`/campaigns/${campaignId}/actions/send`, {});
  }

  /**
   * Schedule a campaign
   */
  async scheduleCampaign(campaignId: string, scheduleTime: string): Promise<void> {
    await this.client.post(`/campaigns/${campaignId}/actions/schedule`, {
      schedule_time: scheduleTime,
    });
  }

  /**
   * Unschedule a campaign
   */
  async unscheduleCampaign(campaignId: string): Promise<void> {
    await this.client.post(`/campaigns/${campaignId}/actions/unschedule`, {});
  }

  /**
   * Pause an RSS campaign
   */
  async pauseCampaign(campaignId: string): Promise<void> {
    await this.client.post(`/campaigns/${campaignId}/actions/pause`, {});
  }

  /**
   * Resume an RSS campaign
   */
  async resumeCampaign(campaignId: string): Promise<void> {
    await this.client.post(`/campaigns/${campaignId}/actions/resume`, {});
  }

  /**
   * Replicate a campaign
   */
  async replicateCampaign(campaignId: string): Promise<Campaign> {
    return this.client.post<Campaign>(`/campaigns/${campaignId}/actions/replicate`, {});
  }

  /**
   * Get campaign content
   */
  async getCampaignContent(campaignId: string): Promise<{
    plain_text?: string;
    html?: string;
    archive_html?: string;
  }> {
    return this.client.get(`/campaigns/${campaignId}/content`);
  }

  /**
   * Set campaign content
   */
  async setCampaignContent(campaignId: string, content: {
    plain_text?: string;
    html?: string;
    template?: {
      id: number;
      sections?: Record<string, string>;
    };
  }): Promise<void> {
    await this.client.put(`/campaigns/${campaignId}/content`, content);
  }

  // ============================================
  // Template Methods
  // ============================================

  /**
   * List templates
   */
  async listTemplates(params?: {
    count?: number;
    offset?: number;
    type?: 'user' | 'base' | 'gallery';
    folder_id?: string;
    sort_field?: 'date_created' | 'date_edited' | 'name';
    sort_dir?: 'ASC' | 'DESC';
  }): Promise<TemplateListResponse> {
    return this.client.get<TemplateListResponse>('/templates', params);
  }

  /**
   * Get a specific template
   */
  async getTemplate(templateId: number): Promise<Template> {
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
  async updateTemplate(templateId: number, params: Partial<TemplateCreateParams>): Promise<Template> {
    return this.client.patch<Template>(`/templates/${templateId}`, params);
  }

  /**
   * Delete a template
   */
  async deleteTemplate(templateId: number): Promise<void> {
    await this.client.delete(`/templates/${templateId}`);
  }

  /**
   * Get template default content
   */
  async getTemplateContent(templateId: number): Promise<{ html: string; sections: Record<string, string> }> {
    return this.client.get(`/templates/${templateId}/default-content`);
  }

  // ============================================
  // Report Methods
  // ============================================

  /**
   * List campaign reports
   */
  async listReports(params?: {
    count?: number;
    offset?: number;
    type?: 'regular' | 'plaintext' | 'absplit' | 'rss' | 'variate';
    since_send_time?: string;
    before_send_time?: string;
  }): Promise<ReportListResponse> {
    return this.client.get<ReportListResponse>('/reports', params);
  }

  /**
   * Get a specific campaign report
   */
  async getReport(campaignId: string): Promise<Report> {
    return this.client.get<Report>(`/reports/${campaignId}`);
  }

  /**
   * Get campaign abuse reports
   */
  async getAbuseReports(campaignId: string, params?: {
    count?: number;
    offset?: number;
  }): Promise<{
    abuse_reports: Array<{
      id: number;
      campaign_id: string;
      list_id: string;
      list_is_active: boolean;
      email_id: string;
      email_address: string;
      date: string;
    }>;
    campaign_id: string;
    total_items: number;
  }> {
    return this.client.get(`/reports/${campaignId}/abuse-reports`, params);
  }

  /**
   * Get campaign click details
   */
  async getClickDetails(campaignId: string, params?: {
    count?: number;
    offset?: number;
  }): Promise<{
    urls_clicked: Array<{
      id: string;
      url: string;
      total_clicks: number;
      click_percentage: number;
      unique_clicks: number;
      unique_click_percentage: number;
      last_click: string;
    }>;
    campaign_id: string;
    total_items: number;
  }> {
    return this.client.get(`/reports/${campaignId}/click-details`, params);
  }

  /**
   * Get campaign open details
   */
  async getOpenDetails(campaignId: string, params?: {
    count?: number;
    offset?: number;
    since?: string;
  }): Promise<{
    members: Array<{
      campaign_id: string;
      list_id: string;
      list_is_active: boolean;
      contact_status: string;
      email_id: string;
      email_address: string;
      opens_count: number;
      opens: Array<{ timestamp: string }>;
    }>;
    campaign_id: string;
    total_items: number;
  }> {
    return this.client.get(`/reports/${campaignId}/open-details`, params);
  }

  /**
   * Get campaign unsubscribe details
   */
  async getUnsubscribes(campaignId: string, params?: {
    count?: number;
    offset?: number;
  }): Promise<{
    unsubscribes: Array<{
      email_id: string;
      email_address: string;
      timestamp: string;
      reason?: string;
      campaign_id: string;
      list_id: string;
      list_is_active: boolean;
    }>;
    campaign_id: string;
    total_items: number;
  }> {
    return this.client.get(`/reports/${campaignId}/unsubscribed`, params);
  }

  /**
   * Get campaign sent-to details
   */
  async getSentTo(campaignId: string, params?: {
    count?: number;
    offset?: number;
  }): Promise<{
    sent_to: Array<{
      email_id: string;
      email_address: string;
      status: string;
      open_count: number;
      last_open?: string;
      campaign_id: string;
      list_id: string;
      list_is_active: boolean;
    }>;
    campaign_id: string;
    total_items: number;
  }> {
    return this.client.get(`/reports/${campaignId}/sent-to`, params);
  }
}
