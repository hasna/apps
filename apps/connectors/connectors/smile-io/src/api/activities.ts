import type { SmileClient } from './client';
import type { Activity, ActivityResponse, CreateActivityInput } from '../types';

/**
 * Activities API — record a customer action for reward evaluation.
 * Endpoint: POST /activities
 */
export class ActivitiesApi {
  constructor(private readonly client: SmileClient) {}

  /**
   * Record an activity. Provide either `customer_id` or `customer_email`.
   * Smile evaluates the activity against the program's earning rules.
   */
  async create(input: CreateActivityInput): Promise<Activity> {
    const response = await this.client.request<ActivityResponse>('/activities', {
      method: 'POST',
      body: { activity: input },
    });
    return response.activity;
  }
}
