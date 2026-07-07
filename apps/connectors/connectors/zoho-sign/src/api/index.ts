import type {
  ZohoSignConfig,
  ZohoSignRequest,
  ZohoSignTemplate,
  ZohoSignFolder,
  ZohoSignUser,
  ZohoSignWebhook,
  ZohoSignAccount,
  ZohoSignFieldType,
  ZohoSignTag,
  ZohoSignApiResponse,
} from '../types';
import { ZohoSignClient } from './client';

export { ZohoSignClient, resolveZohoSignBaseUrl, DATA_CENTER_HOSTS } from './client';

/**
 * Zoho Sign API client for electronic signature workflows.
 */
export class ZohoSign {
  private readonly client: ZohoSignClient;

  constructor(config: ZohoSignConfig) {
    this.client = new ZohoSignClient(config);
  }

  static fromEnv(): ZohoSign {
    const token = process.env.ZOHO_SIGN_TOKEN;
    if (!token) {
      throw new Error('ZOHO_SIGN_TOKEN environment variable is required');
    }
    return new ZohoSign({
      token,
      dataCenter: process.env.ZOHO_SIGN_DATA_CENTER,
      baseUrl: process.env.ZOHO_SIGN_BASE_URL,
    });
  }

  // ============================================
  // Document requests
  // ============================================

  async listRequests(options?: {
    row_count?: number;
    start_index?: number;
    sort_column?: string;
    sort_order?: 'ASC' | 'DESC';
    data?: string;
  }): Promise<ZohoSignApiResponse<ZohoSignRequest[]>> {
    return this.client.get('/requests', options);
  }

  async getRequest(requestId: string): Promise<ZohoSignApiResponse<ZohoSignRequest>> {
    return this.client.get(`/requests/${requestId}`);
  }

  async createRequest(body: Record<string, unknown>): Promise<ZohoSignApiResponse<ZohoSignRequest>> {
    return this.client.post('/requests', body);
  }

  async sendRequest(requestId: string, body?: Record<string, unknown>): Promise<ZohoSignApiResponse<ZohoSignRequest>> {
    return this.client.post(`/requests/${requestId}/submit`, body ?? {});
  }

  async deleteRequest(requestId: string): Promise<ZohoSignApiResponse<unknown>> {
    return this.client.delete(`/requests/${requestId}`);
  }

  async recallRequest(requestId: string): Promise<ZohoSignApiResponse<unknown>> {
    return this.client.post(`/requests/${requestId}/recall`);
  }

  async remindRequest(requestId: string, body?: Record<string, unknown>): Promise<ZohoSignApiResponse<unknown>> {
    return this.client.post(`/requests/${requestId}/remind`, body ?? {});
  }

  async downloadRequestPdf(requestId: string): Promise<ArrayBuffer> {
    return this.client.request<ArrayBuffer>(`/requests/${requestId}/pdf`, { expectJson: false });
  }

  async downloadRequestAuditTrail(requestId: string): Promise<ArrayBuffer> {
    return this.client.request<ArrayBuffer>(`/requests/${requestId}/completioncertificate`, { expectJson: false });
  }

  async createEmbedToken(
    requestId: string,
    actionId: string,
    body?: Record<string, unknown>,
  ): Promise<ZohoSignApiResponse<Record<string, unknown>>> {
    return this.client.post(`/requests/${requestId}/actions/${actionId}/embedtoken`, body ?? {});
  }

  // ============================================
  // Templates
  // ============================================

  async listTemplates(options?: {
    row_count?: number;
    start_index?: number;
    sort_column?: string;
    sort_order?: 'ASC' | 'DESC';
  }): Promise<ZohoSignApiResponse<ZohoSignTemplate[]>> {
    return this.client.get('/templates', options);
  }

  async getTemplate(templateId: string): Promise<ZohoSignApiResponse<ZohoSignTemplate>> {
    return this.client.get(`/templates/${templateId}`);
  }

  async createDocumentFromTemplate(
    templateId: string,
    body: Record<string, unknown>,
    options?: { is_quicksend?: boolean },
  ): Promise<ZohoSignApiResponse<ZohoSignRequest>> {
    return this.client.post(`/templates/${templateId}/createdocument`, body, options);
  }

  // ============================================
  // Folders
  // ============================================

  async listFolders(): Promise<ZohoSignApiResponse<ZohoSignFolder[]>> {
    return this.client.get('/folders');
  }

  async createFolder(body: Record<string, unknown>): Promise<ZohoSignApiResponse<ZohoSignFolder>> {
    return this.client.post('/folders', body);
  }

  async getFolder(folderId: string): Promise<ZohoSignApiResponse<ZohoSignFolder>> {
    return this.client.get(`/folders/${folderId}`);
  }

  // ============================================
  // Users
  // ============================================

  async listUsers(): Promise<ZohoSignApiResponse<ZohoSignUser[]>> {
    return this.client.get('/users');
  }

  async getUser(userId: string): Promise<ZohoSignApiResponse<ZohoSignUser>> {
    return this.client.get(`/users/${userId}`);
  }

  async inviteUser(body: Record<string, unknown>): Promise<ZohoSignApiResponse<ZohoSignUser>> {
    return this.client.post('/users', body);
  }

  async updateUser(userId: string, body: Record<string, unknown>): Promise<ZohoSignApiResponse<ZohoSignUser>> {
    return this.client.put(`/users/${userId}`, body);
  }

  async deleteUser(userId: string): Promise<ZohoSignApiResponse<unknown>> {
    return this.client.delete(`/users/${userId}`);
  }

  // ============================================
  // Organization
  // ============================================

  async getAccount(): Promise<ZohoSignApiResponse<ZohoSignAccount>> {
    return this.client.get('/account');
  }

  async listFieldTypes(): Promise<ZohoSignApiResponse<ZohoSignFieldType[]>> {
    return this.client.get('/fieldtypes');
  }

  async listTags(): Promise<ZohoSignApiResponse<ZohoSignTag[]>> {
    return this.client.get('/tags');
  }

  // ============================================
  // Webhooks
  // ============================================

  async listWebhooks(): Promise<ZohoSignApiResponse<ZohoSignWebhook[]>> {
    return this.client.get('/webhooks');
  }

  async createWebhook(body: Record<string, unknown>): Promise<ZohoSignApiResponse<ZohoSignWebhook>> {
    return this.client.post('/webhooks', body);
  }

  async updateWebhook(webhookId: string, body: Record<string, unknown>): Promise<ZohoSignApiResponse<ZohoSignWebhook>> {
    return this.client.put(`/webhooks/${webhookId}`, body);
  }

  async deleteWebhook(webhookId: string): Promise<ZohoSignApiResponse<unknown>> {
    return this.client.delete(`/webhooks/${webhookId}`);
  }

  getClient(): ZohoSignClient {
    return this.client;
  }
}
