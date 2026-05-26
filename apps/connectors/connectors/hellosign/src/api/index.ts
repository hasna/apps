import type {
  HelloSignConfig,
  SignatureRequest,
  SignatureRequestListResponse,
  CreateSignatureRequestOptions,
  CreateFromTemplateOptions,
  Template,
  TemplateListResponse,
  Account,
  Team,
} from '../types';
import { HelloSignClient } from './client';

/**
 * HelloSign (Dropbox Sign) API Client
 * Electronic signature API with templates and teams
 */
export class HelloSign {
  private readonly client: HelloSignClient;

  constructor(config: HelloSignConfig) {
    this.client = new HelloSignClient(config);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): HelloSign {
    const apiKey = process.env.HELLOSIGN_API_KEY;

    if (!apiKey) {
      throw new Error('HELLOSIGN_API_KEY environment variable is required');
    }
    return new HelloSign({ apiKey });
  }

  // ============================================
  // Signature Request Methods
  // ============================================

  /**
   * List signature requests
   */
  async listSignatureRequests(options?: {
    page?: number;
    page_size?: number;
    account_id?: string;
    query?: string;
  }): Promise<SignatureRequestListResponse> {
    const params: Record<string, string | number | undefined> = {
      page: options?.page,
      page_size: options?.page_size,
      account_id: options?.account_id,
      query: options?.query,
    };
    return this.client.get<SignatureRequestListResponse>('/signature_request/list', params);
  }

  /**
   * Get a signature request by ID
   */
  async getSignatureRequest(signatureRequestId: string): Promise<{ signature_request: SignatureRequest }> {
    return this.client.get<{ signature_request: SignatureRequest }>(`/signature_request/${signatureRequestId}`);
  }

  /**
   * Send a signature request
   */
  async sendSignatureRequest(options: CreateSignatureRequestOptions): Promise<{ signature_request: SignatureRequest }> {
    return this.client.post<{ signature_request: SignatureRequest }>('/signature_request/send', options as unknown as Record<string, unknown>);
  }

  /**
   * Send a signature request from template
   */
  async sendFromTemplate(options: CreateFromTemplateOptions): Promise<{ signature_request: SignatureRequest }> {
    return this.client.post<{ signature_request: SignatureRequest }>('/signature_request/send_with_template', options as unknown as Record<string, unknown>);
  }

  /**
   * Send a reminder for a signature request
   */
  async sendReminder(signatureRequestId: string, emailAddress: string): Promise<{ signature_request: SignatureRequest }> {
    return this.client.post<{ signature_request: SignatureRequest }>(`/signature_request/remind/${signatureRequestId}`, {
      email_address: emailAddress,
    });
  }

  /**
   * Cancel a signature request
   */
  async cancelSignatureRequest(signatureRequestId: string): Promise<void> {
    await this.client.post<void>(`/signature_request/cancel/${signatureRequestId}`);
  }

  /**
   * Download files for a signature request
   */
  async getSignatureRequestFiles(signatureRequestId: string, fileType?: 'pdf' | 'zip'): Promise<string> {
    return this.client.get<string>(`/signature_request/files/${signatureRequestId}`, {
      file_type: fileType,
    });
  }

  // ============================================
  // Template Methods
  // ============================================

  /**
   * List templates
   */
  async listTemplates(options?: {
    page?: number;
    page_size?: number;
    account_id?: string;
    query?: string;
  }): Promise<TemplateListResponse> {
    const params: Record<string, string | number | undefined> = {
      page: options?.page,
      page_size: options?.page_size,
      account_id: options?.account_id,
      query: options?.query,
    };
    return this.client.get<TemplateListResponse>('/template/list', params);
  }

  /**
   * Get a template by ID
   */
  async getTemplate(templateId: string): Promise<{ template: Template }> {
    return this.client.get<{ template: Template }>(`/template/${templateId}`);
  }

  /**
   * Delete a template
   */
  async deleteTemplate(templateId: string): Promise<void> {
    await this.client.post<void>(`/template/delete/${templateId}`);
  }

  // ============================================
  // Account Methods
  // ============================================

  /**
   * Get current account details
   */
  async getAccount(): Promise<{ account: Account }> {
    return this.client.get<{ account: Account }>('/account');
  }

  /**
   * Update account callback URL
   */
  async updateAccount(callbackUrl?: string): Promise<{ account: Account }> {
    return this.client.post<{ account: Account }>('/account', {
      callback_url: callbackUrl,
    });
  }

  /**
   * Verify account exists
   */
  async verifyAccount(emailAddress: string): Promise<{ account: Account }> {
    return this.client.post<{ account: Account }>('/account/verify', {
      email_address: emailAddress,
    });
  }

  // ============================================
  // Team Methods
  // ============================================

  /**
   * Get team details
   */
  async getTeam(): Promise<{ team: Team }> {
    return this.client.get<{ team: Team }>('/team');
  }

  /**
   * Create a team
   */
  async createTeam(name: string): Promise<{ team: Team }> {
    return this.client.post<{ team: Team }>('/team/create', { name });
  }

  /**
   * Update team name
   */
  async updateTeam(name: string): Promise<{ team: Team }> {
    return this.client.post<{ team: Team }>('/team', { name });
  }

  /**
   * Delete team
   */
  async deleteTeam(): Promise<void> {
    await this.client.post<void>('/team/destroy');
  }

  /**
   * Add member to team
   */
  async addTeamMember(options: { email_address?: string; account_id?: string }): Promise<{ team: Team }> {
    return this.client.post<{ team: Team }>('/team/add_member', options);
  }

  /**
   * Remove member from team
   */
  async removeTeamMember(options: { email_address?: string; account_id?: string }): Promise<{ team: Team }> {
    return this.client.post<{ team: Team }>('/team/remove_member', options);
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get a preview of the API key
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): HelloSignClient {
    return this.client;
  }
}

export { HelloSignClient } from './client';
