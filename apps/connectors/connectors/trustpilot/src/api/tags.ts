import type { TrustpilotClient } from './client';
import type { CreateCustomTagOptions } from '../types';

export class TagsApi {
  constructor(private readonly client: TrustpilotClient) {}

  async listBusinessUnitTags(businessUnitId: string): Promise<unknown> {
    return this.client.get(`/business-units/${encodeURIComponent(businessUnitId)}/customtaggroups`, undefined, 'apikey');
  }

  async listServiceReviewQuestions(businessUnitId: string): Promise<unknown> {
    return this.client.get(`/private/business-units/${encodeURIComponent(businessUnitId)}/service-review-questions`);
  }

  async createCustomTag(options: CreateCustomTagOptions): Promise<unknown> {
    return this.client.post(`/private/business-units/${encodeURIComponent(options.businessUnitId)}/tags`, {
      tagGroup: options.tagGroup,
      tag: options.tag,
      description: options.description,
    });
  }
}
