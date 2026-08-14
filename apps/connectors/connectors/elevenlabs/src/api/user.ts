import type { ElevenLabsClient } from './client';
import type { User, Subscription } from '../types';

/**
 * User API module
 * Get user info and subscription details
 */
export class UserApi {
  constructor(private readonly client: ElevenLabsClient) {}

  /**
   * Get current user info
   */
  async get(): Promise<User> {
    return this.client.get<User>('/v1/user');
  }

  /**
   * Get subscription info
   */
  async getSubscription(): Promise<Subscription> {
    return this.client.get<Subscription>('/v1/user/subscription');
  }

  /**
   * Get character usage info
   */
  async getUsage(): Promise<{
    characterCount: number;
    characterLimit: number;
    percentUsed: number;
    nextResetUnix: number;
  }> {
    const subscription = await this.getSubscription();

    return {
      characterCount: subscription.character_count,
      characterLimit: subscription.character_limit,
      percentUsed: Math.round((subscription.character_count / subscription.character_limit) * 100),
      nextResetUnix: subscription.next_character_count_reset_unix,
    };
  }
}
