import { SparkPostClient } from './client';
import type {
  SparkPostConfig,
  SendTransmissionParams,
  SendTransmissionResponse,
  Transmission,
  TransmissionListResponse,
  Template,
  TemplateListResponse,
  CreateTemplateParams,
  TemplateContent,
  SendingDomain,
  SendingDomainListResponse,
  CreateSendingDomainParams,
  SuppressionEntry,
  SuppressionListResponse,
  Webhook,
  WebhookListResponse,
  CreateWebhookParams,
  RecipientList,
  RecipientListListResponse,
  IpPool,
  IpPoolListResponse,
  Account,
  Subaccount,
  SubaccountListResponse,
  InboundDomain,
  InboundDomainListResponse,
  RecipientValidationResponse,
} from '../types';

export { SparkPostClient };

/**
 * SparkPost API wrapper
 */
export class SparkPost {
  private client: SparkPostClient;

  constructor(config: SparkPostConfig) {
    this.client = new SparkPostClient(config);
  }

  getClient(): SparkPostClient {
    return this.client;
  }

  // ============================================
  // Transmissions
  // ============================================

  async sendTransmission(params: SendTransmissionParams): Promise<SendTransmissionResponse> {
    return this.client.post<SendTransmissionResponse>('/transmissions', params);
  }

  async sendSimpleEmail(options: {
    to: string | string[];
    from: string;
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string;
    sandbox?: boolean;
  }): Promise<SendTransmissionResponse> {
    const recipients = (Array.isArray(options.to) ? options.to : [options.to]).map((address) => ({
      address,
    }));

    return this.sendTransmission({
      recipients,
      content: {
        from: options.from,
        subject: options.subject,
        text: options.text,
        html: options.html,
        reply_to: options.replyTo,
      },
      options: options.sandbox ? { sandbox: true } : undefined,
    });
  }

  async listTransmissions(params?: { from?: string; to?: string; campaigns?: string }): Promise<TransmissionListResponse> {
    return this.client.get<TransmissionListResponse>('/transmissions', params);
  }

  async getTransmission(id: string): Promise<{ results: Transmission }> {
    return this.client.get<{ results: Transmission }>(`/transmissions/${id}`);
  }

  async deleteTransmission(id: string): Promise<void> {
    await this.client.delete(`/transmissions/${id}`);
  }

  // ============================================
  // Templates
  // ============================================

  async listTemplates(params?: { draft?: boolean; shared_with_subaccounts?: boolean }): Promise<TemplateListResponse> {
    return this.client.get<TemplateListResponse>('/templates', params);
  }

  async getTemplate(id: string, draft?: boolean): Promise<{ results: Template }> {
    return this.client.get<{ results: Template }>(`/templates/${id}`, { draft });
  }

  async createTemplate(params: CreateTemplateParams): Promise<{ results: Template }> {
    return this.client.post<{ results: Template }>('/templates', params);
  }

  async updateTemplate(id: string, params: Partial<CreateTemplateParams>, updatePublished?: boolean): Promise<{ results: Template }> {
    return this.client.put<{ results: Template }>(`/templates/${id}`, params, {
      update_published: updatePublished,
    });
  }

  async publishTemplate(id: string): Promise<{ results: Template }> {
    return this.client.put<{ results: Template }>(`/templates/${id}`, { published: true });
  }

  async previewTemplate(id: string, substitutionData?: Record<string, unknown>, draft?: boolean): Promise<unknown> {
    return this.client.post(`/templates/${id}/preview`, {
      substitution_data: substitutionData ?? {},
    }, { draft });
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.client.delete(`/templates/${id}`);
  }

