// Thankster Connector — Handwritten card automation for personalized notes
import { ThanksterClient } from './client';
import type { ThanksterConfig, TSCard, TSRecipient, TSSender, TSTemplate, TSOrder } from '../types';
export { ThanksterClient } from './client';

export class Thankster {
  private readonly client: ThanksterClient;
  constructor(config: ThanksterConfig) { this.client = new ThanksterClient(config); }
  static fromEnv(): Thankster {
    const apiKey = process.env.THANKSTER_API_KEY;
    if (!apiKey) throw new Error('THANKSTER_API_KEY is required');
    return new Thankster({ apiKey });
  }

  async listTemplates(options?: { category?: string }): Promise<TSTemplate[]> {
    return this.client.request<TSTemplate[]>('/templates', { params: { category: options?.category } });
  }
  async getTemplate(templateId: string): Promise<TSTemplate> { return this.client.request<TSTemplate>(`/templates/${templateId}`); }

  async createCard(data: { template_id: string; message: string; recipient: TSRecipient; sender: TSSender }): Promise<TSCard> {
    return this.client.request<TSCard>('/cards', { method: 'POST', body: data as Record<string, unknown> });
  }
  async getCard(cardId: string): Promise<TSCard> { return this.client.request<TSCard>(`/cards/${cardId}`); }
  async listCards(options?: { status?: string; page?: number }): Promise<TSCard[]> {
    return this.client.request<TSCard[]>('/cards', { params: { status: options?.status, page: options?.page } });
  }
  async cancelCard(cardId: string): Promise<void> { await this.client.request(`/cards/${cardId}/cancel`, { method: 'POST' }); }

  async createOrder(cardIds: string[]): Promise<TSOrder> {
    return this.client.request<TSOrder>('/orders', { method: 'POST', body: { card_ids: cardIds } as Record<string, unknown> });
  }
  async getOrder(orderId: string): Promise<TSOrder> { return this.client.request<TSOrder>(`/orders/${orderId}`); }

  getClient(): ThanksterClient { return this.client; }
}
