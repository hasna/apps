// ClickSend SMS Connector — SMS, MMS, and communication APIs
import { ClickSendClient } from './client';
import type { ClickSendConfig, CSSmsMessage, CSSmsResult, CSSmsHistory, CSContact, CSContactList, CSAccount } from '../types';
export { ClickSendClient } from './client';

export class ClickSendSMS {
  private readonly client: ClickSendClient;
  constructor(config: ClickSendConfig) { this.client = new ClickSendClient(config); }
  static fromEnv(): ClickSendSMS {
    const username = process.env.CLICKSEND_USERNAME;
    const apiKey = process.env.CLICKSEND_API_KEY;
    if (!username || !apiKey) throw new Error('CLICKSEND_USERNAME and CLICKSEND_API_KEY are required');
    return new ClickSendSMS({ username, apiKey });
  }

  async sendSms(messages: CSSmsMessage[]): Promise<{ messages: CSSmsResult[] }> {
    return this.client.request('/sms/send', { method: 'POST', body: { messages } as Record<string, unknown> });
  }
  async getSmsHistory(options?: { page?: number; limit?: number }): Promise<CSSmsHistory> {
    return this.client.request<CSSmsHistory>('/sms/history', { params: { page: options?.page, limit: options?.limit } });
  }

  async listContactLists(): Promise<CSContactList[]> { return this.client.request<CSContactList[]>('/lists'); }
  async getContactList(listId: number): Promise<CSContactList> { return this.client.request<CSContactList>(`/lists/${listId}`); }
  async createContactList(listName: string): Promise<CSContactList> {
    return this.client.request<CSContactList>('/lists', { method: 'POST', body: { list_name: listName } });
  }

  async listContacts(listId: number, options?: { page?: number; limit?: number }): Promise<CSContact[]> {
    return this.client.request<CSContact[]>(`/lists/${listId}/contacts`, { params: { page: options?.page, limit: options?.limit } });
  }
  async createContact(listId: number, data: { phone_number: string; first_name?: string; last_name?: string; email?: string }): Promise<CSContact> {
    return this.client.request<CSContact>(`/lists/${listId}/contacts`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteContact(listId: number, contactId: number): Promise<void> { await this.client.request(`/lists/${listId}/contacts/${contactId}`, { method: 'DELETE' }); }

  async getAccount(): Promise<CSAccount> { return this.client.request<CSAccount>('/account'); }

  getClient(): ClickSendClient { return this.client; }
}