  async previewInlineContent(content: TemplateContent, substitutionData?: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/utils/content-previewer', {
      content,
      substitution_data: substitutionData ?? {},
    });
  }

  // ============================================
  // Sending Domains
  // ============================================

  async listSendingDomains(params?: Record<string, string | boolean | undefined>): Promise<SendingDomainListResponse> {
    return this.client.get<SendingDomainListResponse>('/sending-domains', params);
  }

  async getSendingDomain(domain: string): Promise<{ results: SendingDomain }> {
    return this.client.get<{ results: SendingDomain }>(`/sending-domains/${domain}`);
  }

  async createSendingDomain(params: CreateSendingDomainParams): Promise<{ results: SendingDomain }> {
    return this.client.post<{ results: SendingDomain }>('/sending-domains', params);
  }

  async updateSendingDomain(domain: string, params: Partial<CreateSendingDomainParams>): Promise<{ results: SendingDomain }> {
    return this.client.put<{ results: SendingDomain }>(`/sending-domains/${domain}`, params);
  }

  async verifySendingDomain(domain: string, options?: { dkim_verify?: boolean; cname_verify?: boolean }): Promise<unknown> {
    return this.client.post(`/sending-domains/${domain}/verify`, options ?? {});
  }

  async deleteSendingDomain(domain: string): Promise<void> {
    await this.client.delete(`/sending-domains/${domain}`);
  }

  // ============================================
  // Suppression List
  // ============================================

  async listSuppressions(params?: { from?: string; to?: string; types?: string; limit?: number }): Promise<SuppressionListResponse> {
    return this.client.get<SuppressionListResponse>('/suppression-list', params);
  }

  async getSuppression(email: string): Promise<{ results: SuppressionEntry }> {
    return this.client.get<{ results: SuppressionEntry }>(`/suppression-list/${encodeURIComponent(email)}`);
  }

  async addSuppression(entries: Array<{ recipient: string; type?: string; description?: string }>): Promise<unknown> {
    return this.client.post('/suppression-list', entries);
  }

  async deleteSuppression(email: string): Promise<void> {
    await this.client.delete(`/suppression-list/${encodeURIComponent(email)}`);
  }

  // ============================================
  // Metrics
  // ============================================

  async getMetrics(params?: { from?: string; to?: string; metrics?: string; domains?: string }): Promise<unknown> {
    return this.client.get('/metrics/deliverability', params);
  }

  async getDomainMetrics(domain: string, params?: { from?: string; to?: string; metrics?: string }): Promise<unknown> {
    return this.client.get(`/metrics/deliverability/domains/${domain}`, params);
  }

  // ============================================
  // Events
  // ============================================

  async listEvents(params?: {
    from?: string;
    to?: string;
    events?: string;
    campaigns?: string;
    template_ids?: string;
    bounce_classes?: string;
    per_page?: number;
    page?: number;
  }): Promise<unknown> {
    return this.client.get('/events/message', params);
  }

  // ============================================
  // Webhooks
  // ============================================

  async listWebhooks(): Promise<WebhookListResponse> {
    return this.client.get<WebhookListResponse>('/webhooks');
  }

  async getWebhook(id: string): Promise<{ results: Webhook }> {
    return this.client.get<{ results: Webhook }>(`/webhooks/${id}`);
  }

  async createWebhook(params: CreateWebhookParams): Promise<{ results: Webhook }> {
    return this.client.post<{ results: Webhook }>('/webhooks', params);
  }

  async updateWebhook(id: string, params: Partial<CreateWebhookParams>): Promise<{ results: Webhook }> {
    return this.client.put<{ results: Webhook }>(`/webhooks/${id}`, params);
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.client.delete(`/webhooks/${id}`);
  }

  // ============================================
  // Recipient Lists
  // ============================================

  async listRecipientLists(): Promise<RecipientListListResponse> {
    return this.client.get<RecipientListListResponse>('/recipient-lists');
  }

  async getRecipientList(id: string): Promise<{ results: RecipientList }> {
    return this.client.get<{ results: RecipientList }>(`/recipient-lists/${id}`);
  }

  async createRecipientList(id: string, params?: { name?: string; description?: string }): Promise<{ results: RecipientList }> {
    return this.client.post<{ results: RecipientList }>('/recipient-lists', { id, ...params });
  }

  async updateRecipientList(id: string, params: { name?: string; description?: string }): Promise<{ results: RecipientList }> {
    return this.client.put<{ results: RecipientList }>(`/recipient-lists/${id}`, params);
  }

  async deleteRecipientList(id: string): Promise<void> {
    await this.client.delete(`/recipient-lists/${id}`);
  }

  // ============================================
  // IP Pools
  // ============================================

  async listIpPools(): Promise<IpPoolListResponse> {
    return this.client.get<IpPoolListResponse>('/ip-pools');
  }

  async getIpPool(id: string): Promise<{ results: IpPool }> {
    return this.client.get<{ results: IpPool }>(`/ip-pools/${id}`);
  }

  async createIpPool(id: string, name: string, ips?: string[]): Promise<{ results: IpPool }> {
    return this.client.post<{ results: IpPool }>('/ip-pools', { id, name, ips });
  }

  async updateIpPool(id: string, params: { name?: string; ips?: string[] }): Promise<{ results: IpPool }> {
    return this.client.put<{ results: IpPool }>(`/ip-pools/${id}`, params);
  }

  async deleteIpPool(id: string): Promise<void> {
    await this.client.delete(`/ip-pools/${id}`);
  }

  // ============================================
  // Sending IPs
  // ============================================

  async listSendingIps(): Promise<unknown> {
    return this.client.get('/sending-ips');
  }

  // ============================================
  // Account & Subaccounts
  // ============================================

  async getAccount(): Promise<{ results: Account }> {
    return this.client.get<{ results: Account }>('/account');
  }

  async listSubaccounts(): Promise<SubaccountListResponse> {
    return this.client.get<SubaccountListResponse>('/subaccounts');
  }

  async getSubaccount(id: number): Promise<{ results: Subaccount }> {
    return this.client.get<{ results: Subaccount }>(`/subaccounts/${id}`);
  }

  async createSubaccount(name: string, options?: { ip_pool?: string; setup_api_key?: boolean }): Promise<{ results: Subaccount }> {
    return this.client.post<{ results: Subaccount }>('/subaccounts', { name, ...options });
  }

  async updateSubaccount(id: number, params: { name?: string; status?: string; ip_pool?: string }): Promise<{ results: Subaccount }> {
    return this.client.put<{ results: Subaccount }>(`/subaccounts/${id}`, params);
  }

  async deleteSubaccount(id: number): Promise<void> {
    await this.client.delete(`/subaccounts/${id}`);
  }

  // ============================================
  // Recipient Validation
  // ============================================

  async validateRecipient(email: string): Promise<RecipientValidationResponse> {
    return this.client.post<RecipientValidationResponse>('/recipient-validation/single', { email });
  }

  async validateRecipientsBulk(emails: string[]): Promise<unknown> {
    return this.client.post('/recipient-validation/bulk', { emails });
  }

  // ============================================
  // Inbound Domains
  // ============================================

  async listInboundDomains(): Promise<InboundDomainListResponse> {
    return this.client.get<InboundDomainListResponse>('/inbound-domains');
  }

  async getInboundDomain(domain: string): Promise<{ results: InboundDomain }> {
    return this.client.get<{ results: InboundDomain }>(`/inbound-domains/${domain}`);
  }

  async createInboundDomain(domain: string): Promise<{ results: InboundDomain }> {
    return this.client.post<{ results: InboundDomain }>('/inbound-domains', { domain });
  }

  async deleteInboundDomain(domain: string): Promise<void> {
    await this.client.delete(`/inbound-domains/${domain}`);
  }
}
