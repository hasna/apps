import type { SubstackClient } from './client';
import type { PublicationStats, PostStats, SubscriberGrowth } from '../types';

/**
 * Stats API
 * Get publication and post statistics
 */
export class StatsApi {
  constructor(private readonly client: SubstackClient) {}

  /**
   * Get overall publication statistics
   */
  async publication(): Promise<PublicationStats> {
    const response = await this.client.request<Record<string, unknown>>('/stats');

    return {
      total_subscribers: (response.total_subscribers as number) || 0,
      free_subscribers: (response.free_subscribers as number) || 0,
      paid_subscribers: (response.paid_subscribers as number) || 0,
      total_posts: (response.total_posts as number) || 0,
      total_views: (response.total_views as number) || 0,
      total_email_opens: (response.total_email_opens as number) || 0,
      total_reactions: (response.total_reactions as number) || 0,
      subscriber_growth: response.subscriber_growth as SubscriberGrowth[] | undefined,
    };
  }

  /**
   * Get statistics for a specific post
   */
  async post(postId: number): Promise<PostStats> {
    const response = await this.client.request<Record<string, unknown>>(`/posts/${postId}/stats`);

    return {
      post_id: postId,
      views: (response.views as number) || 0,
      email_opens: (response.email_opens as number) || 0,
      email_open_rate: (response.email_open_rate as number) || 0,
      reactions: (response.reactions as number) || 0,
      comments: (response.comments as number) || 0,
      restacks: (response.restacks as number) || 0,
    };
  }

  /**
   * Get subscriber growth over time
   */
  async subscriberGrowth(options: {
    startDate?: string;
    endDate?: string;
    interval?: 'day' | 'week' | 'month';
  } = {}): Promise<SubscriberGrowth[]> {
    const { startDate, endDate, interval = 'day' } = options;

    const params: Record<string, string | number | boolean | undefined> = {
      interval,
    };

    if (startDate) {
      params.start_date = startDate;
    }

    if (endDate) {
      params.end_date = endDate;
    }

    const response = await this.client.request<SubscriberGrowth[] | { growth: SubscriberGrowth[] }>(
      '/stats/subscriber-growth',
      { params }
    );

    if (Array.isArray(response)) {
      return response;
    }

    return response.growth || [];
  }

  /**
   * Get email performance stats
   */
  async emailPerformance(options: {
    limit?: number;
  } = {}): Promise<Array<{
    post_id: number;
    title: string;
    sent_at: string;
    opens: number;
    open_rate: number;
    clicks: number;
    click_rate: number;
  }>> {
    const { limit = 10 } = options;

    const response = await this.client.request<unknown[]>('/stats/emails', {
      params: { limit },
    });

    return (response || []).map((item: unknown) => {
      const data = item as Record<string, unknown>;
      return {
        post_id: (data.post_id as number) || 0,
        title: (data.title as string) || '',
        sent_at: (data.sent_at as string) || '',
        opens: (data.opens as number) || 0,
        open_rate: (data.open_rate as number) || 0,
        clicks: (data.clicks as number) || 0,
        click_rate: (data.click_rate as number) || 0,
      };
    });
  }
}
