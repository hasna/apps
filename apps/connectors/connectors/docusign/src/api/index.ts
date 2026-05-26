import type {
  DocuSignConfig,
  Envelope,
  EnvelopesListResponse,
  EnvelopeResponse,
  CreateEnvelopeOptions,
  TemplatesListResponse,
  Template,
  UserInfo,
} from '../types';
import { DocuSignClient } from './client';

/**
 * DocuSign API Client
 * Electronic signature API with envelope management
 */
export class DocuSign {
  private readonly client: DocuSignClient;

  constructor(config: DocuSignConfig) {
    this.client = new DocuSignClient(config);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): DocuSign {
    const accessToken = process.env.DOCUSIGN_ACCESS_TOKEN;
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
    const baseUrl = process.env.DOCUSIGN_BASE_URL;

    if (!accessToken) {
      throw new Error('DOCUSIGN_ACCESS_TOKEN environment variable is required');
    }
    if (!accountId) {
      throw new Error('DOCUSIGN_ACCOUNT_ID environment variable is required');
    }
    return new DocuSign({ accessToken, accountId, baseUrl });
  }

  // ============================================
  // Envelope Methods
  // ============================================

  /**
   * List envelopes
   */
  async listEnvelopes(options?: {
    from_date?: string;
    to_date?: string;
    status?: string;
    count?: number;
  }): Promise<EnvelopesListResponse> {
    const params: Record<string, string | number | undefined> = {
      from_date: options?.from_date,
      to_date: options?.to_date,
      status: options?.status,
      count: options?.count,
    };
    return this.client.get<EnvelopesListResponse>('/accounts/{accountId}/envelopes', params);
  }

  /**
   * Get an envelope by ID
   */
  async getEnvelope(envelopeId: string): Promise<Envelope> {
    return this.client.get<Envelope>(`/accounts/{accountId}/envelopes/${envelopeId}`);
  }

  /**
   * Create an envelope
   */
  async createEnvelope(options: CreateEnvelopeOptions): Promise<EnvelopeResponse> {
    return this.client.post<EnvelopeResponse>('/accounts/{accountId}/envelopes', {
      emailSubject: options.emailSubject,
      emailBlurb: options.emailBlurb,
      documents: options.documents,
      recipients: options.recipients,
      status: options.status || 'created',
    });
  }

  /**
   * Send an envelope (change status to 'sent')
   */
  async sendEnvelope(envelopeId: string): Promise<EnvelopeResponse> {
    return this.client.put<EnvelopeResponse>(`/accounts/{accountId}/envelopes/${envelopeId}`, {
      status: 'sent',
    });
  }

  /**
   * Void an envelope
   */
  async voidEnvelope(envelopeId: string, voidedReason: string): Promise<EnvelopeResponse> {
    return this.client.put<EnvelopeResponse>(`/accounts/{accountId}/envelopes/${envelopeId}`, {
      status: 'voided',
      voidedReason,
    });
  }

  // ============================================
  // Template Methods
  // ============================================

  /**
   * List templates
   */
  async listTemplates(options?: {
    count?: number;
    start_position?: number;
    search_text?: string;
  }): Promise<TemplatesListResponse> {
    const params: Record<string, string | number | undefined> = {
      count: options?.count,
      start_position: options?.start_position,
      search_text: options?.search_text,
    };
    return this.client.get<TemplatesListResponse>('/accounts/{accountId}/templates', params);
  }

  /**
   * Get a template by ID
   */
  async getTemplate(templateId: string): Promise<Template> {
    return this.client.get<Template>(`/accounts/{accountId}/templates/${templateId}`);
  }

  /**
   * Create envelope from template
   */
  async createEnvelopeFromTemplate(options: {
    templateId: string;
    emailSubject?: string;
    emailBlurb?: string;
    status?: 'created' | 'sent';
    templateRoles?: Array<{
      email: string;
      name: string;
      roleName: string;
    }>;
  }): Promise<EnvelopeResponse> {
    return this.client.post<EnvelopeResponse>('/accounts/{accountId}/envelopes', {
      templateId: options.templateId,
      emailSubject: options.emailSubject,
      emailBlurb: options.emailBlurb,
      status: options.status || 'created',
      templateRoles: options.templateRoles,
    });
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get a preview of the access token
   */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /**
   * Get the account ID
   */
  getAccountId(): string {
    return this.client.getAccountId();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): DocuSignClient {
    return this.client;
  }
}

export { DocuSignClient } from './client';
