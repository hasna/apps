import type {
  YousignConfig,
  PaginatedResponse,
  SignatureRequest,
  Signer,
  Document,
  Field,
  Template,
  Webhook,
  User,
  ConsentRequest,
  ListSignatureRequestsOptions,
  CreateSignatureRequestOptions,
  UpdateSignatureRequestOptions,
  AddSignerOptions,
  UpdateSignerOptions,
  AddFieldOptions,
  CreateWebhookOptions,
  DocumentVersion,
} from '../types';
import { YousignClient } from './client';

/**
 * Yousign API v3 client for electronic signatures.
 */
export class Yousign {
  private readonly client: YousignClient;

  constructor(config: YousignConfig) {
    this.client = new YousignClient(config);
  }

  static fromEnv(): Yousign {
    const apiKey = process.env.YOUSIGN_API_KEY;
    if (!apiKey) {
      throw new Error('YOUSIGN_API_KEY environment variable is required');
    }
    const environment = (process.env.YOUSIGN_ENVIRONMENT as YousignConfig['environment']) ?? 'production';
    return new Yousign({ apiKey, environment });
  }

  // Signature requests

  async listSignatureRequests(options: ListSignatureRequestsOptions = {}): Promise<PaginatedResponse<SignatureRequest>> {
    return this.client.get('/signature_requests', {
      limit: options.limit,
      after: options.after,
      status: options.status,
      'created_at[from]': options.from,
      'created_at[to]': options.to,
      q: options.search,
    });
  }

  async getSignatureRequest(id: string): Promise<SignatureRequest> {
    return this.client.get(`/signature_requests/${encodeURIComponent(id)}`);
  }

  async createSignatureRequest(options: CreateSignatureRequestOptions): Promise<SignatureRequest> {
    return this.client.post('/signature_requests', options as unknown as Record<string, unknown>);
  }

  async updateSignatureRequest(id: string, options: UpdateSignatureRequestOptions): Promise<SignatureRequest> {
    return this.client.patch(`/signature_requests/${encodeURIComponent(id)}`, options as Record<string, unknown>);
  }

  async deleteSignatureRequest(id: string): Promise<void> {
    await this.client.delete(`/signature_requests/${encodeURIComponent(id)}`);
  }

  async activateSignatureRequest(id: string): Promise<SignatureRequest> {
    return this.client.post(`/signature_requests/${encodeURIComponent(id)}/activate`);
  }

  async cancelSignatureRequest(id: string, reason?: string): Promise<SignatureRequest> {
    return this.client.post(`/signature_requests/${encodeURIComponent(id)}/cancel`, reason ? { reason } : undefined);
  }

  async getAuditTrails(id: string): Promise<unknown> {
    return this.client.get(`/signature_requests/${encodeURIComponent(id)}/audit_trails`);
  }

  async sendReminder(signatureRequestId: string, signerIds?: string[]): Promise<unknown> {
    return this.client.post(`/signature_requests/${encodeURIComponent(signatureRequestId)}/reminders`, {
      signer_ids: signerIds,
    });
  }

  // Signers

  async listSigners(signatureRequestId: string): Promise<PaginatedResponse<Signer>> {
    return this.client.get(`/signature_requests/${encodeURIComponent(signatureRequestId)}/signers`);
  }

  async getSigner(signatureRequestId: string, signerId: string): Promise<Signer> {
    return this.client.get(
      `/signature_requests/${encodeURIComponent(signatureRequestId)}/signers/${encodeURIComponent(signerId)}`,
    );
  }

  async addSigner(signatureRequestId: string, options: AddSignerOptions): Promise<Signer> {
    return this.client.post(
      `/signature_requests/${encodeURIComponent(signatureRequestId)}/signers`,
      options as unknown as Record<string, unknown>,
    );
  }

  async updateSigner(signatureRequestId: string, signerId: string, options: UpdateSignerOptions): Promise<Signer> {
    return this.client.patch(
      `/signature_requests/${encodeURIComponent(signatureRequestId)}/signers/${encodeURIComponent(signerId)}`,
      options as Record<string, unknown>,
    );
  }

  async deleteSigner(signatureRequestId: string, signerId: string): Promise<void> {
    await this.client.delete(
      `/signature_requests/${encodeURIComponent(signatureRequestId)}/signers/${encodeURIComponent(signerId)}`,
    );
  }

  // Documents

  async listDocuments(signatureRequestId: string): Promise<PaginatedResponse<Document>> {
    return this.client.get(`/signature_requests/${encodeURIComponent(signatureRequestId)}/documents`);
  }

  async getDocument(signatureRequestId: string, documentId: string): Promise<Document> {
    return this.client.get(
      `/signature_requests/${encodeURIComponent(signatureRequestId)}/documents/${encodeURIComponent(documentId)}`,
    );
  }

  async deleteDocument(signatureRequestId: string, documentId: string): Promise<void> {
    await this.client.delete(
      `/signature_requests/${encodeURIComponent(signatureRequestId)}/documents/${encodeURIComponent(documentId)}`,
    );
  }

  async downloadDocument(
    signatureRequestId: string,
    documentId: string,
    version?: DocumentVersion,
  ): Promise<unknown> {
    return this.client.get(
      `/signature_requests/${encodeURIComponent(signatureRequestId)}/documents/${encodeURIComponent(documentId)}/download`,
      { version },
    );
  }

  // Fields

  async listFields(signatureRequestId: string, documentId: string): Promise<PaginatedResponse<Field>> {
    return this.client.get(
      `/signature_requests/${encodeURIComponent(signatureRequestId)}/documents/${encodeURIComponent(documentId)}/fields`,
    );
  }

  async addField(signatureRequestId: string, documentId: string, options: AddFieldOptions): Promise<Field> {
    return this.client.post(
      `/signature_requests/${encodeURIComponent(signatureRequestId)}/documents/${encodeURIComponent(documentId)}/fields`,
      options as unknown as Record<string, unknown>,
    );
  }

  async deleteField(signatureRequestId: string, documentId: string, fieldId: string): Promise<void> {
    await this.client.delete(
      `/signature_requests/${encodeURIComponent(signatureRequestId)}/documents/${encodeURIComponent(documentId)}/fields/${encodeURIComponent(fieldId)}`,
    );
  }

  // Templates

  async listTemplates(options: { limit?: number; after?: string; q?: string } = {}): Promise<PaginatedResponse<Template>> {
    return this.client.get('/templates', options);
  }

  async getTemplate(id: string): Promise<Template> {
    return this.client.get(`/templates/${encodeURIComponent(id)}`);
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.client.delete(`/templates/${encodeURIComponent(id)}`);
  }

  // Webhooks

  async listWebhooks(): Promise<PaginatedResponse<Webhook>> {
    return this.client.get('/webhooks');
  }

  async createWebhook(options: CreateWebhookOptions): Promise<Webhook> {
    return this.client.post('/webhooks', options as unknown as Record<string, unknown>);
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.client.delete(`/webhooks/${encodeURIComponent(id)}`);
  }

  // Users

  async listUsers(options: { limit?: number; after?: string } = {}): Promise<PaginatedResponse<User>> {
    return this.client.get('/users', options);
  }

  // Consent requests

  async listConsentRequests(options: { limit?: number; after?: string } = {}): Promise<PaginatedResponse<ConsentRequest>> {
    return this.client.get('/consent_requests', options);
  }

  getClient(): YousignClient {
    return this.client;
  }
}

export { YousignClient } from './client';
