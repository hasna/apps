// Signaturit Connector — Electronic signature and digital contract management
import { SignaturitClient } from './client';
import type { SignaturitConfig, SGSignature, SGSignatureRequest, SGTemplate, SGCertifiedEmail } from '../types';
export { SignaturitClient } from './client';

export class Signaturit {
  private readonly client: SignaturitClient;
  constructor(config: SignaturitConfig) { this.client = new SignaturitClient(config); }
  static fromEnv(): Signaturit {
    const token = process.env.SIGNATURIT_TOKEN;
    if (!token) throw new Error('SIGNATURIT_TOKEN is required');
    return new Signaturit({ token, sandbox: process.env.SIGNATURIT_SANDBOX === 'true' });
  }

  async listSignatures(options?: { page?: number; per_page?: number; status?: string }): Promise<SGSignature[]> {
    return this.client.request<SGSignature[]>('/signatures.json', { params: { page: options?.page, per_page: options?.per_page, status: options?.status } });
  }
  async getSignature(signatureId: string): Promise<SGSignature> { return this.client.request<SGSignature>(`/signatures/${signatureId}.json`); }
  async createSignature(data: { recipients: { name: string; email: string; phone?: string }[]; subject?: string; body?: string; template_id?: string }): Promise<SGSignatureRequest> {
    return this.client.request<SGSignatureRequest>('/signatures.json', { method: 'POST', body: data as Record<string, unknown> });
  }
  async cancelSignature(signatureId: string): Promise<void> { await this.client.request(`/signatures/${signatureId}/cancel.json`, { method: 'PATCH' }); }
  async sendReminder(signatureId: string): Promise<void> { await this.client.request(`/signatures/${signatureId}/reminder.json`, { method: 'POST' }); }

  async downloadSignedDocument(signatureId: string, documentId: string): Promise<{ url: string }> {
    return this.client.request(`/signatures/${signatureId}/documents/${documentId}/download/signed`);
  }

  async listTemplates(): Promise<SGTemplate[]> { return this.client.request<SGTemplate[]>('/templates.json'); }

  async listCertifiedEmails(options?: { page?: number }): Promise<SGCertifiedEmail[]> {
    return this.client.request<SGCertifiedEmail[]>('/emails.json', { params: { page: options?.page } });
  }
  async sendCertifiedEmail(data: { recipients: { name: string; email: string }[]; subject: string; body: string }): Promise<SGCertifiedEmail> {
    return this.client.request<SGCertifiedEmail>('/emails.json', { method: 'POST', body: data as Record<string, unknown> });
  }

  getClient(): SignaturitClient { return this.client; }
}
