import type { ResendClient } from './client';
import type {
  SendEmailParams,
  SendEmailResponse,
  BatchEmailParams,
  BatchEmailResponse,
  Email,
  UpdateEmailParams,
  ListResponse,
} from '../types';

/**
 * Emails API - Send, retrieve, update, and cancel emails
 * https://resend.com/docs/api-reference/emails
 */
export class EmailsApi {
  constructor(private readonly client: ResendClient) {}

  /**
   * Send a single email
   * POST /emails
   */
  async send(params: SendEmailParams): Promise<SendEmailResponse> {
    return this.client.post<SendEmailResponse>('/emails', params);
  }

  /**
   * Send multiple emails in a batch (up to 100)
   * POST /emails/batch
   */
  async sendBatch(params: BatchEmailParams): Promise<BatchEmailResponse> {
    return this.client.post<BatchEmailResponse>('/emails/batch', params.emails);
  }

  /**
   * List all emails
   * GET /emails
   */
  async list(): Promise<ListResponse<Email>> {
    return this.client.get<ListResponse<Email>>('/emails');
  }

  /**
   * Get a single email by ID
   * GET /emails/:id
   */
  async get(emailId: string): Promise<Email> {
    return this.client.get<Email>(`/emails/${emailId}`);
  }

  /**
   * Update a scheduled email (can only update scheduled_at)
   * PATCH /emails/:id
   */
  async update(emailId: string, params: UpdateEmailParams): Promise<Email> {
    return this.client.patch<Email>(`/emails/${emailId}`, params);
  }

  /**
   * Cancel a scheduled email
   * POST /emails/:id/cancel
   */
  async cancel(emailId: string): Promise<{ id: string; object: 'email'; canceled: boolean }> {
    return this.client.post<{ id: string; object: 'email'; canceled: boolean }>(`/emails/${emailId}/cancel`);
  }
}
