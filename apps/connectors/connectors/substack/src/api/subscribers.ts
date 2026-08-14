import type { SubstackClient } from './client';
import type { Subscriber, SubscriberListResponse, SubscriberStats } from '../types';

/**
 * Subscribers API
 * Manage Substack subscribers - list, stats
 */
export class SubscribersApi {
  constructor(private readonly client: SubstackClient) {}

  /**
   * List subscribers
   * @param options - Filter and pagination options
   */
  async list(options: {
    offset?: number;
    limit?: number;
    type?: 'free' | 'paid' | 'comp' | 'gift';
    search?: string;
  } = {}): Promise<SubscriberListResponse> {
    const { offset = 0, limit = 50, type, search } = options;

    const params: Record<string, string | number | boolean | undefined> = {
      offset,
      limit,
    };

    if (type) {
      params.subscription_type = type;
    }

    if (search) {
      params.search = search;
    }

    const response = await this.client.request<Subscriber[] | SubscriberListResponse>('/subscribers', { params });

    // Handle both array and object responses
    if (Array.isArray(response)) {
      return {
        subscribers: response,
        more: response.length === limit,
        offset,
        limit,
      };
    }

    return response;
  }

  /**
   * Get subscriber statistics
   */
  async stats(): Promise<SubscriberStats> {
    // First get the publication stats
    const statsResponse = await this.client.request<Record<string, unknown>>('/stats/subscribers');

    // Transform the response to our interface
    return {
      total_subscribers: (statsResponse.total_subscribers as number) || 0,
      free_subscribers: (statsResponse.free_subscribers as number) || 0,
      paid_subscribers: (statsResponse.paid_subscribers as number) || 0,
      comp_subscribers: (statsResponse.comp_subscribers as number) || 0,
      total_email_opens: (statsResponse.total_email_opens as number) || 0,
      average_open_rate: (statsResponse.average_open_rate as number) || 0,
    };
  }

  /**
   * Get a single subscriber by email
   */
  async getByEmail(email: string): Promise<Subscriber | null> {
    const result = await this.list({ search: email, limit: 1 });
    return result.subscribers.find(s => s.email === email) || null;
  }

  /**
   * Export subscribers (returns download URL or data)
   */
  async export(options: {
    type?: 'free' | 'paid' | 'all';
    format?: 'csv' | 'json';
  } = {}): Promise<string> {
    const { type = 'all', format = 'csv' } = options;

    const response = await this.client.request<{ url: string } | string>('/subscribers/export', {
      method: 'POST',
      body: { type, format },
    });

    if (typeof response === 'object' && 'url' in response) {
      return response.url;
    }

    return response as string;
  }
}
