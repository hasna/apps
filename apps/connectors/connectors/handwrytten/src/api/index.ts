// Handwrytten Connector — Handwritten notes and cards via robot
import { HandwryttenClient } from './client';
import type { HandwryttenConfig, HWCard, HWFont, HWOrder, HWRecipient, HWSender } from '../types';
export { HandwryttenClient } from './client';

export class Handwrytten {
  private readonly client: HandwryttenClient;
  constructor(config: HandwryttenConfig) { this.client = new HandwryttenClient(config); }
  static fromEnv(): Handwrytten {
    const apiKey = process.env.HANDWRYTTEN_API_KEY;
    if (!apiKey) throw new Error('HANDWRYTTEN_API_KEY is required');
    return new Handwrytten({ apiKey });
  }

  async listCards(options?: { category?: string }): Promise<HWCard[]> {
    return this.client.request<HWCard[]>('/cards', { params: { category: options?.category } });
  }
  async getCard(cardId: string): Promise<HWCard> { return this.client.request<HWCard>(`/cards/${cardId}`); }

  async listFonts(): Promise<HWFont[]> { return this.client.request<HWFont[]>('/fonts'); }

  async createOrder(data: { card_id: string; message: string; font_id?: string; recipient: HWRecipient; sender: HWSender }): Promise<HWOrder> {
    return this.client.request<HWOrder>('/orders', { method: 'POST', body: data as Record<string, unknown> });
  }
  async getOrder(orderId: string): Promise<HWOrder> { return this.client.request<HWOrder>(`/orders/${orderId}`); }
  async listOrders(options?: { page?: number; per_page?: number }): Promise<HWOrder[]> {
    return this.client.request<HWOrder[]>('/orders', { params: { page: options?.page, per_page: options?.per_page } });
  }

  getClient(): HandwryttenClient { return this.client; }
}
