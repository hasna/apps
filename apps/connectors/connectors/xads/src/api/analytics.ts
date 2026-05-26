import type { XAdsClient } from './client';
import type {
  AnalyticsParams,
  AnalyticsResponse,
  ReachEstimateParams,
  ReachEstimate,
  Granularity,
  MetricGroup,
} from '../types';

/**
 * Analytics API
 */
export class AnalyticsApi {
  constructor(private client: XAdsClient) {}

  /**
   * Get campaign analytics
   */
  async getCampaignStats(
    accountId: string,
    campaignIds: string[],
    params: {
      start_time: string;
      end_time: string;
      granularity?: Granularity;
      metric_groups?: MetricGroup[];
      placement?: string;
    }
  ): Promise<AnalyticsResponse> {
    return this.client.get<AnalyticsResponse>(
      `/stats/accounts/${accountId}/campaigns`,
      {
        campaign_ids: campaignIds.join(','),
        start_time: params.start_time,
        end_time: params.end_time,
        granularity: params.granularity || 'TOTAL',
        metric_groups: params.metric_groups?.join(',') || 'ENGAGEMENT',
        placement: params.placement,
      }
    );
  }

  /**
   * Get line item analytics
   */
  async getLineItemStats(
    accountId: string,
    lineItemIds: string[],
    params: {
      start_time: string;
      end_time: string;
      granularity?: Granularity;
      metric_groups?: MetricGroup[];
      placement?: string;
    }
  ): Promise<AnalyticsResponse> {
    return this.client.get<AnalyticsResponse>(
      `/stats/accounts/${accountId}/line_items`,
      {
        line_item_ids: lineItemIds.join(','),
        start_time: params.start_time,
        end_time: params.end_time,
        granularity: params.granularity || 'TOTAL',
        metric_groups: params.metric_groups?.join(',') || 'ENGAGEMENT',
        placement: params.placement,
      }
    );
  }

  /**
   * Get promoted tweet analytics
   */
  async getPromotedTweetStats(
    accountId: string,
    promotedTweetIds: string[],
    params: {
      start_time: string;
      end_time: string;
      granularity?: Granularity;
      metric_groups?: MetricGroup[];
      placement?: string;
    }
  ): Promise<AnalyticsResponse> {
    return this.client.get<AnalyticsResponse>(
      `/stats/accounts/${accountId}/promoted_tweets`,
      {
        promoted_tweet_ids: promotedTweetIds.join(','),
        start_time: params.start_time,
        end_time: params.end_time,
        granularity: params.granularity || 'TOTAL',
        metric_groups: params.metric_groups?.join(',') || 'ENGAGEMENT',
        placement: params.placement,
      }
    );
  }

  /**
   * Get account-level analytics
   */
  async getAccountStats(
    accountId: string,
    params: {
      start_time: string;
      end_time: string;
      granularity?: Granularity;
      metric_groups?: MetricGroup[];
    }
  ): Promise<AnalyticsResponse> {
    return this.client.get<AnalyticsResponse>(
      `/stats/accounts/${accountId}`,
      {
        start_time: params.start_time,
        end_time: params.end_time,
        granularity: params.granularity || 'TOTAL',
        metric_groups: params.metric_groups?.join(',') || 'ENGAGEMENT',
      }
    );
  }

  /**
   * Get reach estimate for targeting criteria
   */
  async getReachEstimate(
    accountId: string,
    params: ReachEstimateParams
  ): Promise<{ data: ReachEstimate }> {
    return this.client.get<{ data: ReachEstimate }>(
      `/accounts/${accountId}/reach_estimate`,
      {
        objective: params.objective,
        bid_amount_local_micro: params.bid_amount_local_micro,
        currency: params.currency,
        campaign_daily_budget_amount_local_micro: params.campaign_daily_budget_amount_local_micro,
        similar_to_followers_of_users: params.similar_to_followers_of_users?.join(','),
        locations: params.locations?.join(','),
        interests: params.interests?.join(','),
        gender: params.gender,
        platforms: params.platforms?.join(','),
        tailored_audiences: params.tailored_audiences?.join(','),
        age_buckets: params.age_buckets?.join(','),
        languages: params.languages?.join(','),
      }
    );
  }

  /**
   * Get active entities count
   */
  async getActiveEntities(
    accountId: string,
    params: {
      start_time: string;
      end_time: string;
    }
  ): Promise<{ data: { campaigns: number; line_items: number; promoted_tweets: number } }> {
    return this.client.get<{ data: { campaigns: number; line_items: number; promoted_tweets: number } }>(
      `/stats/accounts/${accountId}/active_entities`,
      {
        start_time: params.start_time,
        end_time: params.end_time,
      }
    );
  }
}
