import type { ConnectorClient } from './client';
import type {
  AudienceTargeting,
  FirstPartyAudienceCreateParams,
} from '../types';

/**
 * First-party audience onboarding and campaign audience targeting.
 * Docs: https://developers.taboola.com/backstage-api/reference/onboarding-overview
 */
export class AudiencesApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create an empty first-party audience.
   * POST /backstage/api/1.0/{account_id}/audience_onboarding/create
   */
  async createFirstParty(
    accountId: string,
    data: FirstPartyAudienceCreateParams
  ): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>(
      `/${accountId}/audience_onboarding/create`,
      data
    );
  }

  /**
   * Get the "My Audiences" targeting (first-party + custom) for a campaign.
   * GET /backstage/api/1.0/{account_id}/campaigns/{campaign_id}/targeting/my_audiences
   */
  async getCampaignTargeting(accountId: string, campaignId: string): Promise<AudienceTargeting> {
    return this.client.get<AudienceTargeting>(
      `/${accountId}/campaigns/${campaignId}/targeting/my_audiences`
    );
  }

  /**
   * Update the "My Audiences" targeting for a campaign.
   * POST /backstage/api/1.0/{account_id}/campaigns/{campaign_id}/targeting/my_audiences
   */
  async updateCampaignTargeting(
    accountId: string,
    campaignId: string,
    data: Record<string, unknown>
  ): Promise<AudienceTargeting> {
    return this.client.post<AudienceTargeting>(
      `/${accountId}/campaigns/${campaignId}/targeting/my_audiences`,
      data
    );
  }
}
