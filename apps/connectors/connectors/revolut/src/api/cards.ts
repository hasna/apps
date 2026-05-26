import type { RevolutCard, CreateCardRequest } from '../types';
import type { RevolutClient } from './client';

/**
 * Revolut Cards API
 */
export class CardsApi {
  constructor(private readonly client: RevolutClient) {}

  /**
   * List all cards
   */
  async listCards(): Promise<RevolutCard[]> {
    return this.client.request<RevolutCard[]>('/cards');
  }

  /**
   * Get card by ID
   */
  async getCard(cardId: string): Promise<RevolutCard> {
    return this.client.request<RevolutCard>(`/cards/${cardId}`);
  }

  /**
   * Create a virtual card
   */
  async createVirtualCard(data: Omit<CreateCardRequest, 'virtual'>): Promise<RevolutCard> {
    return this.client.request<RevolutCard>('/cards', {
      method: 'POST',
      body: {
        ...data,
        virtual: true,
      },
    });
  }

  /**
   * Freeze a card
   */
  async freezeCard(cardId: string): Promise<RevolutCard> {
    return this.client.request<RevolutCard>(`/cards/${cardId}/freeze`, {
      method: 'POST',
    });
  }

  /**
   * Unfreeze a card
   */
  async unfreezeCard(cardId: string): Promise<RevolutCard> {
    return this.client.request<RevolutCard>(`/cards/${cardId}/unfreeze`, {
      method: 'POST',
    });
  }

  /**
   * Terminate a card
   */
  async terminateCard(cardId: string): Promise<void> {
    await this.client.request<void>(`/cards/${cardId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Update card label
   */
  async updateCard(cardId: string, data: { label?: string }): Promise<RevolutCard> {
    return this.client.request<RevolutCard>(`/cards/${cardId}`, {
      method: 'PATCH',
      body: data,
    });
  }

  /**
   * Get sensitive card details (card number, CVV)
   * Note: Requires additional permissions and may be restricted
   */
  async getSensitiveDetails(cardId: string): Promise<{
    pan: string;
    cvv: string;
    expiry: string;
  }> {
    return this.client.request(`/cards/${cardId}/sensitive-details`, {
      method: 'POST',
    });
  }
}
