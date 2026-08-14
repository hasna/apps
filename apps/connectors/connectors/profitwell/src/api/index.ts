// ProfitWell Connector — Subscription financial metrics and revenue reporting
import { ProfitWellClient } from './client';
import type { ProfitWellConfig, PWMetrics, PWSubscription, PWPlan } from '../types';
export { ProfitWellClient } from './client';

export class ProfitWell {
  private readonly client: ProfitWellClient;
  constructor(config: ProfitWellConfig) { this.client = new ProfitWellClient(config); }
  static fromEnv(): ProfitWell {
    const apiKey = process.env.PROFITWELL_API_KEY;
    if (!apiKey) throw new Error('PROFITWELL_API_KEY is required');
    return new ProfitWell({ apiKey });
  }

  async getMetrics(options?: { month?: string; plan_id?: string }): Promise<PWMetrics> {
    return this.client.request<PWMetrics>('/metrics/monthly/', { params: { month: options?.month, plan_id: options?.plan_id } });
  }
  async getDailyMetrics(options?: { date?: string }): Promise<PWMetrics> {
    return this.client.request<PWMetrics>('/metrics/daily/', { params: { date: options?.date } });
  }

  async listSubscriptions(options?: { email?: string; page?: number }): Promise<PWSubscription[]> {
    return this.client.request<PWSubscription[]>('/subscriptions/', { params: { email: options?.email, page: options?.page } });
  }
  async createSubscription(data: { email: string; plan_id: string; value: number; effective_date: string }): Promise<PWSubscription> {
    return this.client.request<PWSubscription>('/subscriptions/', { method: 'POST', body: data as Record<string, unknown> });
  }
  async churnSubscription(subscriptionId: string, effectiveDate: string): Promise<void> {
    await this.client.request(`/subscriptions/${subscriptionId}/`, { method: 'DELETE', params: { effective_date: effectiveDate } });
  }

  async listPlans(): Promise<PWPlan[]> { return this.client.request<PWPlan[]>('/plans/'); }

  getClient(): ProfitWellClient { return this.client; }
}
