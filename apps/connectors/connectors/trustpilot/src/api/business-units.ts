import type { TrustpilotClient } from './client';
import type {
  BusinessUnitFindOptions,
  BusinessUnitReviewsOptions,
  BusinessUnitReviewsSummaryOptions,
  BusinessUnitSearchOptions,
  BusinessUnitWebLinksOptions,
} from '../types';

export class BusinessUnitsApi {
  constructor(private readonly client: TrustpilotClient) {}

  async find(options: BusinessUnitFindOptions): Promise<unknown> {
    return this.client.get('/business-units/find', { name: options.name }, 'apikey');
  }

  async search(options: BusinessUnitSearchOptions): Promise<unknown> {
    return this.client.get('/business-units/search', {
      query: options.query,
      country: options.country,
      perPage: options.perPage,
      page: options.page,
    }, 'apikey');
  }

  async get(businessUnitId: string): Promise<unknown> {
    return this.client.get(`/business-units/${encodeURIComponent(businessUnitId)}`, undefined, 'apikey');
  }

  async getProfile(businessUnitId: string): Promise<unknown> {
    return this.client.get(`/business-units/${encodeURIComponent(businessUnitId)}/profileinfo`, undefined, 'apikey');
  }

  async getWebLinks(options: BusinessUnitWebLinksOptions): Promise<unknown> {
    return this.client.get(`/business-units/${encodeURIComponent(options.businessUnitId)}/web-links`, {
      locale: options.locale,
    }, 'apikey');
  }

  async getReviews(options: BusinessUnitReviewsOptions): Promise<unknown> {
    return this.client.get(`/business-units/${encodeURIComponent(options.businessUnitId)}/reviews`, {
      perPage: options.perPage,
      page: options.page,
      stars: options.stars,
      orderBy: options.orderBy,
      language: options.language,
      tagGroup: options.tagGroup,
      tag: options.tag,
    }, 'apikey');
  }

  async getReviewsSummary(options: BusinessUnitReviewsSummaryOptions): Promise<unknown> {
    return this.client.get(`/business-units/${encodeURIComponent(options.businessUnitId)}/reviews/summary`, {
      locale: options.locale,
    }, 'apikey');
  }
}
