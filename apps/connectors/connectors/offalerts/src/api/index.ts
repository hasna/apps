// Off Alerts Connector — Price drop and deal alerts for online shopping
import { OffAlertsClient } from './client';
import type { OffAlertsConfig, OAAlert, OAAlertList, OAPriceHistory, OAProduct } from '../types';
export { OffAlertsClient } from './client';

export class OffAlerts {
  private readonly client: OffAlertsClient;
  constructor(config: OffAlertsConfig) { this.client = new OffAlertsClient(config); }
  static fromEnv(): OffAlerts {
    const apiKey = process.env.OFFALERTS_API_KEY;
    if (!apiKey) throw new Error('OFFALERTS_API_KEY is required');
    return new OffAlerts({ apiKey });
  }

  async listAlerts(options?: { page?: number; per_page?: number; status?: string }): Promise<OAAlertList> {
    return this.client.request<OAAlertList>('/alerts', { params: { page: options?.page, per_page: options?.per_page, status: options?.status } });
  }
  async getAlert(alertId: string): Promise<OAAlert> { return this.client.request<OAAlert>(`/alerts/${alertId}`); }
  async createAlert(data: { product_url: string; target_price: number; email: string }): Promise<OAAlert> {
    return this.client.request<OAAlert>('/alerts', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteAlert(alertId: string): Promise<void> { await this.client.request(`/alerts/${alertId}`, { method: 'DELETE' }); }

  async getProduct(productUrl: string): Promise<OAProduct> {
    return this.client.request<OAProduct>('/products/lookup', { params: { url: productUrl } });
  }
  async getPriceHistory(productUrl: string): Promise<OAPriceHistory> {
    return this.client.request<OAPriceHistory>('/products/price-history', { params: { url: productUrl } });
  }

  getClient(): OffAlertsClient { return this.client; }
}
